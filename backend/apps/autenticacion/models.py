import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    def create_user(self, username, email, password=None, **extra_fields):
        if not username:
            raise ValueError("El usuario debe tener un username")
        if not email:
            raise ValueError("El usuario debe tener un email")

        email = self.normalize_email(email)
        user = self.model(username=username, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, username, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        extra_fields.setdefault("email_verified", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("El superusuario debe tener is_staff=True")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("El superusuario debe tener is_superuser=True")

        return self.create_user(username, email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    MAX_LOGIN_ATTEMPTS = 3

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = models.CharField(max_length=150, unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    email = models.EmailField(unique=True)
    nro_document = models.CharField(max_length=11, unique=True, blank=True, null=True)

    failed_login_attempts = models.PositiveSmallIntegerField(default=0)
    is_locked = models.BooleanField(default=False)
    # No reusa is_active: ese campo ya lo controla el bloqueo por intentos fallidos
    # (register_failed_attempt/unlock). Verificación de email es un estado independiente.
    email_verified = models.BooleanField(default=False)

    # last_login lo gestiona AbstractBaseUser (se actualiza solo al iniciar sesión)
    last_logout = models.DateTimeField(null=True, blank=True)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["email"]

    class Meta:
        db_table = "auth_users"

    def __str__(self):
        return self.username

    def get_full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    def register_failed_attempt(self):
        self.failed_login_attempts += 1
        if self.failed_login_attempts >= self.MAX_LOGIN_ATTEMPTS:
            self.is_locked = True
            self.is_active = False
        self.save(update_fields=["failed_login_attempts", "is_locked", "is_active"])

    def reset_failed_attempts(self):
        self.failed_login_attempts = 0
        self.save(update_fields=["failed_login_attempts"])

    def unlock(self):
        self.is_locked = False
        self.is_active = True
        self.failed_login_attempts = 0
        self.save(update_fields=["is_locked", "is_active", "failed_login_attempts"])


class VerificationCode(models.Model):
    """Código de 6 dígitos de un solo uso, para verificación de email o reset de contraseña.

    Una sola tabla para ambos propósitos (discriminados por `purpose`): la mecánica de
    emitir/enviar/validar/expirar/consumir es idéntica en los dos casos.
    """

    MAX_ATTEMPTS = 5

    class Purpose(models.TextChoices):
        EMAIL_VERIFICATION = "email_verification", "Verificación de correo"
        PASSWORD_RESET = "password_reset", "Restablecimiento de contraseña"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="verification_codes")
    purpose = models.CharField(max_length=20, choices=Purpose.choices)
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "auth_verification_codes"
        indexes = [models.Index(fields=["user", "purpose", "consumed_at"])]

    @classmethod
    def issue(cls, user, purpose):
        # Invalida cualquier código activo previo del mismo user+purpose: garantiza que
        # verify() siempre tenga a lo sumo una fila activa para consultar.
        cls.objects.filter(user=user, purpose=purpose, consumed_at__isnull=True).update(
            consumed_at=timezone.now()
        )
        code = f"{secrets.randbelow(1_000_000):06d}"
        return cls.objects.create(
            user=user,
            purpose=purpose,
            code=code,
            expires_at=timezone.now() + timedelta(minutes=settings.VERIFICATION_CODE_TTL_MINUTES),
        )

    @classmethod
    def has_recent_active(cls, user, purpose):
        cutoff = timezone.now() - timedelta(seconds=settings.VERIFICATION_RESEND_COOLDOWN_SECONDS)
        return cls.objects.filter(
            user=user, purpose=purpose, consumed_at__isnull=True, created_at__gt=cutoff
        ).exists()

    @classmethod
    def verify(cls, user, purpose, code):
        record = cls.objects.filter(user=user, purpose=purpose, consumed_at__isnull=True).first()
        if record is None or record.expires_at < timezone.now() or record.attempts >= cls.MAX_ATTEMPTS:
            return False
        if record.code != code:
            record.attempts += 1
            record.save(update_fields=["attempts"])
            return False
        record.consumed_at = timezone.now()
        record.save(update_fields=["consumed_at"])
        return True
