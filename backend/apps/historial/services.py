"""Registro de auditoría (Historial/HistorialDetalle), genérico para cualquier módulo del
proyecto — no solo Categorías. Equivalente a log_create/log_update de atlas_backend: se
llama a mano desde cada vista que crea/edita datos (ver apps.seguridad.decorators.log_data_access
para por qué esto no vive en un decorador).
"""

from .models import Historial, HistorialDetalle

# Campos de BaseModel que no aportan nada al diff (bookkeeping, no datos de negocio).
_CAMPOS_EXCLUIDOS = frozenset({"id", "key_creator_user", "key_updater_user", "creation_date", "update_date"})


def snapshot(instance, exclude=_CAMPOS_EXCLUIDOS) -> dict:
    """Foto de los campos "de negocio" de una instancia, lista para comparar antes/después.

    Los campos FK devuelven el objeto relacionado (no el id) para que registrar_actualizacion
    pueda convertirlos a texto legible vía __str__ (ej. el nombre del tipo/status, no su UUID).
    """
    return {field.name: getattr(instance, field.name) for field in instance._meta.fields if field.name not in exclude}


def _texto(valor) -> str:
    return "" if valor is None else str(valor)


def registrar_historial(*, usuario, evento: str, modulo: str, nom_tabla: str, key_record, cambios: dict | None = None) -> Historial:
    historial = Historial.objects.create(
        evento=evento,
        modulo=modulo,
        nom_tabla=nom_tabla,
        key_record=str(key_record),
        key_usuario=usuario,
    )
    if cambios:
        HistorialDetalle.objects.bulk_create(
            [
                HistorialDetalle(key_historial=historial, columna=columna, dato_antiguo=_texto(antiguo), dato_nuevo=_texto(nuevo))
                for columna, (antiguo, nuevo) in cambios.items()
            ]
        )
    return historial


def registrar_creacion(*, usuario, instance, modulo: str, nom_tabla: str, evento: str = "create") -> Historial:
    cambios = {columna: (None, valor) for columna, valor in snapshot(instance).items()}
    return registrar_historial(usuario=usuario, evento=evento, modulo=modulo, nom_tabla=nom_tabla, key_record=instance.pk, cambios=cambios)


def registrar_actualizacion(*, usuario, antes: dict, despues_instance, modulo: str, nom_tabla: str, evento: str = "update") -> Historial | None:
    despues = snapshot(despues_instance)
    cambios = {columna: (antes.get(columna), valor) for columna, valor in despues.items() if antes.get(columna) != valor}
    if not cambios:
        return None
    return registrar_historial(
        usuario=usuario, evento=evento, modulo=modulo, nom_tabla=nom_tabla, key_record=despues_instance.pk, cambios=cambios
    )
