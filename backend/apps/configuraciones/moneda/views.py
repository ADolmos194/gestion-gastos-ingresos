import base64
import io
import logging
from collections.abc import Callable
from datetime import timedelta
from functools import partial

import pandas as pd
from django.contrib.auth import get_user_model
from django.db import close_old_connections, transaction
from django.http import Http404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.historial.models import Historial
from apps.historial.serializers import HistorialDetalleSerializer, HistorialSerializer
from apps.historial.services import registrar_creacion, registrar_actualizacion, snapshot
from apps.seguridad.decorators import log_data_access, require_permission
from apps.seguridad.services import ALL_PERMISSIONS_BACK, build_user_access

from .. import excel_utils
from ..services import (
    ACTIVE_STATUS_NAME,
    INACTIVE_STATUS_NAME,
    JOB_DONE_STATUS_NAME,
    JOB_ERROR_STATUS_NAME,
    JOB_PROCESSING_STATUS_NAME,
    VOIDED_STATUS_NAME,
    get_status_by_name,
    lock_duplicate_guard,
)
from ..tasks import run_monedas_import_validation_job
from . import constants, message
from .models import Moneda, MonedaImportJob
from .serializers import MonedaSerializer

logger = logging.getLogger(__name__)

_MODULO = "configuraciones.moneda"
_TABLA = Moneda._meta.db_table

# Para no repetir modulo/nom_tabla en cada punto de escritura de este módulo (mismo
# criterio que categoria/views.py).
_registrar_creacion = partial(registrar_creacion, modulo=_MODULO, nom_tabla=_TABLA)
_registrar_actualizacion = partial(registrar_actualizacion, modulo=_MODULO, nom_tabla=_TABLA)


def _user_monedas(user):
    return (
        Moneda.objects.filter(key_user=user)
        .exclude(key_status__name="Eliminado")
        .select_related("key_status")
    )


def _has_permission(access, decorator_name: str) -> bool:
    return ALL_PERMISSIONS_BACK in access.permisos_back or decorator_name in access.permisos_back


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def list_monedas(request):
    monedas = _user_monedas(request.user).order_by("key_status__name", "code")
    return Response(MonedaSerializer(monedas, many=True).data)


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def list_monedas_activas(request):
    """Solo las Activas del usuario, ordenadas por código — alimenta el dropdown Moneda de
    otros módulos (ver Cuentas), mismo criterio que list_tipos_categoria en
    categoria/views.py (que también expone un catálogo acotado para un dropdown)."""
    monedas = _user_monedas(request.user).filter(key_status__name=ACTIVE_STATUS_NAME).order_by("code")
    return Response(MonedaSerializer(monedas, many=True).data)


def _owned_moneda_or_404(moneda_id, usuario) -> Moneda:
    moneda = Moneda.objects.filter(id=moneda_id, key_user=usuario).first()
    if moneda is None:
        raise Http404
    return moneda


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def moneda_historial(request, moneda_id):
    moneda = _owned_moneda_or_404(moneda_id, request.user)
    historial = (
        Historial.objects.filter(nom_tabla=_TABLA, key_record=str(moneda.id))
        .select_related("key_usuario")
        .order_by("-fecha_hora")
    )
    return Response(HistorialSerializer(historial, many=True).data)


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def moneda_historial_detalle(request, moneda_id, historial_id):
    moneda = _owned_moneda_or_404(moneda_id, request.user)
    historial = Historial.objects.filter(id=historial_id, nom_tabla=_TABLA, key_record=str(moneda.id)).first()
    if historial is None:
        raise Http404
    detalles = historial.detalles.order_by("columna")
    return Response(HistorialDetalleSerializer(detalles, many=True).data)


# Un código ya usado por un registro Activo o Inactivo del mismo usuario bloquea crear/
# renombrar a ese código — uno Anulado no (mismo criterio que Categoria, ver
# _find_blocking_duplicate en categoria/views.py, acá aplicado a "code" en vez de "name"
# porque el código es la identidad real de una moneda, no su etiqueta).
def _find_blocking_duplicate(usuario, code: str, exclude_id=None) -> Moneda | None:
    qs = Moneda.objects.filter(key_user=usuario, code__iexact=code).exclude(key_status__name=VOIDED_STATUS_NAME)
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.select_related("key_status").first()


def _crear_monedas(payload: list[dict], usuario, active_status) -> None:
    for row in payload:
        code = (row.get("code") or "").strip().upper()
        if code:
            lock_duplicate_guard(_TABLA, usuario.id, code)
        if code and _find_blocking_duplicate(usuario, code):
            raise ValidationError(message.codigo_duplicado(code))
        serializer = MonedaSerializer(data=row)
        serializer.is_valid(raise_exception=True)
        moneda = serializer.save(
            key_user=usuario,
            key_status=active_status,
            key_creator_user=usuario,
            key_updater_user=usuario,
        )
        _registrar_creacion(usuario=usuario, instance=moneda)


