from django.urls import include, path

app_name = "configuraciones"

# Cada entidad de este módulo (Categorías, y a futuro Cuentas/Monedas/etc.) trae su propio
# urls.py en su subcarpeta — acá solo se los junta bajo el mismo prefijo "api/configuraciones/"
# que ya arma config/urls.py.
urlpatterns = [
    path("", include("apps.configuraciones.categoria.urls")),
]
