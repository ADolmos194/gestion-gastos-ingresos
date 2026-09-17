from functools import partial

from django.db import transaction
from django.http import Http404
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.historial.models import Historial
from apps.historial.serializers import HistorialDetalleSerializer, HistorialSerializer
from apps.historial.services import registrar_actualizacion, registrar_creacion, snapshot
from apps.seguridad.decorators import log_data_access, require_permission
from apps.seguridad.services import ALL_PERMISSIONS_BACK, build_user_access

from apps.configuraciones.services import (
    ACTIVE_STATUS_NAME,
    INACTIVE_STATUS_NAME,
    VOIDED_STATUS_NAME,
    get_status_by_name,
)

from . import constants, message
from .models import Movimiento
from .serializers import MovimientoSerializer
from .services import compute_saldos

_MODULO = "finanzas.movimiento"
_TABLA = Movimiento._meta.db_table

# Para no repetir modulo/nom_tabla en cada punto de escritura (mismo criterio que
# apps.configuraciones.categoria/moneda/cuenta views.py).
_registrar_creacion = partial(registrar_creacion, modulo=_MODULO, nom_tabla=_TABLA)
_registrar_actualizacion = partial(registrar_actualizacion, modulo=_MODULO, nom_tabla=_TABLA)


def _user_movimientos(user):
    return (
        Movimiento.objects.filter(key_user=user)
        .exclude(key_status__name="Eliminado")
        .select_related("key_categoria", "key_categoria__key_tipo", "key_cuenta", "key_cuenta__key_moneda", "key_status")
    )


def _has_permission(access, decorator_name: str) -> bool:
    return ALL_PERMISSIONS_BACK in access.permisos_back or decorator_name in access.permisos_back


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def list_movimientos(request):
    movimientos = _user_movimientos(request.user).order_by("-movement_date", "key_status__name")
    return Response(MovimientoSerializer(movimientos, many=True).data)


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def list_saldos(request):
    """Saldo actual de cada cuenta activa del usuario — ver apps.finanzas.services."""
    return Response(compute_saldos(request.user))


def _owned_movimiento_or_404(movimiento_id, usuario) -> Movimiento:
    movimiento = Movimiento.objects.filter(id=movimiento_id, key_user=usuario).first()
    if movimiento is None:
        raise Http404
    return movimiento


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def movimiento_historial(request, movimiento_id):
    movimiento = _owned_movimiento_or_404(movimiento_id, request.user)
    historial = (
        Historial.objects.filter(nom_tabla=_TABLA, key_record=str(movimiento.id))
        .select_related("key_usuario")
        .order_by("-fecha_hora")
    )
    return Response(HistorialSerializer(historial, many=True).data)


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def movimiento_historial_detalle(request, movimiento_id, historial_id):
    movimiento = _owned_movimiento_or_404(movimiento_id, request.user)
    historial = Historial.objects.filter(id=historial_id, nom_tabla=_TABLA, key_record=str(movimiento.id)).first()
    if historial is None:
        raise Http404
    detalles = historial.detalles.order_by("columna")
    return Response(HistorialDetalleSerializer(detalles, many=True).data)


def _crear_movimientos(payload: list[dict], usuario, active_status) -> None:
    # Sin lock_duplicate_guard/_find_blocking_duplicate acá: a diferencia de Categoria/
    # Moneda/Cuenta, un Movimiento no tiene identidad única (nombre/código) que proteger —
    # dos gastos de "Almuerzo" el mismo día son perfectamente válidos.
    for row in payload:
        serializer = MovimientoSerializer(data=row, context={"usuario": usuario})
        serializer.is_valid(raise_exception=True)
        movimiento = serializer.save(
            key_user=usuario,
            key_status=active_status,
            key_creator_user=usuario,
            key_updater_user=usuario,
        )
        _registrar_creacion(usuario=usuario, instance=movimiento)


def _actualizar_movimientos(payload: list[dict], usuario) -> None:
    for row in payload:
        movimiento_id = row.get("id")
        if not movimiento_id:
            raise ValidationError(message.UPDATE_SIN_ID)
        movimiento = Movimiento.objects.filter(id=movimiento_id, key_user=usuario).first()
        if movimiento is None:
            raise ValidationError(message.movimiento_no_existe(movimiento_id))
        antes = snapshot(movimiento)
        serializer = MovimientoSerializer(movimiento, data=row, partial=True, context={"usuario": usuario})
        serializer.is_valid(raise_exception=True)
        movimiento = serializer.save(key_updater_user=usuario)
        _registrar_actualizacion(usuario=usuario, antes=antes, despues_instance=movimiento)


