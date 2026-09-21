"""Mensajes de texto del módulo de Seguridad — mismo criterio que los message.py de
Configuraciones/Finanzas: centralizados para no repetir strings.
"""

NO_PERMISO = "No tenés permiso para administrar seguridad."

UPDATE_SIN_ID = "Cada fila de 'updated' necesita 'id'."
ANULAR_NO_EXISTE = "Alguno de los roles a anular no existe."
RESTAURAR_NO_EXISTE = "Alguno de los roles a restaurar no existe."
INACTIVAR_NO_EXISTE = "Alguno de los roles a inactivar no existe."

# Guardas contra bloquear el acceso administrativo del sistema (ver _bloquearia_ultimo_
# all_access / save_usuario_roles en views.py) — ninguna de las dos depende de que el
# usuario que ejecuta la acción sea el afectado: la primera protege al sistema entero, la
# segunda protege al propio usuario de un descuido.
ULTIMO_ROL_ALL_ACCESS = (
    "No podés anular, inactivar ni quitarle el acceso total al único rol con acceso "
    "total activo del sistema — dejaría a todos sin forma de administrar permisos."
)
AUTO_QUITAR_ALL_ACCESS = (
    "No podés quitarte a vos mismo tu único rol con acceso total. Pedile a otro "
    "administrador que lo haga."
)

ROL_ID_REQUERIDO = "Falta indicar el rol (role_id)."
USUARIO_ID_REQUERIDO = "Falta indicar el usuario (user_id)."


def rol_nombre_duplicado(name: str) -> str:
    return f'Ya existe un rol llamado "{name}".'


def rol_no_existe(rol_id) -> str:
    return f"El rol {rol_id} no existe."


def usuario_no_existe(usuario_id) -> str:
    return f"El usuario {usuario_id} no existe."


def permiso_no_existe(permiso_id) -> str:
    return f"El permiso {permiso_id} no existe."


def menu_no_existe(menu_id) -> str:
    return f"El menú {menu_id} no existe."
