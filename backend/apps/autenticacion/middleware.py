# Rutas de la API que no requieren una sesión activa.
# Cada entrada es un prefijo de path: cualquier URL que comience así se considera libre.
FREE_APIS = (
    "/api/auth/csrf/",
    "/api/auth/login/",
    "/api/auth/register/",
    "/api/auth/forgot-password/",
    "/api/auth/reset-password/",
    "/api/auth/verify-email/",
    "/api/auth/resend-verification/",
    # /api/auth/refresh/ NO está aquí a propósito: requiere sesión activa
    # (no hay token anónimo que refrescar, ver RefreshSessionView).
)


def is_free_api(path):
    return any(path.startswith(route) for route in FREE_APIS)


class FreeApiMiddleware:
    """Marca si el path solicitado corresponde a una API libre (pública).

    No bloquea nada por sí solo: apps.autenticacion.permissions.IsAuthenticatedOrFreeApi
    lee request.is_free_api para decidir si exige un usuario autenticado.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.is_free_api = is_free_api(request.path)
        return self.get_response(request)
