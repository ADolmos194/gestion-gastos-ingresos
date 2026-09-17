from django.db import connection

from .models import Status

# Nombres de status tal como los define cfg_status (ver seed_statuses.json). Se resuelven
# por nombre en vez de hardcodear el UUID, mismo criterio que apps.seguridad.services.
ACTIVE_STATUS_NAME = "Activo"
VOIDED_STATUS_NAME = "Anulado"
# Distinto de Anulado: un nombre Anulado no bloquea crear uno nuevo con ese mismo nombre (ni
# se reactiva por eso), pero uno Inactivo sí bloquea — y si coincide en una importación, ese
# registro Inactivo se reactiva en vez de crear uno nuevo (ver categoria/views.py).
INACTIVE_STATUS_NAME = "Inactivo"

# Estados de un CategoriaImportJob (o cualquier otro job en segundo plano futuro) — mismo
# catálogo compartido cfg_status/cfg_status_types que usa el resto del sistema, en vez de
# un CharField con choices propio.
JOB_PROCESSING_STATUS_NAME = "Procesando"
JOB_DONE_STATUS_NAME = "Completado"
JOB_ERROR_STATUS_NAME = "Error"


def get_status_by_name(name: str) -> Status:
    return Status.objects.get(name=name)


def lock_duplicate_guard(table_name: str, user_id, value: str) -> None:
    """Advisory lock de Postgres para cerrar la ventana de carrera en crear/renombrar con
    nombre o código único (Categoria/Moneda/Cuenta, ver _find_blocking_duplicate en cada
    views.py): esa función hace un SELECT antes del INSERT/UPDATE, así que dos requests
    concurrentes (doble clic, dos pestañas) pueden pasar la validación los dos y terminar
    creando dos filas "duplicadas". No hay UniqueConstraint de base que lo evite a propósito
    (un status Anulado no bloquea, ver comentario en cada models.py), así que hace falta
    serializar a mano.

    pg_advisory_xact_lock() bloquea si otra transacción ya tiene el mismo lock (mismo
    usuario+tabla+valor normalizado) hasta que esa transacción termine (commit o rollback) —
    momento en el que ya escribió (o no) la fila, así que el SELECT que se hace DESPUÉS de
    este lock (no antes) ve el estado real y actualizado. Se libera solo, no hace falta
    un unlock explícito (de ahí el sufijo _xact_).

    Debe llamarse DENTRO de la misma transaction.atomic() que hace el SELECT+INSERT/UPDATE,
    y ANTES del SELECT — si se llama después, la ventana de carrera ya pasó.
    """
    key = f"{table_name}:{user_id}:{value.strip().lower()}"
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [key])
