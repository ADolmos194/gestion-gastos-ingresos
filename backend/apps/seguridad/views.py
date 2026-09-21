from functools import partial

from django.db import transaction
from django.http import Http404
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.autenticacion.models import User
from apps.autenticacion.serializers import UserSerializer
from apps.configuraciones.services import (
    ACTIVE_STATUS_NAME,
    INACTIVE_STATUS_NAME,
    VOIDED_STATUS_NAME,
    get_status_by_name,
    lock_duplicate_guard,
)
from apps.historial.services import registrar_actualizacion, registrar_creacion, snapshot

from . import constants, message
from .decorators import log_data_access, require_permission
from .models import Menu, Permission, PermissionRole, Role, RoleMenu, UserRole
from .serializers import MenuSerializer, PermissionSerializer, RoleSerializer

_MODULO = "seguridad"
_TABLA_ROL = Role._meta.db_table

# Para no repetir modulo/nom_tabla en cada punto de escritura de este módulo (mismo
# criterio que categoria/views.py y moneda/views.py).
_registrar_creacion = partial(registrar_creacion, modulo=_MODULO, nom_tabla=_TABLA_ROL)
_registrar_actualizacion = partial(registrar_actualizacion, modulo=_MODULO, nom_tabla=_TABLA_ROL)


# ---------------------------------------------------------------------------
# Roles — catálogo global (sin key_user, como TipoCategoria) con el mismo contrato de
# bulk-save (created/updated/voided/restored/inactivated) que Categorías/Monedas, para que
# el frontend pueda reusar el mismo <RolesPage> armado sobre useCrudGrid.
# ---------------------------------------------------------------------------


def _find_blocking_role_duplicate(name: str, exclude_id=None) -> Role | None:
    """A diferencia de Categoria/Moneda (ver _find_blocking_duplicate en esos views.py),
    acá NO se excluye Anulado: Role.name tiene unique=True real a nivel de base (igual que
    TipoCategoria, ver models.py) — un nombre anulado sigue reservado para siempre, porque
    un catálogo de roles global no tiene el mismo caso de uso de "recrear con el mismo
    nombre" que una entidad por-usuario. Esto solo agrega el chequeo case-insensitive
    (la constraint de la base es case-sensitive); el RoleSerializer ya rechaza el
    duplicado exacto vía su UniqueValidator automático."""
    qs = Role.objects.filter(name__iexact=name)
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.select_related("key_status").first()


def _active_all_access_role_count(exclude_id=None) -> int:
    qs = Role.objects.filter(all_access=True, key_status__name=ACTIVE_STATUS_NAME)
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.count()


def _assert_no_deja_sin_all_access(role: Role) -> None:
    """Corta acá si `role` es el único rol con acceso total activo del sistema — sea que
    se lo esté anulando/inactivando, sea que se le esté por sacar el flag all_access en un
    update (ver _actualizar_roles). Sin esto, un admin distraído podría dejar a todo el
    mundo sin forma de volver a entrar a este mismo panel."""
    if role.all_access and role.key_status and role.key_status.name == ACTIVE_STATUS_NAME:
        if _active_all_access_role_count(exclude_id=role.id) == 0:
            raise ValidationError(message.ULTIMO_ROL_ALL_ACCESS)


@log_data_access
@require_permission(constants.PERM_MANAGE)
@api_view(["GET"])
def list_roles(request):
    roles = Role.objects.select_related("key_status").order_by("key_status__name", "name")
    return Response(RoleSerializer(roles, many=True).data)


def _crear_roles(payload: list[dict], usuario, active_status) -> None:
    for row in payload:
        name = (row.get("name") or "").strip()
        if name:
            lock_duplicate_guard(_TABLA_ROL, "global", name)
            if _find_blocking_role_duplicate(name):
                raise ValidationError(message.rol_nombre_duplicado(name))
        serializer = RoleSerializer(data=row)
        serializer.is_valid(raise_exception=True)
        role = serializer.save(key_status=active_status, key_creator_user=usuario, key_updater_user=usuario)
        _registrar_creacion(usuario=usuario, instance=role)


