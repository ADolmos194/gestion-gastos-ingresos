FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# collectstatic no necesita una base de datos viva (solo lee STATICFILES_* de settings.py),
# así que corre acá en el build, no en cada arranque del contenedor. DJANGO_SECRET_KEY no
# hace falta real para esto (settings.py ya trae un default), pero DATABASE_URL sí debe
# poder parsearse — dj_database_url.parse() no abre conexión, solo arma la config.
RUN python manage.py collectstatic --noinput

# La imagen se ejecuta como usuario sin privilegios en todos los servicios que la usan
# (web y worker, ver docker-compose.yml): gunicorn/celery no necesitan root para nada.
RUN addgroup --system app && adduser --system --ingroup app --home /home/app app \
    && chown -R app:app /app
USER app

EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
