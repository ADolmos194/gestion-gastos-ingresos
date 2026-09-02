import io
import threading
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
)
from . import constants, message
from .models import Categoria, CategoriaImportJob, TipoCategoria
from .serializers import CategoriaSerializer, TipoCategoriaSerializer

_MODULO = "configuraciones.categoria"
_TABLA = Categoria._meta.db_table

# Para no repetir modulo/nom_tabla en cada punto de escritura de este módulo.
_registrar_creacion = partial(registrar_creacion, modulo=_MODULO, nom_tabla=_TABLA)
_registrar_actualizacion = partial(registrar_actualizacion, modulo=_MODULO, nom_tabla=_TABLA)


def _user_categorias(user):
    # "Eliminado" no se usa desde la UI (solo "anular" -> Anulado), pero se excluye acá
    # por si algún día se purga algo manualmente; todo lo demás (Activo, Anulado) se ve.
    return (
        Categoria.objects.filter(key_user=user)
        .exclude(key_status__name="Eliminado")
        .select_related("key_tipo", "key_status")
    )


def _has_permission(access, decorator_name: str) -> bool:
    return ALL_PERMISSIONS_BACK in access.permisos_back or decorator_name in access.permisos_back


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def list_tipos_categoria(request):
    """Catálogo de Gasto/Ingreso: alimenta el dropdown de la columna Tipo en la grilla."""
    tipos = TipoCategoria.objects.filter(key_status__name=ACTIVE_STATUS_NAME).order_by("name")
    return Response(TipoCategoriaSerializer(tipos, many=True).data)


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def list_categorias(request):
    categorias = _user_categorias(request.user).order_by("key_status__name", "name")
    return Response(CategoriaSerializer(categorias, many=True).data)


def _owned_categoria_or_404(categoria_id, usuario) -> Categoria:
    # No alcanza con que el id exista: tiene que ser DE ESTE usuario — si no, cualquiera
    # podría leer el historial de un registro ajeno adivinando/probando su UUID.
    categoria = Categoria.objects.filter(id=categoria_id, key_user=usuario).first()
    if categoria is None:
        raise Http404
    return categoria


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def categoria_historial(request, categoria_id):
    """Un evento de auditoría por fila (creación, ediciones, anulación/inactivación,
    restauración, importación) — ver apps.historial. key_record/nom_tabla identifican el
    registro puntual, no hace falta que el frontend sepa nada de ese esquema."""
    categoria = _owned_categoria_or_404(categoria_id, request.user)
    historial = (
        Historial.objects.filter(nom_tabla=_TABLA, key_record=str(categoria.id))
        .select_related("key_usuario")
        .order_by("-fecha_hora")
    )
    return Response(HistorialSerializer(historial, many=True).data)


@log_data_access
@require_permission(constants.PERM_READ)
@api_view(["GET"])
def categoria_historial_detalle(request, categoria_id, historial_id):
    """Columna por columna qué valor tenía antes y cuál después, para un evento puntual del
    historial (botón "Detalle" en el frontend)."""
    categoria = _owned_categoria_or_404(categoria_id, request.user)
    historial = Historial.objects.filter(id=historial_id, nom_tabla=_TABLA, key_record=str(categoria.id)).first()
    if historial is None:
        raise Http404
    detalles = historial.detalles.order_by("columna")
    return Response(HistorialDetalleSerializer(detalles, many=True).data)


# Un nombre ya usado por un registro Activo o Inactivo del mismo usuario bloquea crear/
# renombrar a ese nombre — uno Anulado no: anular "libera" el nombre para volver a crear
# (el anulado en sí no se toca ni se reactiva por esto, ver _parse_categorias_file para el
# caso de importación, que si reactiva cuando el que coincide es Inactivo).
def _find_blocking_duplicate(usuario, name: str, exclude_id=None) -> Categoria | None:
    qs = Categoria.objects.filter(key_user=usuario, name__iexact=name).exclude(key_status__name=VOIDED_STATUS_NAME)
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.select_related("key_status").first()


def _crear_categorias(payload: list[dict], usuario, active_status) -> None:
    for row in payload:
        name = (row.get("name") or "").strip()
        if name and _find_blocking_duplicate(usuario, name):
            raise ValidationError(message.nombre_duplicado(name))
        serializer = CategoriaSerializer(data=row)
        serializer.is_valid(raise_exception=True)
        categoria = serializer.save(
            key_user=usuario,
            key_status=active_status,
            key_creator_user=usuario,
            key_updater_user=usuario,
        )
        _registrar_creacion(usuario=usuario, instance=categoria)