def _actualizar_roles(payload: list[dict], usuario) -> None:
    for row in payload:
        role_id = row.get("id")
        if not role_id:
            raise ValidationError(message.UPDATE_SIN_ID)
        role = Role.objects.filter(id=role_id).select_related("key_status").first()
        if role is None:
            raise ValidationError(message.rol_no_existe(role_id))

        new_name = (row.get("name") or "").strip()
        if new_name and new_name.lower() != role.name.strip().lower():
            lock_duplicate_guard(_TABLA_ROL, "global", new_name)
            if _find_blocking_role_duplicate(new_name, exclude_id=role.id):
                raise ValidationError(message.rol_nombre_duplicado(new_name))

        if "all_access" in row and not row.get("all_access") and role.all_access:
            _assert_no_deja_sin_all_access(role)

        antes = snapshot(role)
        serializer = RoleSerializer(role, data=row, partial=True)
        serializer.is_valid(raise_exception=True)
        role = serializer.save(key_updater_user=usuario)
        _registrar_actualizacion(usuario=usuario, antes=antes, despues_instance=role)


def _anular_o_inactivar_roles(role_ids: list[str], usuario, target_status, not_found_msg: str) -> None:
    roles = list(Role.objects.filter(id__in=role_ids).select_related("key_status"))
    if len(roles) != len(set(role_ids)):
        raise ValidationError(not_found_msg)
    for role in roles:
        _assert_no_deja_sin_all_access(role)

    antes_por_id = {role.id: snapshot(role) for role in roles}
    Role.objects.filter(id__in=role_ids).update(key_status=target_status, key_updater_user=usuario)
    for role in roles:
        role.key_status = target_status
        role.key_updater_user = usuario
        evento = "delete" if target_status.name == VOIDED_STATUS_NAME else "update"
        _registrar_actualizacion(usuario=usuario, antes=antes_por_id[role.id], despues_instance=role, evento=evento)


def _restaurar_roles(role_ids: list[str], usuario, active_status) -> None:
    roles = list(Role.objects.filter(id__in=role_ids).select_related("key_status"))
    if len(roles) != len(set(role_ids)):
        raise ValidationError(message.RESTAURAR_NO_EXISTE)

    antes_por_id = {role.id: snapshot(role) for role in roles}
    Role.objects.filter(id__in=role_ids).update(key_status=active_status, key_updater_user=usuario)
    for role in roles:
        role.key_status = active_status
        role.key_updater_user = usuario
        _registrar_actualizacion(usuario=usuario, antes=antes_por_id[role.id], despues_instance=role)


@log_data_access
@require_permission(constants.PERM_MANAGE)
@api_view(["POST"])
def bulk_save_roles(request):
    """Mismo contrato que bulk_save_monedas/bulk_save_tipos_categoria: un único request/
    transacción para created/updated/voided/restored/inactivated. Acá, a diferencia de esos
    dos, un solo permiso (PERM_MANAGE) gatilla las cinco bolsas — ver constants.py."""
    created_payload = request.data.get("created") or []
    updated_payload = request.data.get("updated") or []
    voided_ids = request.data.get("voided") or []
    restored_ids = request.data.get("restored") or []
    inactivated_ids = request.data.get("inactivated") or []

    active_status = get_status_by_name(ACTIVE_STATUS_NAME)
    voided_status = get_status_by_name(VOIDED_STATUS_NAME)
    inactive_status = get_status_by_name(INACTIVE_STATUS_NAME)

    with transaction.atomic():
        if created_payload:
            _crear_roles(created_payload, request.user, active_status)
        if updated_payload:
            _actualizar_roles(updated_payload, request.user)
        if voided_ids:
            _anular_o_inactivar_roles(voided_ids, request.user, voided_status, message.ANULAR_NO_EXISTE)
        if restored_ids:
            _restaurar_roles(restored_ids, request.user, active_status)
        if inactivated_ids:
            _anular_o_inactivar_roles(inactivated_ids, request.user, inactive_status, message.INACTIVAR_NO_EXISTE)

    roles = Role.objects.select_related("key_status").order_by("key_status__name", "name")
    return Response(RoleSerializer(roles, many=True).data)


# ---------------------------------------------------------------------------
# Catálogos de solo lectura que alimentan las listas de "disponibles" en las pantallas de
# asignación (Permisos/Menús) — ver PermissionSerializer/MenuSerializer, ninguno de los dos
# tiene CRUD propio (ver sus docstrings).
# ---------------------------------------------------------------------------


