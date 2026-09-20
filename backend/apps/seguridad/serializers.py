from rest_framework import serializers

from .models import Menu, Permission, Role


class RoleSerializer(serializers.ModelSerializer):
    status = serializers.CharField(source="key_status.name", read_only=True)
    # El frontend compara esto contra VITE_STATUS_ACTIVATE (ver frontend/.env) para saber
    # si pintar la celda de Estado en verde, mismo criterio que el resto de la app.
    status_id = serializers.UUIDField(source="key_status_id", read_only=True)

    class Meta:
        model = Role
        fields = ["id", "name", "description", "all_access", "status", "status_id", "creation_date", "update_date"]
        read_only_fields = ["id", "status", "status_id", "creation_date", "update_date"]


class PermissionSerializer(serializers.ModelSerializer):
    """Solo lectura: un Permission solo tiene efecto real si hay un
    @require_permission(decorator_name) en algún views.py del backend — crear uno nuevo
    desde acá no gatillaría ningún chequeo, así que no tiene sentido exponer un CRUD."""

    action_name = serializers.CharField(source="key_action.name", read_only=True, default=None)
    status = serializers.CharField(source="key_status.name", read_only=True)

    class Meta:
        model = Permission
        fields = ["id", "decorator_name", "module_name", "api_url", "action_name", "status"]
        read_only_fields = fields


class MenuSerializer(serializers.ModelSerializer):
    """Solo lectura, mismo motivo que PermissionSerializer: un Menu solo lleva a algo real
    si el frontend ya tiene una página registrada en pageRoutes (ver
    frontend/src/lib/page-routes.tsx) para ese router_to."""

    status = serializers.CharField(source="key_status.name", read_only=True)

    class Meta:
        model = Menu
        fields = ["id", "subject", "title", "icon", "router_to", "ordering", "key_father_menu", "status"]
        read_only_fields = fields
