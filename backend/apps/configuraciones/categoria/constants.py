TEMPLATE_COLUMNS = ["Nombre", "Tipo", "Descripción", "Color", "Ícono"]
SHEET_NAME = "Categorías"

# Permisos (Permission.decorator_name) que ya existían como required_permission en las
# vistas class-based; centralizados acá para no repetir el string en cada vista.
PERM_READ = "configuracion-categorias-read"
PERM_CREATE = "configuracion-categorias-create"
PERM_UPDATE = "configuracion-categorias-update"
PERM_DELETE = "configuracion-categorias-delete"
PERM_IMPORT = "configuracion-categorias-import"
PERM_EXPORT = "configuracion-categorias-export"
