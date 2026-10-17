#!/usr/bin/env bash
#
# Backup cifrado de la base de datos del stack Qullqi (Postgres en Docker).
#
# Qué hace:
#   1. pg_dump del servicio `postgres` de docker compose (la base PRODUCCIÓN del stack,
#      no la dev de backend/compose.dev.yml).
#   2. Lo comprime con gzip y lo CIFRA con openssl (aes-256-cbc) — en disco y en copias
#      fuera de la máquina el backup va encima de AES-256, no en claro.
#   3. Guarda con timestamp en ./backups y rota: conserva las últimas BACKUP_KEEP (14).
#
# La clave NO queda en el archivo ni en el repo: se toma de backend/.env
# (BACKUP_ENCRYPTION_PASSPHRASE) o de la variable de entorno del mismo nombre. Si no está
# definida, el script se niega a correr (fail-safe: nunca escribir un backup en claro).
#
# Uso:
#   scripts/backup_db.sh                  # un backup ahora
#   BACKUP_KEEP=30 scripts/backup_db.sh   # rotación custom
#
# Cron sugerido (diario 03:00, America/Lima):
#   0 3 * * *  cd /ruta/al/stack && scripts/backup_db.sh >> backups/backup.log 2>&1

set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/.."
BACKUP_DIR="${BACKUP_DIR:-$DIR/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
COMPOSE="${COMPOSE:-docker compose}"

mkdir -p "$BACKUP_DIR"

# Cargar backend/.env si existe (ahí viven las credenciales reales del stack). NO se hace
# source del archivo entero (DJANGO_SECRET_KEY trae caracteres que rompen el parser de
# bash/git-bash): se extraen solo las variables que este script necesita. Las definidas en
# el entorno del shell tienen prioridad.
BACKEND_ENV="$DIR/backend/.env"
COMPOSE_ENV_FILE=()
if [[ -f "$BACKEND_ENV" ]]; then
  get_env() { grep -E "^$1=" "$BACKEND_ENV" | tail -n1 | cut -d= -f2-; }
  DB_NAME="${DB_NAME:-$(get_env DB_NAME)}"
  DB_USER="${DB_USER:-$(get_env DB_USER)}"
  DB_PASSWORD="${DB_PASSWORD:-$(get_env DB_PASSWORD)}"
  BACKUP_ENCRYPTION_PASSPHRASE="${BACKUP_ENCRYPTION_PASSPHRASE:-$(get_env BACKUP_ENCRYPTION_PASSPHRASE)}"
  # docker compose necesita el mismo .env para interpolar REDIS_PASSWORD/etc. al parsear
  # el archivo — sin esto falla con "required variable REDIS_PASSWORD is missing".
  COMPOSE_ENV_FILE=(--env-file "$BACKEND_ENV")
fi

DB_NAME="${DB_NAME:-gastos_ingresos}"
DB_USER="${DB_USER:-gastos_ingresos}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD debe definirse en backend/.env o en el entorno}"
PASSPHRASE="${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE debe definirse (en backend/.env o en el entorno): sin clave no se escribe un backup en claro}"

STAMP="$(date +%Y%m%d_%H%M%S)"
DUMP="$BACKUP_DIR/qullqi_${STAMP}.sql.gz"
ENC="$DUMP.aes256"

CLEANUP_FILE="$DUMP"
cleanup() { [[ -n "${CLEANUP_FILE:-}" && -f "$CLEANUP_FILE" ]] && rm -f -- "$CLEANUP_FILE"; }
trap cleanup EXIT

echo "==> Backup $STAMP"
PGPASSWORD="$DB_PASSWORD" $COMPOSE "${COMPOSE_ENV_FILE[@]}" exec -T postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner | gzip > "$DUMP"

# La clave se pasa por env (no por -pass pass:..., que la deja visible en el listado de
# procesos). La asignación inline exporta PASSPHRASE solo para este comando.
PASSPHRASE="$BACKUP_ENCRYPTION_PASSPHRASE" openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
  -pass env:PASSPHRASE -in "$DUMP" -out "$ENC"

CLEANUP_FILE=""
rm -f -- "$DUMP"

echo "==> Cifrado OK: $ENC ($(du -h "$ENC" | cut -f1))"

# Rotación: borrar backups viejos (deja el más reciente intacto).
ls -1t "$BACKUP_DIR"/qullqi_*.sql.gz.aes256 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | while read -r old; do
  echo "   rotación: borrado $old"
  rm -f -- "$old"
done

echo "==> Listo. Últimos backups:"
ls -1t "$BACKUP_DIR"/qullqi_*.sql.gz.aes256 2>/dev/null | head -"$BACKUP_KEEP" | sed 's/^/   /'

# Uso:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -in qullqi_*.sql.gz.aes256 | gunzip > qullqi.sql
echo "   (restaurar: openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -in <backup> | gunzip > dump.sql)"