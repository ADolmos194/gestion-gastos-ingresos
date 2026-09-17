"""
Django settings for config project.
"""

from pathlib import Path
import os

import dj_database_url
from dotenv import load_dotenv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Carga variables desde el .env ubicado en la raíz del proyecto (backend/)
load_dotenv(BASE_DIR / '.env')


def env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ('1', 'true', 'yes', 'on')


# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'django-insecure-change-me-in-env')

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env_bool('DJANGO_DEBUG', True)

ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')
    if host.strip()
]


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Terceros
    'rest_framework',
    'corsheaders',

    # Apps propias
    'apps.autenticacion',
    'apps.seguridad',
    'apps.configuraciones',
    'apps.historial',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    # Sirve STATIC_ROOT directo desde gunicorn (comprimido + con cache headers), sin
    # depender de `runserver`/DEBUG=True ni de un volumen compartido con nginx: nginx solo
    # tiene que proxyear /static/ al backend (ver nginx/nginx.conf), no servir archivos él
    # mismo. Necesario para que el admin de Django tenga CSS/JS detrás de nginx.
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'apps.autenticacion.middleware.FreeApiMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# Database
# https://docs.djangoproject.com/en/6.0/ref/settings/#databases
# Siempre Postgres: en producción vía DATABASE_URL (Supabase, en .env); en
# desarrollo local, el Postgres levantado por compose.dev.yml (mismo valor
# por defecto).

DATABASE_URL = os.getenv(
    'DATABASE_URL',
    'postgresql://gastos_ingresos:gastos_ingresos_pass@localhost:5432/gastos_ingresos_local',
)

DATABASES = {
    'default': dj_database_url.parse(DATABASE_URL, conn_max_age=600)
}


AUTH_USER_MODEL = 'autenticacion.User'


# Password validation
# https://docs.djangoproject.com/en/6.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Django REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'apps.autenticacion.permissions.IsAuthenticatedOrFreeApi',
    ],
    # Sin esto, DRF expone por default BrowsableAPIRenderer/AdminRenderer: una consola HTML
    # interactiva de la API (con formularios para probar cada endpoint) en cualquier request
    # que pida text/html — nadie del frontend la usa (siempre pide JSON), y AdminRenderer
    # tuvo una falla real (CVE PYSEC-2026-3828, ya parcheada en la versión de DRF que usamos,
    # pero exponer una consola de administración de la API en producción no es buena
    # práctica de por sí, con o sin ese bug puntual).
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_THROTTLE_RATES': {
        # Límite de intentos de login por IP; el bloqueo de cuenta (User.is_locked)
        # es la segunda capa de defensa contra fuerza bruta.
        'login': '5/min',
        # Límite de registros por IP, para frenar creación masiva de cuentas.
        'register': '10/hour',
        # Límite de solicitudes de recuperación/reseteo de contraseña por IP.
        'password_reset': '5/hour',
        # Límite de cambios de contraseña (usuario ya logueado) por IP.
        'change_password': '10/hour',
        # Límite de intentos de código (verificación de email o reset de contraseña) por IP.
        # Defensa adicional a MAX_ATTEMPTS de VerificationCode, que limita por código individual.
        'email_verify_confirm': '10/min',
        # Límite de reenvíos de código por IP; el cooldown real (por usuario) vive en
        # VerificationCode.has_recent_active, esto es una segunda capa por IP.
        'email_verify_resend': '3/hour',
    },
}


# CORS
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000').split(',')
    if origin.strip()
]
# El login usa sesión por cookie: el frontend debe poder enviarla en peticiones cross-origin.
CORS_ALLOW_CREDENTIALS = True

# Orígenes de confianza para CSRF (requerido por Django cuando el frontend está en otro
# origen/puerto que el backend, ej. localhost:3000 -> localhost:8000).
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.getenv('CSRF_TRUSTED_ORIGINS', 'http://localhost:3000').split(',')
    if origin.strip()
]

# Cookies de sesión / CSRF
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')
SESSION_COOKIE_SECURE = env_bool('SESSION_COOKIE_SECURE', not DEBUG)
CSRF_COOKIE_SAMESITE = os.getenv('CSRF_COOKIE_SAMESITE', 'Lax')
CSRF_COOKIE_SECURE = env_bool('CSRF_COOKIE_SECURE', not DEBUG)
SESSION_COOKIE_AGE = int(os.getenv('SESSION_COOKIE_AGE', 60 * 60 * 8))  # 8 horas
SESSION_SAVE_EVERY_REQUEST = True

# HTTPS hardening — todo apagado por default (no cambia nada en dev/tests/docker-compose.dev
# sin TLS): activar recién cuando haya un dominio real con certificado. Corresponden a los
# warnings W004/W008 de `manage.py check --deploy`; SESSION_COOKIE_SECURE/CSRF_COOKIE_SECURE
# (W012/W016) ya estaban resueltos arriba (atados a DEBUG desde antes de este cambio).
#
# SECURE_SSL_REDIRECT en True sin TLS real corta el tráfico (nginx hoy sirve HTTP plano) o
# entra en loop de redirección si el proxy no manda X-Forwarded-Proto correctamente.
SECURE_SSL_REDIRECT = env_bool('DJANGO_SECURE_SSL_REDIRECT', False)