def _actualizar_categorias(payload: list[dict], usuario) -> None:
    for row in payload:
        categoria_id = row.get("id")
        if not categoria_id:
            raise ValidationError(message.UPDATE_SIN_ID)
        categoria = Categoria.objects.filter(id=categoria_id, key_user=usuario).first()
        if categoria is None:
            raise ValidationError(message.categoria_no_existe(categoria_id))
        new_name = (row.get("name") or "").strip()
        if new_name and new_name.lower() != categoria.name.strip().lower():
            if _find_blocking_duplicate(usuario, new_name, exclude_id=categoria.id):
                raise ValidationError(message.nombre_duplicado(new_name))
        antes = snapshot(categoria)
        serializer = CategoriaSerializer(categoria, data=row, partial=True)
        serializer.is_valid(raise_exception=True)
        categoria = serializer.save(key_updater_user=usuario)
        _registrar_actualizacion(usuario=usuario, antes=antes, despues_instance=categoria)


def _anular_categorias(voided_ids: list[str], usuario, voided_status) -> None:
    to_void = list(
        Categoria.objects.filter(id__in=voided_ids, key_user=usuario).select_related("key_tipo", "key_status")
    )
    if len(to_void) != len(set(voided_ids)):
        raise ValidationError(message.ANULAR_NO_EXISTE)

    antes_por_id = {categoria.id: snapshot(categoria) for categoria in to_void}
    Categoria.objects.filter(id__in=voided_ids, key_user=usuario).update(
        key_status=voided_status, key_updater_user=usuario
    )
    for categoria in to_void:
        categoria.key_status = voided_status
        categoria.key_updater_user = usuario
        _registrar_actualizacion(usuario=usuario, antes=antes_por_id[categoria.id], despues_instance=categoria, evento="delete")


# Inversa de _anular_categorias (y de _inactivar_categorias, más abajo): vuelve a Activo una
# categoría Anulada O Inactiva, no distingue cuál de las dos era — a las dos las manda acá
# el mismo botón "Activar registro" del menú click-derecho (ver isRowVoided/isRowInactive en
# crud-grid.tsx). Mismo patrón (select + update en lote + historial fila por fila),
# evento="update" (default) en vez de "delete" porque no es una baja, es deshacerla.
def _restaurar_categorias(restored_ids: list[str], usuario, active_status) -> None:
    to_restore = list(
        Categoria.objects.filter(id__in=restored_ids, key_user=usuario).select_related("key_tipo", "key_status")
    )
    if len(to_restore) != len(set(restored_ids)):
        raise ValidationError(message.RESTAURAR_NO_EXISTE)

    antes_por_id = {categoria.id: snapshot(categoria) for categoria in to_restore}
    Categoria.objects.filter(id__in=restored_ids, key_user=usuario).update(
        key_status=active_status, key_updater_user=usuario
    )
    for categoria in to_restore:
        categoria.key_status = active_status
        categoria.key_updater_user = usuario
        _registrar_actualizacion(usuario=usuario, antes=antes_por_id[categoria.id], despues_instance=categoria)


# Como _anular_categorias pero a Inactivo en vez de Anulado — evento="update" (default,
# no "delete") porque a diferencia de anular, esto no es una baja del registro.
def _inactivar_categorias(inactivated_ids: list[str], usuario, inactive_status) -> None:
    to_inactivate = list(
        Categoria.objects.filter(id__in=inactivated_ids, key_user=usuario).select_related("key_tipo", "key_status")
    )
    if len(to_inactivate) != len(set(inactivated_ids)):
        raise ValidationError(message.INACTIVAR_NO_EXISTE)

    antes_por_id = {categoria.id: snapshot(categoria) for categoria in to_inactivate}
    Categoria.objects.filter(id__in=inactivated_ids, key_user=usuario).update(
        key_status=inactive_status, key_updater_user=usuario
    )
    for categoria in to_inactivate:
        categoria.key_status = inactive_status
        categoria.key_updater_user = usuario
        _registrar_actualizacion(usuario=usuario, antes=antes_por_id[categoria.id], despues_instance=categoria)


