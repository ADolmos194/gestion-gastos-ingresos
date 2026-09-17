"""Mensajes de texto (errores, permisos, etc.) del módulo de Cuentas — centralizados acá
por el mismo motivo que categoria/message.py y moneda/message.py: un solo lugar donde
tocar el texto.
"""

NO_PERMISO_CREAR = "No tenés permiso para crear cuentas."
NO_PERMISO_EDITAR = "No tenés permiso para editar cuentas."
NO_PERMISO_ANULAR = "No tenés permiso para anular cuentas."

UPDATE_SIN_ID = "Cada fila de 'updated' necesita 'id'."
ANULAR_NO_EXISTE = "Alguna de las cuentas a anular no existe o no te pertenece."
RESTAURAR_NO_EXISTE = "Alguna de las cuentas a restaurar no existe o no te pertenece."
INACTIVAR_NO_EXISTE = "Alguna de las cuentas a inactivar no existe o no te pertenece."


def cuenta_no_existe(cuenta_id) -> str:
    return f"La cuenta {cuenta_id} no existe o no te pertenece."


def moneda_no_existe(moneda_id) -> str:
    return f"La moneda {moneda_id} no existe o no te pertenece."


FALTA_ARCHIVO = "Falta el archivo .xlsx."


def archivo_ilegible(detalle) -> str:
    return f"No se pudo leer el archivo: {detalle}"


def columnas_faltantes(columnas) -> str:
    return f"Faltan columnas obligatorias: {', '.join(sorted(columnas))}."


NOMBRE_OBLIGATORIO = "El nombre es obligatorio."


def nombre_duplicado(name: str) -> str:
    return f'Ya existe una cuenta llamada "{name}".'


def tipo_invalido(tipo_name: str) -> str:
    return f'Tipo "{tipo_name}" inválido.'


def moneda_invalida(moneda_code: str) -> str:
    return f'Moneda "{moneda_code}" inválida.'
