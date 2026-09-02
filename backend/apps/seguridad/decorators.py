from functools import wraps

from django.http import JsonResponse

from .services import ALL_PERMISSIONS_BACK, build_user_access


def log_data_access(view_func):
    """Marca la vista como generadora de historial de acceso a datos.

    Hoy es solo un marcador (igual que en el proyecto de referencia atlas_backend): no
    escribe nada por sí mismo. El registro real de creaciones/ediciones lo hacen los
    helpers de apps.historial.services, llamados a mano desde cada vista que modifica
    datos — así el detalle de qué cambió (columna/antes/después) sale del lugar que
    sabe qué cambió, no de un wrapper genérico.
    """

    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        return view_func(request, *args, **kwargs)

    _wrapped._log_data_access = True
    return _wrapped


def require_permission(decorator_name=None):
    """Equivalente function-based de HasBackendPermission (ver apps.seguridad.permissions):
    exige sesión activa y, si se indica decorator_name, que el usuario tenga ese permiso
    (Permission.decorator_name) o el comodín ALL_PERMISSIONS_BACK.

    Uso:

        @require_permission(constants.PERM_READ)
        @api_view(["GET"])
        def list_categorias(request): ...

    Devuelve JsonResponse (no levanta excepción DRF) porque corre ANTES de que @api_view
    arme el ciclo de request/exception de DRF: los decoradores se aplican de adentro hacia
    afuera, así que para cuando este decorador ve el request, @api_view todavía no armó su
    Request ni su manejo de excepciones — una excepción DRF lanzada acá no la atraparía
    nadie. request.user ya está resuelto por AuthenticationMiddleware (sesión por cookie),
    así que no hace falta resolverlo a mano.
    """

    def decorator(view_func):
        @wraps(view_func)
        def _wrapped(request, *args, **kwargs):
            user = request.user
            if not user or not user.is_authenticated:
                return JsonResponse({"detail": "Authentication credentials were not provided."}, status=401)

            if decorator_name:
                access = build_user_access(user)
                if ALL_PERMISSIONS_BACK not in access.permisos_back and decorator_name not in access.permisos_back:
                    return JsonResponse({"detail": "No tenés permiso para realizar esta acción."}, status=403)

            return view_func(request, *args, **kwargs)

        return _wrapped

    return decorator
