import uuid
from django.conf import settings
from django.db import models
from apps.configuraciones.models import BaseModel, System
# Create your models here.



class BaseModelWithDescription(BaseModel):
    description = models.TextField(null=True, blank=True)

    class Meta:
        abstract = True



class Event(BaseModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True, blank=False, null=False)
    description = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "sec_events"


class Action(BaseModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True, blank=False, null=False)
    description = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "sec_actions"


class Permission(BaseModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    decorator_name = models.CharField(max_length=100, unique=True, blank=False, null=False)
    api_url = models.CharField(max_length=100, unique=True, blank=False, null=False)
    module_name = models.CharField(max_length=100, unique=True, blank=False, null=False)
    key_action = models.ForeignKey(Action, null=True, blank=True, on_delete=models.RESTRICT)


    class Meta:
        db_table = "sec_permissions"


class Role(BaseModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True, blank=False, null=False)
    description = models.TextField(blank=True, null=True)
    # True = acceso total: ve todo el menú y todos los permisos, sin pasar por
    # RoleMenu/PermissionRole. Ver apps.seguridad.services.build_user_access.
    all_access = models.BooleanField(default=False)

    class Meta:
        db_table = "sec_roles"

class UserRole(BaseModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key_user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.RESTRICT)
    key_role = models.ForeignKey(Role, null=True, blank=True, on_delete=models.RESTRICT)

    class Meta:
        db_table = "sec_user_roles"


class PermissionRole(BaseModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key_permission = models.ForeignKey(Permission, null=True, blank=True, on_delete=models.RESTRICT)
    key_role = models.ForeignKey(Role, null=True, blank=True, on_delete=models.RESTRICT)

    class Meta:
        db_table = "sec_permission_roles"


class PermissionSystem(BaseModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key_permission = models.ForeignKey(Permission, null=True, blank=True, on_delete=models.RESTRICT)
    key_system = models.ForeignKey(System, null=True, blank=True, on_delete=models.RESTRICT)

    class Meta:
        db_table = "sec_permission_systems"


class Menu(BaseModelWithDescription):
    subject = models.TextField(unique=True, null=True, max_length=255)
    title = models.TextField(null=True, max_length=255)
    translated_title_key = models.TextField(null=True, max_length=255)
    icon = models.TextField(null=True, max_length=255)
    router_to = models.TextField(null=True, max_length=255)
    ordering = models.IntegerField(null=False, blank=False, default=1)
    key_father_menu = models.ForeignKey("self", null=True, on_delete=models.RESTRICT)
    key_system = models.ForeignKey(
        System, null=True, on_delete=models.RESTRICT, related_name="seguridad_%(class)s"
    )

    class Meta:
        db_table = "sec_menu"

    def __str__(self):
        system_name = self.key_system.name if self.key_system else "Sin sistema"
        return f"{system_name} - ({self.ordering}) {self.title} - {self.subject}"
    
class RoleMenu(BaseModelWithDescription):
    key_role = models.ForeignKey(Role, null=True, on_delete=models.RESTRICT)
    key_menu = models.ForeignKey(Menu, null=True, on_delete=models.RESTRICT)

    class Meta:
        db_table = "sec_role_menu"
        constraints = [models.UniqueConstraint(fields=["key_role", "key_menu"], name="unique_role_menu")]

    def __str__(self):
        role_name = self.key_role.name if self.key_role else "No role"
        menu_subject = self.key_menu.subject if self.key_menu else "No menu"
        system_name = self.key_menu.key_system.name if self.key_menu and self.key_menu.key_system else "No system"
        return f"{system_name} - {menu_subject} - {role_name}"