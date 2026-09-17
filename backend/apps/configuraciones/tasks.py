"""Tasks de Celery del módulo Configuraciones — un wrapper delgado por entidad
(Categorías/Monedas/Cuentas) que decodifica el archivo y delega en la función real
(run_*_import_validation_job_body, en cada <entidad>/views.py).

Vive en la raíz de la app (no en categoria/moneda/cuenta) porque Celery autodescubre
tasks.py por app de INSTALLED_APPS (ver config/celery.py: app.autodiscover_tasks() sin
argumentos busca "<app>.tasks", no subpaquetes) — apps.configuraciones ES la entrada de
INSTALLED_APPS, categoria/moneda/cuenta no lo son.

Los imports a <entidad>.views son diferidos (dentro de cada función, no al tope del
archivo) a propósito: cada views.py importa su task de acá para encolarla con .delay(),
así que importar views.py acá arriba armaría un ciclo. Para cuando estas funciones
corren de verdad (en el worker, no al cargar el módulo), ese ciclo ya no existe.
"""

import base64

from celery import shared_task


@shared_task(name="configuraciones.categorias.import_validation")
def run_categorias_import_validation_job(job_id: str, file_bytes_b64: str, user_id: str) -> None:
    from .categoria.views import run_categorias_import_validation_job_body

    run_categorias_import_validation_job_body(job_id, base64.b64decode(file_bytes_b64), user_id)


@shared_task(name="configuraciones.monedas.import_validation")
def run_monedas_import_validation_job(job_id: str, file_bytes_b64: str, user_id: str) -> None:
    from .moneda.views import run_monedas_import_validation_job_body

    run_monedas_import_validation_job_body(job_id, base64.b64decode(file_bytes_b64), user_id)


@shared_task(name="configuraciones.cuentas.import_validation")
def run_cuentas_import_validation_job(job_id: str, file_bytes_b64: str, user_id: str) -> None:
    from .cuenta.views import run_cuentas_import_validation_job_body

    run_cuentas_import_validation_job_body(job_id, base64.b64decode(file_bytes_b64), user_id)