def _actualizar_monedas(payload: list[dict], usuario) -> None:
    for row in payload:
        moneda_id = row.get("id")
        if not moneda_id:
            raise ValidationError(message.UPDATE_SIN_ID)
        moneda = Moneda.objects.filter(id=moneda_id, key_user=usuario).first()
        if moneda is None:
            raise ValidationError(message.moneda_no_existe(moneda_id))
        new_code = (row.get("code") or "").strip().upper()
        if new_code and new_code != moneda.code.strip().upper():
            lock_duplicate_guard(_TABLA, usuario.id, new_code)
            if _find_blocking_duplicate(usuario, new_code, exclude_id=moneda.id):
                raise ValidationError(message.codigo_duplicado(new_code))
        antes = snapshot(moneda)
        serializer = MonedaSerializer(moneda, data=row, partial=True)
        serializer.is_valid(raise_exception=True)
        moneda = serializer.save(key_updater_user=usuario)
        _registrar_actualizacion(usuario=usuario, antes=antes, despues_instance=moneda)


def _anular_monedas(voided_ids: list[str], usuario, voided_status) -> None:
    to_void = list(Moneda.objects.filter(id__in=voided_ids, key_user=usuario).select_related("key_status"))
    if len(to_void) != len(set(voided_ids)):
        raise ValidationError(message.ANULAR_NO_EXISTE)

    antes_por_id = {moneda.id: snapshot(moneda) for moneda in to_void}
    Moneda.objects.filter(id__in=voided_ids, key_user=usuario).update(
        key_status=voided_status, key_updater_user=usuario
    )
    for moneda in to_void:
        moneda.key_status = voided_status
        moneda.key_updater_user = usuario
        _registrar_actualizacion(usuario=usuario, antes=antes_por_id[moneda.id], despues_instance=moneda, evento="delete")


# Inversa de _anular_monedas (y de _inactivar_monedas, más abajo) — mismo patrón que
# categoria/views.py.
def _restaurar_monedas(restored_ids: list[str], usuario, active_status) -> None:
    to_restore = list(Moneda.objects.filter(id__in=restored_ids, key_user=usuario).select_related("key_status"))
    if len(to_restore) != len(set(restored_ids)):
        raise ValidationError(message.RESTAURAR_NO_EXISTE)

    antes_por_id = {moneda.id: snapshot(moneda) for moneda in to_restore}
    Moneda.objects.filter(id__in=restored_ids, key_user=usuario).update(
        key_status=active_status, key_updater_user=usuario
    )
    for moneda in to_restore:
        moneda.key_status = active_status
        moneda.key_updater_user = usuario
        _registrar_actualizacion(usuario=usuario, antes=antes_por_id[moneda.id], despues_instance=moneda)


def _inactivar_monedas(inactivated_ids: list[str], usuario, inactive_status) -> None:
    to_inactivate = list(Moneda.objects.filter(id__in=inactivated_ids, key_user=usuario).select_related("key_status"))
    if len(to_inactivate) != len(set(inactivated_ids)):
        raise ValidationError(message.INACTIVAR_NO_EXISTE)

    antes_por_id = {moneda.id: snapshot(moneda) for moneda in to_inactivate}
    Moneda.objects.filter(id__in=inactivated_ids, key_user=usuario).update(
        key_status=inactive_status, key_updater_user=usuario
    )
    for moneda in to_inactivate:
        moneda.key_status = inactive_status
        moneda.key_updater_user = usuario
        _registrar_actualizacion(usuario=usuario, antes=antes_por_id[moneda.id], despues_instance=moneda)


@log_data_access
@require_permission()
@api_view(["POST"])
def bulk_save_monedas(request):
    """Mismo contrato que bulk_save_categorias (ver categoria/views.py): un único request/
    transacción para created/updated/voided/restored/inactivated, cada bolsa validada
    contra su propio permiso."""
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
            _crear_monedas(created_payload, request.user, active_status)
        if updated_payload:
            _actualizar_monedas(updated_payload, request.user)
        if voided_ids:
            _anular_monedas(voided_ids, request.user, voided_status)
        if restored_ids:
            _restaurar_monedas(restored_ids, request.user, active_status)
        if inactivated_ids:
            _inactivar_monedas(inactivated_ids, request.user, inactive_status)

    monedas = _user_monedas(request.user).order_by("key_status__name", "code")
    return Response(MonedaSerializer(monedas, many=True).data)


