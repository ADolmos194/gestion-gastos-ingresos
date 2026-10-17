"""2FA por TOTP (apps de autenticación: Google Authenticator, Authy, 1Password, etc.).

Toda la lógica criptográfica vive acá, separada de las vistas: el resto del proyecto solo
habla con generate_secret/otpauth_uri/verify_totp/verify_recovery_code/generate_recovery_codes.

- El TOTP es el RFC 6238 estándar, con ventana ±1 step (30s) para tolerar desincronización.
- Los códigos de respaldo se guardan SOLO como hash sha256 en otp_recovery_codes; el plaintext
  se muestra una única vez (al activar o al regenerar) y nunca se puede recuperar después.
"""

import base64
import hashlib
import secrets

import pyotp
from django.conf import settings

# Ventana aceptada (en pasos de 30 s): el código actual más el anterior/siguiente. Baja la
# fricción por reloj desincronizado, con coste de fuerza bruta despreciable a 3 intentos/paso.
TOTP_VALID_WINDOW = 1

# Formato de los códigos de respaldo: 16 caracteres en base32 (sin relleno), agrupables de a
# 4 — mismo formato legible que los app-password de Google.
RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_CHARS = 16


def generate_secret() -> str:
    return pyotp.random_base32()


def otpauth_uri(user) -> str:
    """El otpauth:// que la app de autenticación escanea para importar el secreto."""
    return pyotp.TOTP(user.otp_secret).provisioning_uri(
        name=user.email,
        issuer_name=settings.TWO_FA_TOTP_ISSUER,
    )


def verify_totp(user, code: str) -> bool:
    """Valida un código TOTP dentro de la ventana ±1 step. Vuelve False si el usuario no
    tiene secreto (otp_secret vacío), así los flujos no necesitan chequearlo por separado."""
    if not user.otp_secret:
        return False
    return pyotp.TOTP(user.otp_secret).verify(code.strip(), valid_window=TOTP_VALID_WINDOW)


def generate_recovery_codes() -> list[str]:
    """Genera RECOVERY_CODE_COUNT códigos de respaldo en claro (para mostrarlos UNA vez)."""
    codes: list[str] = []
    while len(codes) < RECOVERY_CODE_COUNT:
        raw = base64.b32encode(secrets.token_bytes(RECOVERY_CODE_CHARS // 2)).decode()[:RECOVERY_CODE_CHARS]
        if raw not in codes:
            codes.append(raw)
    return codes


def hash_recovery_codes(codes: list[str]) -> list[str]:
    return [hashlib.sha256(code.encode("ascii")).hexdigest() for code in codes]


def verify_recovery_code(user, code: str) -> bool:
    """Valida y CONSUME un código de respaldo (comparación por hash). Cada código solo
    sirve una vez; el slot usado queda marcado y ya no se puede reutilizar."""
    candidate = hashlib.sha256(code.strip().upper().encode("ascii")).hexdigest()
    for index, stored in enumerate(user.otp_recovery_codes):
        if stored and stored == candidate:
            user.otp_recovery_codes[index] = "used"
            user.save(update_fields=["otp_recovery_codes"])
            return True
    return False


def has_unused_recovery_codes(user) -> bool:
    return any(code and code != "used" for code in user.otp_recovery_codes)


def clear_2fa(user) -> None:
    """Apaga el 2FA y borra todos sus secretos/materiales (disable o reset de cuenta)."""
    user.otp_secret = ""
    user.otp_enabled = False
    user.otp_recovery_codes = []
    user.save(update_fields=["otp_secret", "otp_enabled", "otp_recovery_codes"])