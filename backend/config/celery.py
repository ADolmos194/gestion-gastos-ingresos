import os

from celery import Celery

# Igual que manage.py: sin esto, Celery no sabe qué settings de Django cargar cuando el
# worker arranca como proceso aparte (no pasa por manage.py).
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("config")
# namespace="CELERY": todas las opciones de Celery en settings.py van prefijadas
# CELERY_* (CELERY_BROKER_URL, etc.), para no mezclarse con el resto de settings de Django.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Autodescubre tasks.py en cada app de INSTALLED_APPS (ver apps.configuraciones.tasks) —
# tanto el proceso web como el worker importan este módulo (ver __init__.py), así que
# .delay() y la ejecución real de la task siempre ven las mismas tasks registradas.
app.autodiscover_tasks()