@log_data_access
@require_permission(constants.PERM_MANAGE)
@api_view(["GET"])
def list_permissions(request):
    permissions = Permission.objects.select_related("key_action", "key_status").order_by("module_name", "decorator_name")
    return Response(PermissionSerializer(permissions, many=True).data)


@log_data_access
@require_permission(constants.PERM_MANAGE)
@api_view(["GET"])
def list_menus(request):
    menus = (
        Menu.objects.filter(key_status__name=ACTIVE_STATUS_NAME)
        .select_related("key_status", "key_father_menu", "key_father_menu__key_father_menu")
        .order_by("ordering")
    )
    return Response(MenuSerializer(menus, many=True).data)


# ---------------------------------------------------------------------------
# Asignación rol <-> permiso / rol <-> menú / usuario <-> rol: mismo patrón de "listas
# duales" para los tres (ver _sync_join) — un GET trae los ids ya asignados, un POST
# reemplaza el conjunto completo por el que mande el frontend. Nunca se borra la fila del
# vínculo: se anula/reactiva (mismo criterio "anular, no borrar" que el resto del sistema),
# así queda rastro de qué tuvo asignado un rol/usuario alguna vez.
# ---------------------------------------------------------------------------


def _sync_join(model, owner_id_field: str, owner_id, other_id_field: str, other_ids, usuario, active_status, voided_status) -> None:
    other_ids = {str(other_id) for other_id in other_ids}
    owner_filter = {owner_id_field: owner_id}
    existing = list(model.objects.filter(**owner_filter))
    existing_by_other = {str(getattr(row, other_id_field)): row for row in existing}

    to_create_ids = other_ids - set(existing_by_other)
    if to_create_ids:
        model.objects.bulk_create(
            [
                model(
                    **owner_filter,
                    **{other_id_field: other_id},
                    key_status=active_status,
                    key_creator_user=usuario,
                    key_updater_user=usuario,
                )
                for other_id in to_create_ids
            ]
        )

    to_reactivate_ids = []
    to_deactivate_ids = []
    for other_id, row in existing_by_other.items():
        currently_active = row.key_status_id == active_status.id
        should_be_active = other_id in other_ids
        if should_be_active and not currently_active:
            to_reactivate_ids.append(row.id)
        elif not should_be_active and currently_active:
            to_deactivate_ids.append(row.id)

    if to_reactivate_ids:
        model.objects.filter(id__in=to_reactivate_ids).update(key_status=active_status, key_updater_user=usuario)
    if to_deactivate_ids:
        model.objects.filter(id__in=to_deactivate_ids).update(key_status=voided_status, key_updater_user=usuario)


def _active_other_ids(model, owner_id_field: str, owner_id, other_id_field: str) -> list[str]:
    return [
        str(value)
        for value in model.objects.filter(**{owner_id_field: owner_id}, key_status__name=ACTIVE_STATUS_NAME).values_list(
            other_id_field, flat=True
        )
    ]


def _get_role_or_404(role_id) -> Role:
    role = Role.objects.filter(id=role_id).select_related("key_status").first()
    if role is None:
        raise Http404
    return role


@log_data_access
@require_permission(constants.PERM_MANAGE)
@api_view(["GET", "POST"])
def role_permissions(request, role_id):
    role = _get_role_or_404(role_id)

    if request.method == "GET":
        assigned_ids = _active_other_ids(PermissionRole, "key_role_id", role.id, "key_permission_id")
        return Response({"assigned_ids": assigned_ids})

    permission_ids = request.data.get("permission_ids") or []
    valid_ids = set(
        str(pk) for pk in Permission.objects.filter(id__in=permission_ids).values_list("id", flat=True)
    )
    missing = set(str(pid) for pid in permission_ids) - valid_ids
    if missing:
        raise ValidationError(message.permiso_no_existe(next(iter(missing))))

    active_status = get_status_by_name(ACTIVE_STATUS_NAME)
    voided_status = get_status_by_name(VOIDED_STATUS_NAME)
    with transaction.atomic():
        _sync_join(PermissionRole, "key_role_id", role.id, "key_permission_id", permission_ids, request.user, active_status, voided_status)

    assigned_ids = _active_other_ids(PermissionRole, "key_role_id", role.id, "key_permission_id")
    return Response({"assigned_ids": assigned_ids})


