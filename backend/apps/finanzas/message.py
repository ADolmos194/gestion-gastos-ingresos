"""Mensajes de texto del módulo de Movimientos — mismo criterio que los message.py de
Configuraciones (categoria/moneda/cuenta): centralizados para no repetir strings.
"""

NO_PERMISO_CREAR = "No tenés permiso para crear movimientos."
NO_PERMISO_EDITAR = "No tenés permiso para editar movimientos."
NO_PERMISO_ANULAR = "No tenés permiso para anular movimientos."

UPDATE_SIN_ID = "Cada fila de 'updated' necesita 'id'."
ANULAR_NO_EXISTE = "Alguno de los movimientos a anular no existe o no te pertenece."
RESTAURAR_NO_EXISTE = "Alguno de los movimientos a restaurar no existe o no te pertenece."
INACTIVAR_NO_EXISTE = "Alguno de los movimientos a inactivar no existe o no te pertenece."


def movimiento_no_existe(movimiento_id) -> str:
    return f"El movimiento {movimiento_id} no existe o no te pertenece."


def categoria_no_existe(categoria_id) -> str:
    return f"La categoría {categoria_id} no existe o no te pertenece."


def cuenta_no_existe(cuenta_id) -> str:
    return f"La cuenta {cuenta_id} no existe o no te pertenece."
