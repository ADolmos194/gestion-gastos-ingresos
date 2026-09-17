TEMPLATE_COLUMNS = ["Nombre", "Código", "Símbolo", "Descripción"]
SHEET_NAME = "Monedas"

# Permisos (Permission.decorator_name) — mismo criterio que categoria/constants.py:
# centralizados acá para no repetir el string en cada vista.
PERM_READ = "configuracion-monedas-read"
PERM_CREATE = "configuracion-monedas-create"
PERM_UPDATE = "configuracion-monedas-update"
PERM_DELETE = "configuracion-monedas-delete"
PERM_IMPORT = "configuracion-monedas-import"
PERM_EXPORT = "configuracion-monedas-export"