# Sin esto, detrás de un proxy que termina TLS (nginx) Django ve todo tráfico como HTTP
# plano (request.is_secure() siempre False) — rompería SECURE_SSL_REDIRECT en loop y el
# navegador nunca mandaría las cookies "Secure". Ojo: esto CONFÍA en el header
# X-Forwarded-Proto tal cual llega — solo activar cuando ese proxy en verdad lo sobreescribe
# en cada request (nginx/nginx.conf ya lo hace: `proxy_set_header X-Forwarded-Proto $scheme`).
# Si Django alguna vez queda expuesto directo, SIN ese proxy adelante, esto dejaría que
# cualquiera falsifique "conexión segura" mandando ese header a mano.
if env_bool('DJANGO_TRUST_PROXY_SSL_HEADER', False):
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# HSTS en 0 (apagado) hasta tener TLS real: un valor alto puesto por error obliga a los
# navegadores a rechazar HTTP plano para este host durante ese tiempo, sin forma de
# revertirlo rápido del lado del cliente si algo salió mal con el certificado.
SECURE_HSTS_SECONDS = int(os.getenv('DJANGO_SECURE_HSTS_SECONDS', '0'))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool('DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS', False)
SECURE_HSTS_PRELOAD = env_bool('DJANGO_SECURE_HSTS_PRELOAD', False)


# Supabase (uso opcional del SDK además de la conexión directa a Postgres)
SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_KEY = os.getenv('SUPABASE_KEY', '')


# Email (códigos de verificación de cuenta y recuperación de contraseña)
# En dev, por defecto imprime el correo en la consola/logs del backend en vez de enviarlo.
EMAIL_BACKEND = os.getenv('EMAIL_BACKEND', 'django.core.mail.backends.console.EmailBackend')
EMAIL_HOST = os.getenv('EMAIL_HOST', '')
EMAIL_PORT = int(os.getenv('EMAIL_PORT', 587))
EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = env_bool('EMAIL_USE_TLS', True)
DEFAULT_FROM_EMAIL = os.getenv('DEFAULT_FROM_EMAIL', 'no-reply@gastos-ingresos.local')

# Códigos de verificación de 6 dígitos (email al registrarse, reset de contraseña). Ver
# apps.autenticacion.models.VerificationCode.
VERIFICATION_CODE_TTL_MINUTES = int(os.getenv('VERIFICATION_CODE_TTL_MINUTES', 10))
VERIFICATION_RESEND_COOLDOWN_SECONDS = int(os.getenv('VERIFICATION_RESEND_COOLDOWN_SECONDS', 60))


# Internationalization
# https://docs.djangoproject.com/en/6.0/topics/i18n/

LANGUAGE_CODE = 'es'

TIME_ZONE = 'America/Lima'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.0/howto/static-files/

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    # CompressedManifestStaticFilesStorage: nombra cada archivo con un hash de su contenido
    # (cache-busting automático en cada deploy) y sirve la versión .gz/.br cuando el
    # navegador la acepta. Requiere `collectstatic` en el build de la imagen (ver Dockerfile).
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# Celery (worker de segundo plano para las validaciones de importación de Excel — ver
# apps.configuraciones.tasks). Antes corrían en un threading.Thread dentro del propio
# proceso web: no sobrevivía un restart/deploy del contenedor ni escalaba horizontalmente.
# Redis como broker (y como result backend, aunque hoy no se consulta: el avance/resultado
# del job se seguye leyendo de CategoriaImportJob/MonedaImportJob/CuentaImportJob en la
# base de datos, no de Celery).
CELERY_BROKER_URL = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')
CELERY_RESULT_BACKEND = os.getenv('CELERY_RESULT_BACKEND', CELERY_BROKER_URL)
CELERY_TASK_SERIALIZER = 'json'
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TIMEZONE = TIME_ZONE
# Comportamiento actual de Celery (reintentar conectar al broker si no está listo todavía
# al arrancar) — sin esto, Celery 6 lo va a apagar por default y el worker no va a
# reintentar si Redis tarda en levantar (p.ej. al arrancar todo el stack junto).
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True


# Logging — antes no había ningún LOGGING configurado acá: todos los logger.info/warning/
# error que ya existen en el código (login fallido, cuenta bloqueada, importaciones, etc.,
# ver p.ej. apps/autenticacion/views.py) caían al logger raíz de Django sin ningún formato
# explícito. A consola (no a archivo): en Docker, gunicorn/runserver/celery ya mandan stdout
# a `docker logs` — un archivo adentro del contenedor se perdería en cada restart/deploy y
# necesitaría su propio volumen para nada.
LOG_LEVEL = os.getenv('DJANGO_LOG_LEVEL', 'INFO')

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{asctime} {levelname} {name} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': LOG_LEVEL,
    },
    'loggers': {
        # WARNING (no LOG_LEVEL): en INFO, django.db loguea cada query ejecutada — demasiado
        # ruido para uso normal. Subir a DEBUG con DJANGO_DB_LOG_LEVEL solo para diagnosticar
        # algo puntual.
        'django': {
            'handlers': ['console'],
            'level': os.getenv('DJANGO_DB_LOG_LEVEL', 'WARNING'),
            'propagate': False,
        },
        # Cubre a todos los logger = logging.getLogger(__name__) de "apps.*" por jerarquía
        # de nombres (apps.autenticacion.views, apps.configuraciones.categoria.views, etc.)
        # sin tener que declarar cada módulo a mano.
        'apps': {
            'handlers': ['console'],
            'level': LOG_LEVEL,
            'propagate': False,
        },
    },
}
