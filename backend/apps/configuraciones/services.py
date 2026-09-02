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
