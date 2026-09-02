import logging

from django.contrib.auth import authenticate
from django.contrib.auth import login as django_login
from django.contrib.auth import logout as django_logout
from django.contrib.auth import update_session_auth_hash
from django.db.models import Q
from django.middleware.csrf import rotate_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import User, VerificationCode
from .serializers import (
    ChangePasswordSerializer,
    ForgotPasswordSerializer,
    LoginSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    ResetPasswordConfirmSerializer,
    UserSerializer,
    VerifyEmailSerializer,
)
from .services import build_session_payload, send_password_reset_code, send_verification_code

logger = logging.getLogger(__name__)

# Mensaje genérico: no revela si el usuario existe o si fue la contraseña la que falló.
_INVALID_CREDENTIALS = {"detail": "Usuario o contraseña incorrectos."}

# Mismo mensaje sin importar si el email existe o no, para evitar enumeración de cuentas.
_FORGOT_PASSWORD_DETAIL = "Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña."
_RESEND_VERIFICATION_DETAIL = "Si la cuenta existe y no está verificada, te enviamos un código nuevo."
_INVALID_CODE = {"detail": "El código es inválido o ha expirado."}

# Ningún rol activo con menú/permisos asociados: no se crea sesión, igual que con una
# cuenta no verificada (ver LoginView.post).
_NO_PERMISSIONS = {
    "detail": "Tu usuario no tiene permisos asignados. Contacta a un administrador.",
    "reason": "no_permissions",
}


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfCookieView(APIView):
    """Entrega la cookie csrftoken para que el frontend la use en X-CSRFToken al hacer login."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "CSRF cookie establecida"})


class LoginView(APIView):
    """Autentica con usuario/contraseña y crea una sesión de Django (cookie httponly).

    El campo "username" acepta tanto el username real como el email registrado
    (el frontend lo muestra como "Correo"), para eso se resuelve a un User antes
    de autenticar.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        identifier = serializer.validated_data["username"]
        password = serializer.validated_data["password"]

        user = User.objects.filter(Q(username=identifier) | Q(email__iexact=identifier)).first()

        if user is not None and user.is_locked:
            logger.warning("Login rechazado: cuenta bloqueada (%s)", identifier)
            return Response(
                {"detail": "Cuenta bloqueada por demasiados intentos fallidos. Contacta a un administrador."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # authenticate() usa el hasher de contraseñas de Django (tiempo constante) y ya
        # protege contra enumeración por timing cuando el usuario no existe. Le pasamos
        # el username real (resuelto arriba) para que la búsqueda interna de ModelBackend
        # funcione también cuando el usuario se identificó por email.
        authenticated_user = authenticate(
            request, username=user.username if user else identifier, password=password
        )

        if authenticated_user is None:
            if user is not None and user.is_active:
                user.register_failed_attempt()
            logger.info("Login fallido para %s", identifier)
            return Response(_INVALID_CREDENTIALS, status=status.HTTP_401_UNAUTHORIZED)

        # Chequeo DESPUÉS de confirmar la contraseña: nunca revela el estado de verificación
        # a alguien que no la sabe. No cuenta como intento fallido (register_failed_attempt),
        # esa métrica es sobre credenciales incorrectas, no sobre este caso.
        if not authenticated_user.email_verified:
            send_verification_code(authenticated_user)
            logger.info("Login bloqueado por cuenta no verificada: %s", authenticated_user.username)
            return Response(
                {
                    "detail": "Tu cuenta no está verificada. Te enviamos un código nuevo a tu correo.",
                    "reason": "email_not_verified",
                    "email": authenticated_user.email,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Chequeo DESPUÉS de contraseña y verificación de email, por la misma razón: no
        # revela nada a alguien que no pasó esos dos filtros primero. Un usuario sin rol
        # activo (o con un rol sin menú/permisos asociados) no puede "entrar al sistema".
        payload, has_access = build_session_payload(authenticated_user)
        if not has_access:
            logger.info("Login bloqueado por falta de permisos: %s", authenticated_user.username)
            return Response(_NO_PERMISSIONS, status=status.HTTP_403_FORBIDDEN)

        # Rota la session key (previene fijación de sesión) y dispara user_logged_in,
        # que ya resetea failed_login_attempts (ver apps/autenticacion/signals.py).
        django_login(request, authenticated_user)

        return Response(payload, status=status.HTTP_200_OK)


class RegisterView(APIView):
    """Crea una cuenta nueva, sin verificar. No inicia sesión automáticamente."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        send_verification_code(user)
        logger.info("Usuario registrado: %s", user.username)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class RefreshSessionView(APIView):
    """Confirma que la sesión sigue activa y desliza su expiración (sliding session).

    No hay un "token" que refrescar: con SESSION_SAVE_EVERY_REQUEST=True cualquier
    request autenticado ya desliza la expiración. Este endpoint existe para que el
    frontend pueda pedirlo explícitamente y saber cuánto tiempo de sesión le queda.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload, _has_access = build_session_payload(request.user)
        return Response(
            {**payload, "expires_in": request.session.get_expiry_age()},
            status=status.HTTP_200_OK,
        )


class ForgotPasswordView(APIView):
    """Inicia la recuperación de contraseña: envía un código de un solo uso por email."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        # No filtramos por is_active: una cuenta bloqueada (is_locked=True => is_active=False)
        # debe poder recuperarse por este flujo; ResetPasswordConfirmView es quien la desbloquea.
        user = User.objects.filter(email__iexact=email).first()
        if user is not None:
            send_password_reset_code(user)
            logger.info("Código de recuperación enviado a %s", user.email)
        else:
            logger.info("Solicitud de recuperación para un email no registrado")

        # Misma respuesta exista o no la cuenta: evita revelar qué emails están registrados.
        return Response({"detail": _FORGOT_PASSWORD_DETAIL}, status=status.HTTP_200_OK)


class VerifyEmailView(APIView):
    """Verifica una cuenta recién registrada con el código de 6 dígitos enviado por email."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email_verify_confirm"

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        code = serializer.validated_data["code"]

        user = User.objects.filter(email__iexact=email).first()
        if user is None or not VerificationCode.verify(user, VerificationCode.Purpose.EMAIL_VERIFICATION, code):
            return Response(_INVALID_CODE, status=status.HTTP_400_BAD_REQUEST)

        user.email_verified = True
        user.save(update_fields=["email_verified"])
        logger.info("Cuenta verificada: %s", user.username)
        return Response({"detail": "Cuenta verificada correctamente."}, status=status.HTTP_200_OK)


class ResendVerificationView(APIView):
    """Reenvía el código de verificación de cuenta."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email_verify_resend"

    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]

        # Mismo patrón anti-enumeración que ForgotPasswordView: respuesta siempre genérica.
        user = User.objects.filter(email__iexact=email).first()
        if user is not None and not user.email_verified:
            send_verification_code(user)

        return Response({"detail": _RESEND_VERIFICATION_DETAIL}, status=status.HTTP_200_OK)


class ResetPasswordConfirmView(APIView):
    """Confirma la recuperación: valida el código y establece la nueva contraseña."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = ResetPasswordConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        code = serializer.validated_data["code"]
        new_password = serializer.validated_data["new_password"]

        user = User.objects.filter(email__iexact=email).first()
        if user is None or not VerificationCode.verify(user, VerificationCode.Purpose.PASSWORD_RESET, code):
            return Response(_INVALID_CODE, status=status.HTTP_400_BAD_REQUEST)

        # set_password cambia el hash de autenticación de sesión (get_session_auth_hash),
        # por lo que Django invalida automáticamente cualquier sesión activa de este usuario.
        user.set_password(new_password)
        user.is_locked = False
        user.is_active = True
        user.failed_login_attempts = 0
        user.save(update_fields=["password", "is_locked", "is_active", "failed_login_attempts"])

        logger.info("Contraseña restablecida para %s", user.username)
        return Response({"detail": "Contraseña actualizada correctamente."}, status=status.HTTP_200_OK)


class ChangePasswordView(APIView):
    """Cambia la contraseña del usuario autenticado, sin cerrar su sesión actual."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "change_password"

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"user": request.user})
        serializer.is_valid(raise_exception=True)
        current_password = serializer.validated_data["current_password"]
        new_password = serializer.validated_data["new_password"]

        if not request.user.check_password(current_password):
            logger.info("Cambio de contraseña rechazado: contraseña actual incorrecta (%s)", request.user.username)
            return Response({"detail": "La contraseña actual es incorrecta."}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_password)
        request.user.save(update_fields=["password"])

        # set_password cambia el hash que valida la sesión (get_session_auth_hash).
        # update_session_auth_hash mantiene viva ESTA sesión; cualquier otra sesión
        # activa del usuario (otro navegador/dispositivo) queda invalidada.
        update_session_auth_hash(request, request.user)

        logger.info("Contraseña cambiada por el propio usuario: %s", request.user.username)
        return Response({"detail": "Contraseña actualizada correctamente."}, status=status.HTTP_200_OK)


class LogoutView(APIView):
    """Cierra la sesión actual. Requiere estar autenticado."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        django_logout(request)
        # Invalida el csrftoken usado durante la sesión cerrada: rotate_token genera uno
        # nuevo y el middleware lo manda en el Set-Cookie de esta misma respuesta, así el
        # frontend ya tiene un token fresco disponible sin pedirlo aparte.
        rotate_token(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """Devuelve el usuario de la sesión actual."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        payload, _has_access = build_session_payload(request.user)
        return Response(payload)
