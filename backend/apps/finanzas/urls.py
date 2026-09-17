from django.urls import path

from . import views

app_name = "finanzas"

urlpatterns = [
    path("movimientos/", views.list_movimientos, name="movimientos-list"),
    path("movimientos/bulk-save/", views.bulk_save_movimientos, name="movimientos-bulk-save"),
    path("movimientos/saldos/", views.list_saldos, name="movimientos-saldos"),
    path(
        "movimientos/<uuid:movimiento_id>/historial/",
        views.movimiento_historial,
        name="movimiento-historial",
    ),
    path(
        "movimientos/<uuid:movimiento_id>/historial/<uuid:historial_id>/detalle/",
        views.movimiento_historial_detalle,
        name="movimiento-historial-detalle",
    ),
]
