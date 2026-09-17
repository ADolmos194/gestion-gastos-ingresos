from django.urls import path

from . import views

urlpatterns = [
    path("cuentas/", views.list_cuentas, name="cuentas-list"),
    path("cuentas/bulk-save/", views.bulk_save_cuentas, name="cuentas-bulk-save"),
    path("cuentas/import/", views.import_cuentas, name="cuentas-import"),
    path(
        "cuentas/import/validate/start/",
        views.start_cuentas_import_validate,
        name="cuentas-import-validate-start",
    ),
    path(
        "cuentas/import/validate/status/<uuid:job_id>/",
        views.cuentas_import_validate_status,
        name="cuentas-import-validate-status",
    ),
    path("cuentas/template/", views.cuentas_template, name="cuentas-template"),
    path("cuentas/export/", views.export_cuentas, name="cuentas-export"),
    path("cuentas/<uuid:cuenta_id>/historial/", views.cuenta_historial, name="cuenta-historial"),
    path(
        "cuentas/<uuid:cuenta_id>/historial/<uuid:historial_id>/detalle/",
        views.cuenta_historial_detalle,
        name="cuenta-historial-detalle",
    ),
    path("tipos-cuenta/", views.list_tipos_cuenta, name="tipos-cuenta-list"),
    path("tipos-cuenta/bulk-save/", views.bulk_save_tipos_cuenta, name="tipos-cuenta-bulk-save"),
]
