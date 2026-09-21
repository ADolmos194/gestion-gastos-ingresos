from django.urls import path

from . import views

app_name = "seguridad"

urlpatterns = [
    path("roles/", views.list_roles, name="roles-list"),
    path("roles/bulk-save/", views.bulk_save_roles, name="roles-bulk-save"),
    path("roles/<uuid:role_id>/permissions/", views.role_permissions, name="role-permissions"),
    path("roles/<uuid:role_id>/menus/", views.role_menus, name="role-menus"),
    path("permissions/", views.list_permissions, name="permissions-list"),
    path("menus/", views.list_menus, name="menus-list"),
    path("usuarios/", views.list_usuarios, name="usuarios-list"),
    path("usuarios/<uuid:user_id>/roles/", views.usuario_roles, name="usuario-roles"),
]