def _anular_movimientos(voided_ids: list[str], usuario, voided_status) -> None:
    to_void = list(Movimiento.objects.filter(id__in=voided_ids, key_user=usuario).select_related("key_status"))
    if len(to_void) != len(set(voided_ids)):
        raise ValidationError(message.ANULAR_NO_EXISTE)

    antes_por_id = {movimiento.id: snapshot(movimiento) for movimiento in to_void}
    Movimiento.objects.filter(id__in=voided_ids, key_user=usuario).update(
        key_status=voided_status, key_updater_user=usuario
    )
    for movimiento in to_void:
        movimiento.key_status = voided_status
        movimiento.key_updater_user = usuario
        _registrar_actualizacion(
            usuario=usuario, antes=antes_por_id[movimiento.id], despues_instance=movimiento, evento="delete"
        )


def _restaurar_movimientos(restored_ids: list[str], usuario, active_status) -> None:
    to_restore = list(Movimiento.objects.filter(id__in=restored_ids, key_user=usuario).select_related("key_status"))
    if len(to_restore) != len(set(restored_ids)):
        raise ValidationError(message.RESTAURAR_NO_EXISTE)

    antes_por_id = {movimiento.id: snapshot(movimiento) for movimiento in to_restore}
    Movimiento.objects.filter(id__in=restored_ids, key_user=usuario).update(
        key_status=active_status, key_updater_user=usuario
    )
    for movimiento in to_restore:
        movimiento.key_status = active_status
        movimiento.key_updater_user = usuario
        _registrar_actualizacion(usuario=usuario, antes=antes_por_id[movimiento.id], despues_instance=movimiento)


def _inactivar_movimientos(inactivated_ids: list[str], usuario, inactive_status) -> None:
    to_inactivate = list(
        Movimiento.objects.filter(id__in=inactivated_ids, key_user=usuario).select_related("key_status")
    )
    if len(to_inactivate) != len(set(inactivated_ids)):
        raise ValidationError(message.INACTIVAR_NO_EXISTE)

    antes_por_id = {movimiento.id: snapshot(movimiento) for movimiento in to_inactivate}
    Movimiento.objects.filter(id__in=inactivated_ids, key_user=usuario).update(
        key_status=inactive_status, key_updater_user=usuario
    )
    for movimiento in to_inactivate:
        movimiento.key_status = inactive_status
        movimiento.key_updater_user = usuario
        _registrar_actualizacion(usuario=usuario, antes=antes_por_id[movimiento.id], despues_instance=movimiento)


@log_data_access
@require_permission()
@api_view(["POST"])
def bulk_save_movimientos(request):
    """Mismo contrato que bulk_save_categorias/monedas/cuentas (ver apps.configuraciones):
    un único request/transacción para created/updated/voided/restored/inactivated, cada
    bolsa validada contra su propio permiso."""
    access = build_user_access(request.user)
    created_payload = request.data.get("created") or []
    updated_payload = request.data.get("updated") or []
    voided_ids = request.data.get("voided") or []
    restored_ids = request.data.get("restored") or []
    inactivated_ids = request.data.get("inactivated") or []

    if created_payload and not _has_permission(access, constants.PERM_CREATE):
        raise PermissionDenied(message.NO_PERMISO_CREAR)
    if updated_payload and not _has_permission(access, constants.PERM_UPDATE):
        raise PermissionDenied(message.NO_PERMISO_EDITAR)
    if voided_ids and not _has_permission(access, constants.PERM_DELETE):
        raise PermissionDenied(message.NO_PERMISO_ANULAR)
    if restored_ids and not _has_permission(access, constants.PERM_UPDATE):
        raise PermissionDenied(message.NO_PERMISO_EDITAR)
    if inactivated_ids and not _has_permission(access, constants.PERM_UPDATE):
        raise PermissionDenied(message.NO_PERMISO_EDITAR)

    active_status = get_status_by_name(ACTIVE_STATUS_NAME)
    voided_status = get_status_by_name(VOIDED_STATUS_NAME)
    inactive_status = get_status_by_name(INACTIVE_STATUS_NAME)

    with transaction.atomic():
        if created_payload:
            _crear_movimientos(created_payload, request.user, active_status)
        if updated_payload:
            _actualizar_movimientos(updated_payload, request.user)
        if voided_ids:
            _anular_movimientos(voided_ids, request.user, voided_status)
        if restored_ids:
            _restaurar_movimientos(restored_ids, request.user, active_status)
        if inactivated_ids:
            _inactivar_movimientos(inactivated_ids, request.user, inactive_status)

    movimientos = _user_movimientos(request.user).order_by("-movement_date", "key_status__name")
    return Response(MovimientoSerializer(movimientos, many=True).data)