@log_data_access
@require_permission()
@api_view(["POST"])
def bulk_save_categorias(request):
    """Guarda de una vez lo que el usuario acumuló en la grilla: filas nuevas, celdas
    editadas, anulaciones, inactivaciones y restauraciones (individuales o masivas, da igual
    — todo llega acá como listas).

    No usa require_permission(decorator_name) con un permiso fijo porque un mismo request
    puede mezclar create+update+delete; se valida cada bolsa del payload contra el permiso
    que le corresponde, a mano, con build_user_access. Sigue siendo un único request/response
    (mismo contrato con el frontend, ver categorias-api.ts) y una única transacción atómica
    (todo o nada) — lo único que cambia es que el procesamiento de cada bolsa vive en su
    propia función (_crear_categorias/_actualizar_categorias/_anular_categorias/etc.), así
    cada una se puede leer y testear por separado.
    """
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
            _crear_categorias(created_payload, request.user, active_status)
        if updated_payload:
            _actualizar_categorias(updated_payload, request.user)
        if voided_ids:
            _anular_categorias(voided_ids, request.user, voided_status)
        if restored_ids:
            _restaurar_categorias(restored_ids, request.user, active_status)
        if inactivated_ids:
            _inactivar_categorias(inactivated_ids, request.user, inactive_status)

    categorias = _user_categorias(request.user).order_by("key_status__name", "name")
    return Response(CategoriaSerializer(categorias, many=True).data)


@log_data_access
@require_permission(constants.PERM_IMPORT)
@api_view(["GET"])
def categorias_template(request):
    df = pd.DataFrame(
        [["Comida", "Gasto", "Almuerzo y supermercado", "#22c55e", "i-lucide-utensils"]],
        columns=constants.TEMPLATE_COLUMNS,
    )
    return excel_utils.dataframe_to_xlsx_response(
        df, "plantilla_categorias.xlsx", constants.SHEET_NAME, ACTIVE_STATUS_NAME, VOIDED_STATUS_NAME
    )


# Mismos cuatro valores que el filtro de estado de la grilla (ver statusFilter en
# crud-grid.tsx) — "all" no filtra nada, por eso no está en este dict.
_EXPORT_STATUS_FILTERS = {
    "active": ACTIVE_STATUS_NAME,
    "inactive": INACTIVE_STATUS_NAME,
    "voided": VOIDED_STATUS_NAME,
}


@log_data_access
@require_permission(constants.PERM_EXPORT)
@api_view(["GET"])
def export_categorias(request):
    categorias = _user_categorias(request.user)
    # Exporta lo mismo que se está viendo en la grilla en ese momento (Activos/Inactivos/
    # Anulados/Todos), no siempre todo — ver handleExport en crud-grid.tsx, que manda el
    # statusFilter actual.
    status_name = _EXPORT_STATUS_FILTERS.get(request.GET.get("status"))
    if status_name:
        categorias = categorias.filter(key_status__name=status_name)
    categorias = categorias.order_by("name")
    df = pd.DataFrame(
        [
            {
                "Nombre": categoria.name,
                "Tipo": categoria.key_tipo.name if categoria.key_tipo else "",
                "Descripción": categoria.description or "",
                "Color": categoria.color or "",
                "Ícono": categoria.icon or "",
                "Estado": categoria.key_status.name if categoria.key_status else "",
            }
            for categoria in categorias
        ],
        columns=[*constants.TEMPLATE_COLUMNS, "Estado"],
    )
    return excel_utils.dataframe_to_xlsx_response(
        df, "categorias.xlsx", constants.SHEET_NAME, ACTIVE_STATUS_NAME, VOIDED_STATUS_NAME
    )


