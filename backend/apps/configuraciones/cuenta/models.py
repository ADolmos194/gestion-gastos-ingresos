from django.conf import settings
from django.db import models

from ..models import BaseModel
from ..moneda.models import Moneda


class TipoCuenta(BaseModel):
    name = models.CharField(max_length=50, unique=True, blank=False, null=False)
    description = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "cfg_tipo_cuentas"

    def __str__(self):
        return self.name


class Cuenta(BaseModel):
    key_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.RESTRICT, related_name="cuentas")
    key_tipo = models.ForeignKey(TipoCuenta, on_delete=models.RESTRICT, related_name="cuentas")
    key_moneda = models.ForeignKey(Moneda, on_delete=models.RESTRICT, related_name="cuentas")
    name = models.CharField(max_length=100)
    account_number = models.CharField(max_length=50, blank=True, null=True)
    titular_name = models.CharField(max_length=150, blank=True, null=True)

    class Meta:
        db_table = "cfg_cuentas"
        # Sin UniqueConstraint acá a propósito, mismo criterio que Categoria/Moneda (ver
        # categoria/models.py): la unicidad de "name" por usuario se valida a mano en las
        # vistas (_find_blocking_duplicate), porque un nombre Anulado no bloquea crear uno
        # nuevo con ese mismo nombre.

    def __str__(self):
        return f"{self.name} ({self.key_tipo.name if self.key_tipo else ''})"


class CuentaImportJob(BaseModel):
    """Estado de una validación de importación de cuentas corriendo en un worker de Celery
    aparte — mismo criterio que CategoriaImportJob/MonedaImportJob (ver categoria/models.py)."""

    key_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    total_rows = models.PositiveIntegerField(null=True, blank=True)
    processed_rows = models.PositiveIntegerField(default=0)
    result = models.JSONField(null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "cfg_cuenta_import_jobs"
