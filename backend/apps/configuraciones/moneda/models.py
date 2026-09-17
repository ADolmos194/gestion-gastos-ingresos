from django.conf import settings
from django.db import models

from ..models import BaseModel


class Moneda(BaseModel):
    key_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT, related_name="monedas")
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=10)
    symbol = models.CharField(max_length=10, blank=True, null=True)
    description = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "cfg_monedas"
        # Mismo criterio que Categoria (ver categoria/models.py): sin UniqueConstraint acá a
        # propósito. La unicidad de "code" por usuario se valida a mano en las vistas
        # (_find_blocking_duplicate en views.py) porque un código Anulado no bloquea crear
        # uno nuevo con ese mismo código, algo que una constraint plana no puede expresar.

    def __str__(self):
        return f"{self.code} - {self.name}"


class MonedaImportJob(BaseModel):
    """Estado de una validación de importación de monedas corriendo en un worker de Celery
    aparte — mismo criterio que CategoriaImportJob (ver categoria/models.py): permite que el
    frontend consulte el avance real (fila a fila) en vez de esperar a ciegas la
    respuesta de un solo request largo."""

    key_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    total_rows = models.PositiveIntegerField(null=True, blank=True)
    processed_rows = models.PositiveIntegerField(default=0)
    result = models.JSONField(null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "cfg_moneda_import_jobs"
