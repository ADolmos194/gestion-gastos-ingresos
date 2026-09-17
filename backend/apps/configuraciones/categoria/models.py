from django.conf import settings
from django.db import models

from ..models import BaseModel


class TipoCategoria(BaseModel):
    name = models.CharField(max_length=50, unique=True, blank=False, null=False)
    description = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "cfg_tipo_categorias"

    def __str__(self):
        return self.name


class Categoria(BaseModel):
    key_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT, related_name="categorias")
    key_tipo = models.ForeignKey(TipoCategoria, on_delete=models.RESTRICT, related_name="categorias")
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    color = models.CharField(max_length=20, blank=True, null=True)
    icon = models.CharField(max_length=100, blank=True, null=True)

    class Meta:
        db_table = "cfg_categorias"
        # Sin UniqueConstraint acá a propósito: la unicidad de "name" por usuario se valida
        # a mano en las vistas (_find_blocking_duplicate en views.py), no a nivel de base de
        # datos — porque la regla no es "nombre único, punto": un nombre Anulado no bloquea
        # crear uno nuevo con ese mismo nombre (ver views.py, mismo criterio para
        # crear/editar/importar), algo que una constraint plana de la base no puede expresar
        # sin condicionarla al status, y ese status no es fijo en tiempo de migración.

    def __str__(self):
        return f"{self.name} ({self.key_tipo.name if self.key_tipo else ''})"


class CategoriaImportJob(BaseModel):
    """Estado de una validación de importación de categorías corriendo en un worker de
    Celery aparte (ver apps.configuraciones.tasks.run_categorias_import_validation_job) —
    permite que el frontend consulte el avance real (fila a fila) en vez de esperar a
    ciegas la respuesta de un solo request largo.

    El estado (Procesando/Completado/Error) usa el mismo catálogo compartido key_status de
    BaseModel (cfg_status/cfg_status_types) que el resto del sistema — ver
    JOB_PROCESSING_STATUS_NAME/JOB_DONE_STATUS_NAME/JOB_ERROR_STATUS_NAME en
    apps.configuraciones.services, mismo criterio que ACTIVE_STATUS_NAME/VOIDED_STATUS_NAME.
    """

    key_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    total_rows = models.PositiveIntegerField(null=True, blank=True)
    processed_rows = models.PositiveIntegerField(default=0)
    result = models.JSONField(null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "cfg_categoria_import_jobs"