@log_data_access
@require_permission(constants.PERM_MANAGE)
@api_view(["GET", "POST"])
def role_menus(request, role_id):
    role = _get_role_or_404(role_id)

    if request.method == "GET":
        assigned_ids = _active_other_ids(RoleMenu, "key_role_id", role.id, "key_menu_id")
        return Response({"assigned_ids": assigned_ids})

    menu_ids = request.data.get("menu_ids") or []
    valid_ids = set(str(pk) for pk in Menu.objects.filter(id__in=menu_ids).values_list("id", flat=True))
    missing = set(str(mid) for mid in menu_ids) - valid_ids
    if missing:
        raise ValidationError(message.menu_no_existe(next(iter(missing))))

    active_status = get_status_by_name(ACTIVE_STATUS_NAME)
    voided_status = get_status_by_name(VOIDED_STATUS_NAME)
    with transaction.atomic():
        _sync_join(RoleMenu, "key_role_id", role.id, "key_menu_id", menu_ids, request.user, active_status, voided_status)

    assigned_ids = _active_other_ids(RoleMenu, "key_role_id", role.id, "key_menu_id")
    return Response({"assigned_ids": assigned_ids})


# ---------------------------------------------------------------------------
# Usuarios — acá NO se crean/editan cuentas (eso es apps.autenticacion, vía registro), solo
# se lista quién existe y se administra qué roles tiene cada quien.
# ---------------------------------------------------------------------------


@log_data_access
@require_permission(constants.PERM_MANAGE)
@api_view(["GET"])
def list_usuarios(request):
    usuarios = User.objects.order_by("username")
    role_ids_by_user: dict[str, list[str]] = {}
    for user_id, role_id in UserRole.objects.filter(key_status__name=ACTIVE_STATUS_NAME).values_list("key_user_id", "key_role_id"):
        role_ids_by_user.setdefault(str(user_id), []).append(str(role_id))

    data = UserSerializer(usuarios, many=True).data
    for row in data:
        row["role_ids"] = role_ids_by_user.get(row["id"], [])
    return Response(data)


def _get_user_or_404(user_id) -> User:
    user = User.objects.filter(id=user_id).first()
    if user is None:
        raise Http404
    return user


@log_data_access
@require_permission(constants.PERM_MANAGE)
@api_view(["GET", "POST"])
def usuario_roles(request, user_id):
    usuario_objetivo = _get_user_or_404(user_id)

    if request.method == "GET":
        assigned_ids = _active_other_ids(UserRole, "key_user_id", usuario_objetivo.id, "key_role_id")
        return Response({"assigned_ids": assigned_ids})

    role_ids = request.data.get("role_ids") or []
    valid_roles = {
        str(role.id): role
        for role in Role.objects.filter(id__in=role_ids).select_related("key_status")
    }
    missing = set(str(rid) for rid in role_ids) - set(valid_roles)
    if missing:
        raise ValidationError(message.rol_no_existe(next(iter(missing))))

    # Guarda de autoprotección: si quien ejecuta esto se está editando a sí mismo, no puede
    # quedar sin ningún rol con acceso total activo entre los que va a tener después del
    # cambio (ver message.AUTO_QUITAR_ALL_ACCESS). Es un chequeo por-usuario, no por-sistema
    # (para eso está _assert_no_deja_sin_all_access en el Role en sí) — protege al usuario
    # concreto de un descuido, no reemplaza la otra guarda.
    if usuario_objetivo.id == request.user.id:
        tenia_all_access = UserRole.objects.filter(
            key_user_id=usuario_objetivo.id,
            key_status__name=ACTIVE_STATUS_NAME,
            key_role__all_access=True,
            key_role__key_status__name=ACTIVE_STATUS_NAME,
        ).exists()
        tendra_all_access = any(valid_roles[str(rid)].all_access for rid in role_ids if str(rid) in valid_roles)
        if tenia_all_access and not tendra_all_access:
            raise ValidationError(message.AUTO_QUITAR_ALL_ACCESS)

    active_status = get_status_by_name(ACTIVE_STATUS_NAME)
    voided_status = get_status_by_name(VOIDED_STATUS_NAME)
    with transaction.atomic():
        _sync_join(UserRole, "key_user_id", usuario_objetivo.id, "key_role_id", role_ids, request.user, active_status, voided_status)

    assigned_ids = _active_other_ids(UserRole, "key_user_id", usuario_objetivo.id, "key_role_id")
    return Response({"assigned_ids": assigned_ids})
