"""Mensajes de texto del módulo de Seguridad — mismo criterio que los message.py de
Configuraciones/Finanzas: centralizados para no repetir strings.
"""

NO_PERMISO = "No tenés permiso para administrar seguridad."

UPDATE_SIN_ID = "Cada fila de 'updated' necesita 'id'."
ANULAR_NO_EXISTE = "Alguno de los roles a anular no existe."
RESTAURAR_NO_EXISTE = "Alguno de los roles a restaurar no existe."


def rol_nombre_duplicado(name: str) -> str:
    return f'Ya existe un rol llamado "{name}".'


def rol_no_existe(rol_id) -> str:
    return f"El rol {rol_id} no existe."


def usuario_no_existe(usuario_id) -> str:
    return f"El usuario {usuario_id} no existe."
