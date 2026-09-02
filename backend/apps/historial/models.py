import uuid

from django.conf import settings
from django.db import models


class Historial(models.Model):
    """Un evento de auditoría (crear/editar/anular/importar un registro de negocio).

    No hereda de apps.configuraciones.models.BaseModel a propósito: un registro de
    auditoría es inmutable (no tiene sentido que tenga su propio key_status, ni un
    key_creator_user/key_updater_user distinto de key_usuario).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    evento = models.CharField(max_length=50)
    modulo = models.CharField(max_length=100)
    nom_tabla = models.CharField(max_length=100)
    # str(pk) del registro afectado — sin esto no se podría saber qué fila cambió,
    # solo en qué tabla, y no se podría consultar el historial de un registro puntual.
    key_record = models.CharField(max_length=64)
    key_usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.RESTRICT, related_name="historiales"
    )
    fecha_hora = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "his_historial"
        indexes = [models.Index(fields=["nom_tabla", "key_record"])]

    def __str__(self):
        return f"{self.evento} - {self.nom_tabla} - {self.key_record}"


class HistorialDetalle(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key_historial = models.ForeignKey(Historial, on_delete=models.CASCADE, related_name="detalles")
    columna = models.CharField(max_length=100)
    dato_antiguo = models.TextField(blank=True, null=True)
    dato_nuevo = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "his_historial_detalle"

    def __str__(self):
        return f"{self.columna}: {self.dato_antiguo!r} -> {self.dato_nuevo!r}"
