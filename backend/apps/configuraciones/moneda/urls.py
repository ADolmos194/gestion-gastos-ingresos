from django.urls import path

from . import views

urlpatterns = [
    path("monedas/", views.list_monedas, name="monedas-list"),
    path("monedas/activas/", views.list_monedas_activas, name="monedas-activas-list"),
    path("monedas/bulk-save/", views.bulk_save_monedas, name="monedas-bulk-save"),
    path("monedas/import/", views.import_monedas, name="monedas-import"),
    path(
        "monedas/import/validate/start/",
        views.start_monedas_import_validate,
        name="monedas-import-validate-start",
    ),
    path(
        "monedas/import/validate/status/<uuid:job_id>/",
        views.monedas_import_validate_status,
        name="monedas-import-validate-status",
    ),
    path("monedas/template/", views.monedas_template, name="monedas-template"),
    path("monedas/export/", views.export_monedas, name="monedas-export"),
    path("monedas/<uuid:moneda_id>/historial/", views.moneda_historial, name="moneda-historial"),
    path(
        "monedas/<uuid:moneda_id>/historial/<uuid:historial_id>/detalle/",
        views.moneda_historial_detalle,
        name="moneda-historial-detalle",
    ),
]
