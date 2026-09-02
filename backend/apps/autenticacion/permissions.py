from rest_framework.permissions import BasePermission


class IsAuthenticatedOrFreeApi(BasePermission):
    """Igual que IsAuthenticated, salvo en las rutas listadas en FREE_APIS.

    request.is_free_api lo setea apps.autenticacion.middleware.FreeApiMiddleware.
    """

    def has_permission(self, request, view):
        if getattr(request, "is_free_api", False):
            return True
        return bool(request.user and request.user.is_authenticated)
