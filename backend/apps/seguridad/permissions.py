from rest_framework.permissions import BasePermission

from .services import ALL_PERMISSIONS_BACK, build_user_access


class HasBackendPermission(BasePermission):
    """Exige que el usuario autenticado tenga el permiso (Permission.decorator_name) que
    la vista declara en `required_permission`, resuelto vía
    apps.seguridad.services.build_user_access (mismo cálculo que arma permisos_back para
    el frontend, así front y back nunca quedan desincronizados sobre qué puede hacer un
    usuario).

    Uso en una vista:

        class CategoriaListView(APIView):
            permission_classes = [IsAuthenticated, HasBackendPermission]
            required_permission = "Comr_Conf_Categorias_read"

    Un rol con Role.all_access=True (ALL_PERMISSIONS) pasa cualquier `required_permission`
    sin excepción. Si la vista no declara `required_permission`, esta clase no restringe
    nada (para no bloquear por accidente vistas que todavía no optaron por este esquema).

    Importante: esto NUNCA reemplaza al chequeo del lado del cliente (ver
    RequireMenuAccess en el frontend) — es al revés, este es el que de verdad importa,
    porque el frontend se puede inspeccionar/editar desde las devtools.
    """

    def has_permission(self, request, view):
        required_permission = getattr(view, "required_permission", None)
        if not required_permission:
            return True

        user = request.user
        if not user or not user.is_authenticated:
            return False

        access = build_user_access(user)
        return ALL_PERMISSIONS_BACK in access.permisos_back or required_permission in access.permisos_back
