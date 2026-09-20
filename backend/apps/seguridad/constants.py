# Un solo permiso para todo el módulo (no read/create/update/delete separados como en
# Configuraciones/Finanzas): administrar seguridad es todo-o-nada — quien puede tocar
# roles/asignaciones puede tocar cualquier parte de esto, partirlo en más permisos no
# agrega ninguna granularidad real y sí más superficie para dejar algo mal cerrado.
#
# A propósito NO se asigna al rol por defecto en ningún seed (ver seed_permission_role.json)
# — solo un rol con all_access=True (ver Role.all_access) pasa este chequeo, así un usuario
# común nunca puede auto-otorgarse permisos o crear un rol con más acceso que el suyo.
PERM_MANAGE = "seguridad-manage"