@log_data_access
@require_permission(constants.PERM_IMPORT)
@api_view(["GET"])
def monedas_template(request):
    df = pd.DataFrame(
        [["Sol Peruano", "PEN", "S/", "Moneda oficial de Perú"]],
        columns=constants.TEMPLATE_COLUMNS,
    )
    return excel_utils.dataframe_to_xlsx_response(
        df, "plantilla_monedas.xlsx", constants.SHEET_NAME, ACTIVE_STATUS_NAME, VOIDED_STATUS_NAME
    )


_EXPORT_STATUS_FILTERS = {
    "active": ACTIVE_STATUS_NAME,
    "inactive": INACTIVE_STATUS_NAME,
    "voided": VOIDED_STATUS_NAME,
}


@log_data_access
@require_permission(constants.PERM_EXPORT)
@api_view(["GET"])
def export_monedas(request):
    monedas = _user_monedas(request.user)
    status_name = _EXPORT_STATUS_FILTERS.get(request.GET.get("status"))
    if status_name:
        monedas = monedas.filter(key_status__name=status_name)
    monedas = monedas.order_by("code")
    df = pd.DataFrame(
        [
            {
                "Nombre": moneda.name,
                "Código": moneda.code,
                "Símbolo": moneda.symbol or "",
                "Descripción": moneda.description or "",
                "Estado": moneda.key_status.name if moneda.key_status else "",
            }
            for moneda in monedas
        ],
        columns=[*constants.TEMPLATE_COLUMNS, "Estado"],
    )
    return excel_utils.dataframe_to_xlsx_response(
        df, "monedas.xlsx", constants.SHEET_NAME, ACTIVE_STATUS_NAME, VOIDED_STATUS_NAME
    )


def _parse_monedas_file(
    uploaded, user, progress_cb: Callable[[int, int], None] | None = None
) -> tuple[list[dict], list[dict], list[Moneda], list[tuple[Moneda, dict]]]:
    """Lee y valida el .xlsx de monedas — mismo criterio que _parse_categorias_file
    (categoria/views.py), adaptado a que acá la identidad de la fila es "Código", no
    "Nombre": un código que coincide con un registro Activo bloquea, uno Anulado no, y uno
    Inactivo reactiva en vez de bloquear o crear otro."""
    if uploaded is None:
        raise ValidationError(message.FALTA_ARCHIVO)

    try:
        df = pd.read_excel(uploaded, dtype=str, engine="openpyxl").fillna("")
    except Exception as exc:
        raise ValidationError(message.archivo_ilegible(exc)) from exc

    missing_columns = {"Nombre", "Código"} - set(df.columns)
    if missing_columns:
        raise ValidationError(message.columnas_faltantes(missing_columns))

    total_rows = len(df)
    if progress_cb is not None:
        progress_cb(0, total_rows)

    existing_by_code: dict[str, Moneda] = {}
    for moneda in _user_monedas(user):
        key = moneda.code.strip().upper()
        current = existing_by_code.get(key)
        if current is None or (current.key_status and current.key_status.name == VOIDED_STATUS_NAME):
            existing_by_code[key] = moneda

    preview_rows: list[dict] = []
    errors: list[dict] = []
    to_create: list[Moneda] = []
    to_reactivate: list[tuple[Moneda, dict]] = []
    seen_codes: set[str] = set()
    active_status = get_status_by_name(ACTIVE_STATUS_NAME)
    last_reported_percent = -1

    for position, row in df.iterrows():
        if progress_cb is not None:
            processed = position + 1
            percent = int(processed * 100 / total_rows) if total_rows else 100
            if percent != last_reported_percent:
                progress_cb(processed, total_rows)
                last_reported_percent = percent

        excel_row = position + 2  # +1 por el header, +1 porque iterrows es 0-based

        name = str(row.get("Nombre", "")).strip()
        code = str(row.get("Código", "")).strip().upper()
        symbol = str(row.get("Símbolo", "")).strip()
        description = str(row.get("Descripción", "")).strip()

        if not name and not code:
            continue  # fila en blanco, se ignora

        preview_rows.append(
            {
                "row": excel_row,
                "fields": {"name": name, "code": code, "symbol": symbol, "description": description},
            }
        )

        existing = existing_by_code.get(code) if code else None
        existing_status_name = existing.key_status.name if existing and existing.key_status else None

        row_had_error = False
        if not code:
            errors.append({"row": excel_row, "field": "code", "message": message.CODIGO_OBLIGATORIO})
            row_had_error = True
        elif code in seen_codes:
            errors.append({"row": excel_row, "field": "code", "message": message.codigo_duplicado(code)})
            row_had_error = True
        elif existing is not None and existing_status_name not in (VOIDED_STATUS_NAME, INACTIVE_STATUS_NAME):
            errors.append({"row": excel_row, "field": "code", "message": message.codigo_duplicado(code)})
            row_had_error = True

        if not name:
            errors.append({"row": excel_row, "field": "name", "message": "El nombre es obligatorio."})
            row_had_error = True

        if row_had_error:
            continue

        seen_codes.add(code)
        if existing is not None and existing_status_name == INACTIVE_STATUS_NAME:
            antes = snapshot(existing)
            existing.name = name
            existing.symbol = symbol or None
            existing.description = description or None
            existing.key_status = active_status
            existing.key_updater_user = user
            to_reactivate.append((existing, antes))
        else:
            to_create.append(
                Moneda(
                    key_user=user,
                    name=name,
                    code=code,
                    symbol=symbol or None,
                    description=description or None,
                    key_status=active_status,
                    key_creator_user=user,
                    key_updater_user=user,
                )
            )

    return preview_rows, errors, to_create, to_reactivate


