"""Mensajes de texto (errores, permisos, etc.) del módulo de Monedas — centralizados acá
por el mismo motivo que categoria/message.py: un solo lugar donde tocar el texto.
"""

NO_PERMISO_CREAR = "No tenés permiso para crear monedas."
NO_PERMISO_EDITAR = "No tenés permiso para editar monedas."
NO_PERMISO_ANULAR = "No tenés permiso para anular monedas."

UPDATE_SIN_ID = "Cada fila de 'updated' necesita 'id'."
ANULAR_NO_EXISTE = "Alguna de las monedas a anular no existe o no te pertenece."
RESTAURAR_NO_EXISTE = "Alguna de las monedas a restaurar no existe o no te pertenece."
INACTIVAR_NO_EXISTE = "Alguna de las monedas a inactivar no existe o no te pertenece."


def moneda_no_existe(moneda_id) -> str:
    return f"La moneda {moneda_id} no existe o no te pertenece."


FALTA_ARCHIVO = "Falta el archivo .xlsx."


def archivo_ilegible(detalle) -> str:
    return f"No se pudo leer el archivo: {detalle}"


def columnas_faltantes(columnas) -> str:
    return f"Faltan columnas obligatorias: {', '.join(sorted(columnas))}."


CODIGO_OBLIGATORIO = "El código es obligatorio."


def codigo_duplicado(code: str) -> str:
    return f'Ya existe una moneda con el código "{code}".'
