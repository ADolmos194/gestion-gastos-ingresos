from django.urls import path

from . import views

urlpatterns = [
    path("categorias/", views.list_categorias, name="categorias-list"),
    path("categorias/bulk-save/", views.bulk_save_categorias, name="categorias-bulk-save"),
    path("categorias/import/", views.import_categorias, name="categorias-import"),
    path(
        "categorias/import/validate/start/",
        views.start_categorias_import_validate,
        name="categorias-import-validate-start",
    ),
    path(
        "categorias/import/validate/status/<uuid:job_id>/",
        views.categorias_import_validate_status,
        name="categorias-import-validate-status",
    ),
    path("categorias/template/", views.categorias_template, name="categorias-template"),
    path("categorias/export/", views.export_categorias, name="categorias-export"),
    path("categorias/<uuid:categoria_id>/historial/", views.categoria_historial, name="categoria-historial"),
    path(
        "categorias/<uuid:categoria_id>/historial/<uuid:historial_id>/detalle/",
        views.categoria_historial_detalle,
        name="categoria-historial-detalle",
    ),
    path("tipos-categoria/", views.list_tipos_categoria, name="tipos-categoria-list"),
    path("tipos-categoria/bulk-save/", views.bulk_save_tipos_categoria, name="tipos-categoria-bulk-save"),
]
