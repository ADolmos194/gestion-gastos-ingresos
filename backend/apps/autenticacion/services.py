import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

from apps.seguridad.services import build_user_access

from .models import VerificationCode

logger = logging.getLogger(__name__)

_TEMPLATE_HTML = "autenticacion/emails/code_email.html"
_TEMPLATE_TEXT = "autenticacion/emails/code_email.txt"


def _issue_and_send(user, purpose, subject, heading, intro, footer_note):
    # Protege contra spam de correo desde CUALQUIER punto de entrada que dispare un envío
    # (registro, reenvío explícito, auto-reenvío al intentar loguearse sin verificar) — el
    # cooldown vive acá, no en el throttle por IP de cada vista, que no cubre este cruce.
    if VerificationCode.has_recent_active(user, purpose):
        return
    verification = VerificationCode.issue(user, purpose)
    context = {
        "heading": heading,
        "intro": intro,
        "code": verification.code,
        "ttl_minutes": settings.VERIFICATION_CODE_TTL_MINUTES,
        "footer_note": footer_note,
    }

    email = EmailMultiAlternatives(
        subject=subject,
        body=render_to_string(_TEMPLATE_TEXT, context),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[user.email],
    )
    email.attach_alternative(render_to_string(_TEMPLATE_HTML, context), "text/html")
    email.send(fail_silently=True)
    logger.info("Código de %s enviado a %s", purpose, user.email)


def send_verification_code(user):
    _issue_and_send(
        user,
        VerificationCode.Purpose.EMAIL_VERIFICATION,
        subject="Verifica tu cuenta",
        heading=f"Hola {user.first_name or user.username},",
        intro="Usa este código para verificar tu cuenta de Gastos e Ingresos.",
        footer_note="Si no creaste esta cuenta, podés ignorar este mensaje.",
    )


def send_password_reset_code(user):
    _issue_and_send(
        user,
        VerificationCode.Purpose.PASSWORD_RESET,
        subject="Recupera tu contraseña",
        heading=f"Hola {user.first_name or user.username},",
        intro="Usa este código para restablecer la contraseña de tu cuenta.",
        footer_note="Si no solicitaste esto, podés ignorar este mensaje.",
    )


def build_session_payload(user):
    """Arma el payload que consume el frontend tras login/me/refresh: datos del usuario +
    el árbol de menú y los permisos que le corresponden (ver apps.seguridad.services).

    Devuelve (payload, has_access): has_access en False significa que el usuario no tiene
    ningún rol activo con menú/permisos asociados, y quien llame debe tratarlo como no
    autorizado (ver LoginView).
    """
    access = build_user_access(user)
    payload = {
        "user_info": {
            "id": str(user.id),
            "username": user.username,
            "name": user.first_name,
            "last_name": user.last_name,
            "email": user.email,
            "dni": user.nro_document,
            "role": access.all_access,
        },
        "menus": access.menus,
        "permisos_front": access.permisos_front,
        "permisos_back": access.permisos_back,
    }
    return payload, access.has_access
