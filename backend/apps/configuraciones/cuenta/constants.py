TEMPLATE_COLUMNS = ["Nombre", "Tipo", "Moneda", "N° de Cuenta", "Titular"]
SHEET_NAME = "Cuentas"

# Permisos (Permission.decorator_name) — mismo criterio que categoria/constants.py y
# moneda/constants.py: centralizados acá para no repetir el string en cada vista.
PERM_READ = "configuracion-cuentas-read"
PERM_CREATE = "configuracion-cuentas-create"
PERM_UPDATE = "configuracion-cuentas-update"
PERM_DELETE = "configuracion-cuentas-delete"
PERM_IMPORT = "configuracion-cuentas-import"
PERM_EXPORT = "configuracion-cuentas-export"