def _job_error_message(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        detail = exc.detail
        if isinstance(detail, list) and detail:
            return str(detail[0])
        return str(detail)
    return str(exc)


def run_monedas_import_validation_job_body(job_id, file_bytes: bytes, user_id) -> None:
    """Cuerpo real de la task de Celery (ver apps.configuraciones.tasks.
    run_monedas_import_validation_job) — mismo criterio que cuenta/views.py."""
    close_old_connections()
    try:
        user = get_user_model().objects.get(pk=user_id)
        done_status = get_status_by_name(JOB_DONE_STATUS_NAME)

        def progress_cb(processed: int, total: int) -> None:
            MonedaImportJob.objects.filter(pk=job_id).update(processed_rows=processed, total_rows=total)

        preview_rows, errors, _, _ = _parse_monedas_file(io.BytesIO(file_bytes), user, progress_cb=progress_cb)
        MonedaImportJob.objects.filter(pk=job_id).update(
            key_status=done_status, result={"rows": preview_rows, "errors": errors}
        )
    except Exception as exc:
        logger.exception("Falló la validación de import de monedas (job_id=%s)", job_id)
        error_status = get_status_by_name(JOB_ERROR_STATUS_NAME)
        MonedaImportJob.objects.filter(pk=job_id).update(
            key_status=error_status, error_message=_job_error_message(exc)
        )
    finally:
        close_old_connections()


@log_data_access
@require_permission(constants.PERM_IMPORT)
@api_view(["POST"])
def start_monedas_import_validate(request):
    uploaded = request.FILES.get("file")
    if uploaded is None:
        raise ValidationError(message.FALTA_ARCHIVO)
    excel_utils.validate_import_upload(uploaded)
    file_bytes = uploaded.read()

    MonedaImportJob.objects.filter(
        key_user=request.user, creation_date__lt=timezone.now() - timedelta(hours=1)
    ).delete()

    processing_status = get_status_by_name(JOB_PROCESSING_STATUS_NAME)
    job = MonedaImportJob.objects.create(
        key_user=request.user,
        key_status=processing_status,
        key_creator_user=request.user,
        key_updater_user=request.user,
    )
    run_monedas_import_validation_job.delay(str(job.id), base64.b64encode(file_bytes).decode("ascii"), str(request.user.id))
    return Response({"job_id": str(job.id)}, status=status.HTTP_202_ACCEPTED)


@log_data_access
@require_permission(constants.PERM_IMPORT)
@api_view(["GET"])
def monedas_import_validate_status(request, job_id):
    job = MonedaImportJob.objects.filter(pk=job_id, key_user=request.user).select_related("key_status").first()
    if job is None:
        raise Http404
    job_status_name = job.key_status.name if job.key_status else None
    payload = {
        "status": job_status_name,
        "processed_rows": job.processed_rows,
        "total_rows": job.total_rows,
    }
    if job_status_name == JOB_DONE_STATUS_NAME:
        payload["result"] = job.result
    elif job_status_name == JOB_ERROR_STATUS_NAME:
        payload["error"] = job.error_message
    return Response(payload)


@log_data_access
@require_permission(constants.PERM_IMPORT)
@api_view(["POST"])
def import_monedas(request):
    uploaded = request.FILES.get("file")
    if uploaded is not None:
        excel_utils.validate_import_upload(uploaded)
    _, errors, to_create, to_reactivate = _parse_monedas_file(uploaded, request.user)

    if errors:
        return Response({"committed": False, "created_count": 0, "errors": errors}, status=status.HTTP_400_BAD_REQUEST)

    Moneda.objects.bulk_create(to_create)
    for moneda in to_create:
        _registrar_creacion(usuario=request.user, instance=moneda, evento="import")

    if to_reactivate:
        Moneda.objects.bulk_update(
            [moneda for moneda, _ in to_reactivate],
            fields=["name", "symbol", "description", "key_status", "key_updater_user"],
        )
        for moneda, antes in to_reactivate:
            _registrar_actualizacion(usuario=request.user, antes=antes, despues_instance=moneda, evento="import")

    return Response(
        {"committed": True, "created_count": len(to_create) + len(to_reactivate), "errors": []}
    )
