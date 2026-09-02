import uuid
from django.conf import settings
from django.db import models

# Create your models here.
class StatusTypes(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True, blank=False, null=False)
    description = models.TextField(blank=True, null=True)
    
    class Meta:
        db_table = "cfg_status_types"

    def __str__(self):
        return self.name


class Status(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key_status_type = models.ForeignKey(StatusTypes, null=True, blank=True, on_delete=models.RESTRICT)
    name = models.TextField(null=True, blank=True)
    abbreviation = models.TextField(null=True, blank=True)
    action = models.TextField(null=True, blank=True)
    color = models.TextField(null=True, blank=True)
    icon = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "cfg_status"

    def __str__(self):
        return f"{self.name} - {self.key_status_type.name if self.key_status_type else ''}"


class BaseModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key_status = models.ForeignKey(Status, null=True, blank=True, on_delete=models.RESTRICT, related_name="+")
    key_creator_user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.RESTRICT, related_name="+")
    key_updater_user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.RESTRICT, related_name="+")
    creation_date = models.DateTimeField(auto_now_add=True)
    update_date = models.DateTimeField(auto_now=True)
    
    class Meta:
        abstract = True


class System(BaseModel):
    name = models.CharField(max_length=100, unique=True, blank=False, null=False)
    description = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "cfg_system"


# Cada entidad de "Configuraciones" (Categorías, y a futuro Cuentas/Monedas/etc.) tiene su
# propia subcarpeta acá adentro (models.py/views.py/urls.py/serializers.py/message.py/
# constants.py) para no amontonar todo en estos archivos de nivel superior — pero siguen
# siendo parte de esta misma app Django (mismo app_label "configuraciones", una sola
# carpeta migrations/), así que sus modelos se reexportan acá. Import al final del archivo
# (no arriba) porque categoria/models.py importa BaseModel desde acá: para cuando Python
# llega a esta línea, BaseModel ya está definido en este módulo, así que el import
# circular se resuelve sin problema.
from .categoria.models import Categoria, CategoriaImportJob, TipoCategoria  # noqa: E402,F401