def _parse_categorias_file(
    uploaded, user, progress_cb: Callable[[int, int], None] | None = None
) -> tuple[list[dict], list[dict], list[Categoria], list[tuple[Categoria, dict]]]:
    """Lee y valida el .xlsx de categorías. No toca la base de datos — separado de la
    escritura para que el mismo parseo alimente tanto la vista de validación (preview, sin
    guardar nada) como la de importación real (que además hace el bulk_create/bulk_update).

    Las filas devueltas usan las mismas claves ("name", "tipo", ...) que el resto del
    frontend (columnas de la grilla, payload de bulk-save), no los encabezados en español
    del Excel — así el componente de preview puede resaltar la celda con error por su
    `data` de columna, sin tener que traducir encabezados.

    progress_cb(procesadas, total), si se pasa, se llama con el avance real fila a fila —
    lo usa _run_import_validation_job para que el frontend pueda mostrar un % real en vez
    de un spinner ciego (ver CategoriaImportJob). Import (paso 2) no lo necesita, así que
    ahí queda en None.

    Un nombre que coincide con un registro existente Activo o (cualquier otro status que no
    sea Anulado/Inactivo) es un duplicado real → error. Uno Anulado no bloquea — se crea un
    registro nuevo aparte, el anulado queda como está (mismo criterio que
    _find_blocking_duplicate para crear/editar a mano). Uno Inactivo sí bloquea la creación,
    pero en vez de ser un error, esa fila reactiva ese registro (to_reactivate) en lugar de
    crear uno nuevo — es el único caso donde importar reactiva algo.
    """
    if uploaded is None:
        raise ValidationError(message.FALTA_ARCHIVO)

    try:
        df = pd.read_excel(uploaded, dtype=str, engine="openpyxl").fillna("")
    except Exception as exc:
        raise ValidationError(message.archivo_ilegible(exc)) from exc

    missing_columns = {"Nombre", "Tipo"} - set(df.columns)
    if missing_columns:
        raise ValidationError(message.columnas_faltantes(missing_columns))

    total_rows = len(df)
    if progress_cb is not None:
        progress_cb(0, total_rows)

    tipos_by_name = {
        tipo.name.strip().lower(): tipo for tipo in TipoCategoria.objects.filter(key_status__name=ACTIVE_STATUS_NAME)
    }
    # Si el mismo nombre tiene más de un registro (p.ej. uno Anulado y otro Activo, posible
    # justamente porque Anulado ya no bloquea crear), el que importa acá es el no-Anulado —
    # es el que puede bloquear o reactivarse; el Anulado es como si no existiera para esto.
    existing_by_name: dict[str, Categoria] = {}
    for categoria in _user_categorias(user):
        key = categoria.name.strip().lower()
        current = existing_by_name.get(key)
        if current is None or (current.key_status and current.key_status.name == VOIDED_STATUS_NAME):
            existing_by_name[key] = categoria

    preview_rows: list[dict] = []
    errors: list[dict] = []
    to_create: list[Categoria] = []
    to_reactivate: list[tuple[Categoria, dict]] = []
    seen_names: set[str] = set()
    active_status = get_status_by_name(ACTIVE_STATUS_NAME)
    last_reported_percent = -1

    for position, row in df.iterrows():
        # Al principio del loop (no al final): la fila puede saltar al resto del cuerpo
        # con "continue" más abajo (fila en blanco, fila con error), y el progreso tiene
        # que reportarse en todos los casos, no solo cuando la fila llega hasta el final.
        if progress_cb is not None:
            processed = position + 1
            percent = int(processed * 100 / total_rows) if total_rows else 100
            if percent != last_reported_percent:
                progress_cb(processed, total_rows)
                last_reported_percent = percent

        excel_row = position + 2  # +1 por el header, +1 porque iterrows es 0-based

        name = str(row.get("Nombre", "")).strip()
        tipo_name = str(row.get("Tipo", "")).strip()
        description = str(row.get("Descripción", "")).strip()
        color = str(row.get("Color", "")).strip()
        icon = str(row.get("Ícono", "")).strip()

        if not name and not tipo_name:
            continue  # fila en blanco, se ignora

        preview_rows.append(
            {
                "row": excel_row,
                "fields": {"name": name, "tipo": tipo_name, "description": description, "color": color, "icon": icon},
            }
        )

        existing = existing_by_name.get(name.lower()) if name else None
        existing_status_name = existing.key_status.name if existing and existing.key_status else None

        row_had_error = False
        if not name:
            errors.append({"row": excel_row, "field": "name", "message": message.NOMBRE_OBLIGATORIO})
            row_had_error = True
        elif name.lower() in seen_names:
            errors.append({"row": excel_row, "field": "name", "message": message.nombre_duplicado(name)})
            row_had_error = True
        elif existing is not None and existing_status_name not in (VOIDED_STATUS_NAME, INACTIVE_STATUS_NAME):
            errors.append({"row": excel_row, "field": "name", "message": message.nombre_duplicado(name)})
            row_had_error = True

        tipo = tipos_by_name.get(tipo_name.lower())
        if tipo is None:
            errors.append({"row": excel_row, "field": "tipo", "message": message.tipo_invalido(tipo_name)})
            row_had_error = True

        if row_had_error:
            continue

        seen_names.add(name.lower())
        if existing is not None and existing_status_name == INACTIVE_STATUS_NAME:
            antes = snapshot(existing)
            existing.key_tipo = tipo
            existing.description = description or None
            existing.color = color or None
            existing.icon = icon or None
            existing.key_status = active_status
            existing.key_updater_user = user
            to_reactivate.append((existing, antes))
        else:
            to_create.append(
                Categoria(
                    key_user=user,
                    key_tipo=tipo,
                    name=name,
                    description=description or None,
                    color=color or None,
                    icon=icon or None,
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


def _run_import_validation_job(job_id, file_bytes: bytes, user_id) -> None:
    """Corre en un hilo aparte del request que lo disparó (ver start_categorias_import_validate).
    Django no comparte conexiones a la base entre hilos, así que hay que cerrar cualquier
    conexión heredada al empezar (fuerza una nueva, propia de este hilo) y al terminar (para
    no dejarla abierta)."""
    close_old_connections()
    try:
        user = get_user_model().objects.get(pk=user_id)
        done_status = get_status_by_name(JOB_DONE_STATUS_NAME)

        def progress_cb(processed: int, total: int) -> None:
            CategoriaImportJob.objects.filter(pk=job_id).update(processed_rows=processed, total_rows=total)

        preview_rows, errors, _, _ = _parse_categorias_file(io.BytesIO(file_bytes), user, progress_cb=progress_cb)
        CategoriaImportJob.objects.filter(pk=job_id).update(
            key_status=done_status, result={"rows": preview_rows, "errors": errors}
        )
    except Exception as exc:
        # Si esto no se atrapa acá, la excepción muere silenciosa en el hilo y el job queda
        # "Procesando" para siempre — el frontend seguiría consultando el estado sin parar.
        error_status = get_status_by_name(JOB_ERROR_STATUS_NAME)
        CategoriaImportJob.objects.filter(pk=job_id).update(
            key_status=error_status, error_message=_job_error_message(exc)
        )
    finally:
        close_old_connections()


@log_data_access
@require_permission(constants.PERM_IMPORT)
@api_view(["POST"])
def start_categorias_import_validate(request):
    """Arranca el análisis del archivo en un hilo aparte y devuelve enseguida un job_id —
    el frontend va consultando categorias_import_validate_status con ese id hasta que
    termine, en vez de esperar a ciegas un solo request largo (ver
    _run_import_validation_job)."""
    uploaded = request.FILES.get("file")
    if uploaded is None:
        raise ValidationError(message.FALTA_ARCHIVO)
    file_bytes = uploaded.read()

    # Housekeeping barato: en vez de un cron/management command aparte para purgar jobs
    # viejos, se limpian los del propio usuario cada vez que arranca uno nuevo.
    CategoriaImportJob.objects.filter(
        key_user=request.user, creation_date__lt=timezone.now() - timedelta(hours=1)
    ).delete()

    processing_status = get_status_by_name(JOB_PROCESSING_STATUS_NAME)
    job = CategoriaImportJob.objects.create(
        key_user=request.user,
        key_status=processing_status,
        key_creator_user=request.user,
        key_updater_user=request.user,
    )
    threading.Thread(
        target=_run_import_validation_job, args=(job.id, file_bytes, request.user.id), daemon=True
    ).start()
    return Response({"job_id": str(job.id)}, status=status.HTTP_202_ACCEPTED)


@log_data_access
@require_permission(constants.PERM_IMPORT)
@api_view(["GET"])
def categorias_import_validate_status(request, job_id):
    job = CategoriaImportJob.objects.filter(pk=job_id, key_user=request.user).select_related("key_status").first()
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
def import_categorias(request):
    """Confirma la importación: todo o nada, si alguna fila tiene un error no se crea
    ninguna (mismo parseo que la vista de validación). Además de crear, un nombre que
    coincide con un registro Inactivo lo reactiva (to_reactivate) en vez de crear uno
    nuevo — ver _parse_categorias_file."""
    uploaded = request.FILES.get("file")
    _, errors, to_create, to_reactivate = _parse_categorias_file(uploaded, request.user)

    if errors:
        return Response({"committed": False, "created_count": 0, "errors": errors}, status=status.HTTP_400_BAD_REQUEST)

    Categoria.objects.bulk_create(to_create)
    for categoria in to_create:
        _registrar_creacion(usuario=request.user, instance=categoria, evento="import")

    if to_reactivate:
        Categoria.objects.bulk_update(
            [categoria for categoria, _ in to_reactivate],
            fields=["key_tipo", "description", "color", "icon", "key_status", "key_updater_user"],
        )
        for categoria, antes in to_reactivate:
            _registrar_actualizacion(usuario=request.user, antes=antes, despues_instance=categoria, evento="import")

    return Response(
        {"committed": True, "created_count": len(to_create) + len(to_reactivate), "errors": []}
    )
