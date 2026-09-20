from dataclasses import dataclass

from .models import Menu, Permission, RoleMenu, UserRole

# Nombre de status "activo" tal como lo define cfg_status (ver seed_statuses.json). Se
# filtra por nombre en vez de hardcodear el UUID para no acoplar este servicio al seed.
_ACTIVE_STATUS_NAME = "Activo"

# El menú del sidebar es el del sistema Web (ver seed_system.json: "... - Web" vs "... -
# Mobile"). Se filtra por nombre para no acoplar este servicio al UUID del seed.
_WEB_SYSTEM_NAME_HINT = "Web"

# Sentinel que el frontend interpreta como "sin restricciones" (ver Role.all_access).
ALL_PERMISSIONS_BACK = "ALL_PERMISSIONS"
ALL_PERMISSIONS_FRONT = {"action": "manage", "subject": "all"}


@dataclass(frozen=True)
class UserAccess:
    """Resultado de resolver qué puede ver/hacer un usuario: árbol de menú + permisos,
    listo para mandar al frontend tal cual (ver apps.autenticacion.services)."""

    all_access: bool
    has_access: bool
    menus: list[dict]
    permisos_front: list[dict]
    permisos_back: list[str]


def build_user_access(user) -> UserAccess:
    active_roles = [
        user_role.key_role
        for user_role in UserRole.objects.filter(
            key_user=user,
            key_status__name__iexact=_ACTIVE_STATUS_NAME,
            key_role__key_status__name__iexact=_ACTIVE_STATUS_NAME,
        ).select_related("key_role")
    ]

    if not active_roles:
        return UserAccess(all_access=False, has_access=False, menus=[], permisos_front=[], permisos_back=[])

    if any(role.all_access for role in active_roles):
        # Acceso total: todo el menú activo del sistema Web, sin pasar por RoleMenu/PermissionRole.
        menus = build_menu_tree(
            Menu.objects.filter(
                key_status__name__iexact=_ACTIVE_STATUS_NAME,
                key_system__name__icontains=_WEB_SYSTEM_NAME_HINT,
            )
        )
        return UserAccess(
            all_access=True,
            has_access=True,
            menus=menus,
            permisos_front=[ALL_PERMISSIONS_FRONT],
            permisos_back=[ALL_PERMISSIONS_BACK],
        )

    role_ids = [role.id for role in active_roles]
    menus = build_menu_tree(_resolve_role_menus(role_ids))
    permisos_front, permisos_back = _resolve_role_permissions(role_ids)

    return UserAccess(
        all_access=False,
        has_access=bool(menus),
        menus=menus,
        permisos_front=permisos_front,
        permisos_back=permisos_back,
    )


def _resolve_role_menus(role_ids: list) -> list[Menu]:
    assigned_menu_ids = set(
        RoleMenu.objects.filter(
            key_role_id__in=role_ids, key_status__name__iexact=_ACTIVE_STATUS_NAME
        ).values_list("key_menu_id", flat=True)
    )
    if not assigned_menu_ids:
        return []

    # Incluye los ancestros de cada menú asignado: si solo se vinculó un hijo, el padre
    # (agrupador visual) debe aparecer igual para que el árbol tenga sentido en el sidebar.
    all_active_menus = list(
        Menu.objects.filter(
            key_status__name__iexact=_ACTIVE_STATUS_NAME,
            key_system__name__icontains=_WEB_SYSTEM_NAME_HINT,
        )
    )
    menus_by_id = {menu.id: menu for menu in all_active_menus}

    allowed_ids: set = set()
    for menu_id in assigned_menu_ids:
        current = menus_by_id.get(menu_id)
        while current is not None and current.id not in allowed_ids:
            allowed_ids.add(current.id)
            current = menus_by_id.get(current.key_father_menu_id)

    return [menu for menu in all_active_menus if menu.id in allowed_ids]


def _resolve_role_permissions(role_ids: list) -> tuple[list[dict], list[str]]:
    permissions = (
        Permission.objects.filter(
            permissionrole__key_role_id__in=role_ids,
            key_status__name__iexact=_ACTIVE_STATUS_NAME,
        )
        .select_related("key_action")
        .distinct()
    )

    permisos_back: set = set()
    seen_front: set = set()
    permisos_front: list[dict] = []
    for permission in permissions:
        permisos_back.add(permission.decorator_name)
        action_name = permission.key_action.name if permission.key_action else "manage"
        front_key = (action_name, permission.module_name)
        if front_key in seen_front:
            continue
        seen_front.add(front_key)
        permisos_front.append({"action": action_name, "subject": permission.module_name})

    return permisos_front, sorted(permisos_back)


def build_menu_tree(menus) -> list[dict]:
    menus = list(menus)
    nodes = {
        menu.id: {
            "id": str(menu.id),
            "subject": menu.subject,
            "description": menu.description,
            "title": menu.title,
            "icon": menu.icon,
            "ordering": menu.ordering,
            "to": menu.router_to,
            "children": [],
        }
        for menu in menus
    }

    roots: list[dict] = []
    for menu in menus:
        node = nodes[menu.id]
        parent = nodes.get(menu.key_father_menu_id)
        (parent["children"] if parent is not None else roots).append(node)

    roots.sort(key=lambda node: node["ordering"])
    for node in nodes.values():
        node["children"].sort(key=lambda child: child["ordering"])
    return roots
