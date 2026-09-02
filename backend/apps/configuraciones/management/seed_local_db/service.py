from dataclasses import dataclass
from typing import Any

from django.core.management.base import CommandError
from django.db import transaction

from apps.configuraciones.management.seed_local_db.parser import SeedPayload, uuid_from_value
from apps.configuraciones.models import Status, StatusTypes, System, TipoCategoria
from apps.seguridad.models import Action, Event, Menu, Permission, PermissionRole, Role, RoleMenu, UserRole


@dataclass(frozen=True)
class SeedLocalDbResult:
    system_id: str
    skipped_user_roles: list[str]


class SeedLocalDbService:
    """Loads a SeedPayload into the database, resolving foreign keys between
    seed files in dependency order (status types -> statuses -> everything else)."""

    def seed(self, seed_payload: SeedPayload) -> SeedLocalDbResult:
        with transaction.atomic():
            status_type_by_id = self._seed_status_types(seed_payload)
            status_by_id = self._seed_statuses(seed_payload, status_type_by_id)
            system_by_id = self._seed_systems(seed_payload, status_by_id)
            self._seed_tipo_categorias(seed_payload, status_by_id)
            self._seed_events(seed_payload, status_by_id)
            action_by_id = self._seed_actions(seed_payload, status_by_id)
            permission_by_id = self._seed_permissions(seed_payload, status_by_id, action_by_id)
            role_by_id = self._seed_roles(seed_payload, status_by_id)
            menu_by_id = self._seed_menu(seed_payload, status_by_id, system_by_id)
            self._seed_role_menu(seed_payload, status_by_id, role_by_id, menu_by_id)
            skipped_user_roles = self._seed_user_roles(seed_payload, status_by_id, role_by_id)
            self._seed_permission_role(seed_payload, status_by_id, role_by_id, permission_by_id)

        primary_system_id = next(iter(system_by_id), "")
        return SeedLocalDbResult(system_id=primary_system_id, skipped_user_roles=skipped_user_roles)

    def _seed_status_types(self, seed_payload: SeedPayload) -> dict[str, StatusTypes]:
        status_type_by_id: dict[str, StatusTypes] = {}
        for row in seed_payload.status_type_seed_data:
            pk = uuid_from_value(row["id"], f"status_types[{row.get('name')}].id")
            status_type, _ = StatusTypes.objects.update_or_create(
                id=pk,
                defaults={
                    "name": row.get("name"),
                    "description": row.get("description"),
                },
            )
            status_type_by_id[str(status_type.id)] = status_type
        return status_type_by_id

    def _seed_statuses(
        self, seed_payload: SeedPayload, status_type_by_id: dict[str, StatusTypes]
    ) -> dict[str, Status]:
        status_by_id: dict[str, Status] = {}
        for row in seed_payload.status_seed_data:
            label = f"statuses[{row.get('name')}]"
            pk = uuid_from_value(row["id"], f"{label}.id")
            status_type = self._resolve(status_type_by_id, row.get("key_status_type_id"), f"{label}.key_status_type_id")
            status, _ = Status.objects.update_or_create(
                id=pk,
                defaults={
                    "key_status_type": status_type,
                    "name": row.get("name"),
                    "abbreviation": row.get("abbreviation"),
                    "action": row.get("action"),
                    "color": row.get("color"),
                    "icon": row.get("icon"),
                },
            )
            status_by_id[str(status.id)] = status
        return status_by_id

    def _seed_systems(self, seed_payload: SeedPayload, status_by_id: dict[str, Status]) -> dict[str, System]:
        system_by_id: dict[str, System] = {}
        for row in seed_payload.system_seed_data:
            label = f"system[{row.get('name')}]"
            pk = uuid_from_value(row["id"], f"{label}.id")
            status = self._resolve(status_by_id, row.get("key_status_id"), f"{label}.key_status_id")
            system, _ = System.objects.update_or_create(
                id=pk,
                defaults={
                    "name": row.get("name"),
                    "description": row.get("description"),
                    "key_status": status,
                },
            )
            system_by_id[str(system.id)] = system
        return system_by_id

    def _seed_events(self, seed_payload: SeedPayload, status_by_id: dict[str, Status]) -> None:
        for row in seed_payload.event_seed_data:
            label = f"events[{row.get('name')}]"
            pk = uuid_from_value(row["id"], f"{label}.id")
            status = self._resolve(status_by_id, row.get("key_status_id"), f"{label}.key_status_id")
            Event.objects.update_or_create(
                id=pk,
                defaults={
                    "name": row.get("name"),
                    "description": row.get("description"),
                    "key_status": status,
                },
            )

    def _seed_actions(self, seed_payload: SeedPayload, status_by_id: dict[str, Status]) -> dict[str, Action]:
        action_by_id: dict[str, Action] = {}
        for row in seed_payload.action_seed_data:
            label = f"actions[{row.get('name')}]"
            pk = uuid_from_value(row["id"], f"{label}.id")
            status = self._resolve(status_by_id, row.get("key_status_id"), f"{label}.key_status_id")
            action, _ = Action.objects.update_or_create(
                id=pk,
                defaults={
                    "name": row.get("name"),
                    "description": row.get("description"),
                    "key_status": status,
                },
            )
            action_by_id[str(action.id)] = action
        return action_by_id

    def _seed_tipo_categorias(self, seed_payload: SeedPayload, status_by_id: dict[str, Status]) -> None:
        for row in seed_payload.tipo_categoria_seed_data:
            label = f"tipo_categorias[{row.get('name')}]"
            pk = uuid_from_value(row["id"], f"{label}.id")
            status = self._resolve(status_by_id, row.get("key_status_id"), f"{label}.key_status_id")
            TipoCategoria.objects.update_or_create(
                id=pk,
                defaults={
                    "name": row.get("name"),
                    "description": row.get("description"),
                    "key_status": status,
                },
            )

    def _seed_permissions(
        self,
        seed_payload: SeedPayload,
        status_by_id: dict[str, Status],
        action_by_id: dict[str, Action],
    ) -> dict[str, Permission]:
        permission_by_id: dict[str, Permission] = {}
        for row in seed_payload.permission_seed_data:
            label = f"permissions[{row.get('decorator_name')}]"
            pk = uuid_from_value(row["id"], f"{label}.id")
            status = self._resolve(status_by_id, row.get("key_status_id"), f"{label}.key_status_id")
            action = self._resolve(action_by_id, row.get("key_action_id"), f"{label}.key_action_id")
            permission, _ = Permission.objects.update_or_create(
                id=pk,
                defaults={
                    "decorator_name": row.get("decorator_name"),
                    "api_url": row.get("api_url"),
                    "module_name": row.get("module_name"),
                    "key_action": action,
                    "key_status": status,
                },
            )
            permission_by_id[str(permission.id)] = permission
        return permission_by_id

    def _seed_roles(self, seed_payload: SeedPayload, status_by_id: dict[str, Status]) -> dict[str, Role]:
        role_by_id: dict[str, Role] = {}
        for row in seed_payload.role_seed_data:
            label = f"roles[{row.get('name')}]"
            pk = uuid_from_value(row["id"], f"{label}.id")
            status = self._resolve(status_by_id, row.get("key_status_id"), f"{label}.key_status_id")
            role, _ = Role.objects.update_or_create(
                id=pk,
                defaults={
                    "name": row.get("name"),
                    "description": row.get("description"),
                    "key_status": status,
                    "all_access": bool(row.get("all_access", False)),
                },
            )
            role_by_id[str(role.id)] = role
        return role_by_id

    def _seed_menu(
        self,
        seed_payload: SeedPayload,
        status_by_id: dict[str, Status],
        system_by_id: dict[str, System],
    ) -> dict[str, Menu]:
        menu_by_id: dict[str, Menu] = {}
        for row in seed_payload.menu_seed_data:
            label = f"menu[{row.get('subject')}]"
            pk = uuid_from_value(row["id"], f"{label}.id")
            status = self._resolve(status_by_id, row.get("key_status_id"), f"{label}.key_status_id")
            system = self._resolve(system_by_id, row.get("key_system_id"), f"{label}.key_system_id")
            father_menu_id = row.get("key_father_menu_id")
            father_menu = (
                self._resolve(menu_by_id, father_menu_id, f"{label}.key_father_menu_id")
                if father_menu_id
                else None
            )
            menu, _ = Menu.objects.update_or_create(
                id=pk,
                defaults={
                    "subject": row.get("subject"),
                    "title": row.get("title"),
                    "translated_title_key": row.get("translated_title_key"),
                    "icon": row.get("icon"),
                    "router_to": row.get("router_to"),
                    "ordering": row.get("ordering", 1),
                    "key_father_menu": father_menu,
                    "key_system": system,
                    "key_status": status,
                    "description": row.get("description"),
                },
            )
            menu_by_id[str(menu.id)] = menu
        return menu_by_id

    def _seed_role_menu(
        self,
        seed_payload: SeedPayload,
        status_by_id: dict[str, Status],
        role_by_id: dict[str, Role],
        menu_by_id: dict[str, Menu],
    ) -> None:
        for row in seed_payload.role_menu_seed_data:
            label = f"role_menu[{row.get('id')}]"
            pk = uuid_from_value(row["id"], f"{label}.id")
            status = self._resolve(status_by_id, row.get("key_status_id"), f"{label}.key_status_id")
            role = self._resolve(role_by_id, row.get("key_role_id"), f"{label}.key_role_id")
            menu = self._resolve(menu_by_id, row.get("key_menu_id"), f"{label}.key_menu_id")
            RoleMenu.objects.update_or_create(
                id=pk,
                defaults={
                    "key_role": role,
                    "key_menu": menu,
                    "key_status": status,
                    "description": row.get("description"),
                },
            )

    def _seed_user_roles(
        self,
        seed_payload: SeedPayload,
        status_by_id: dict[str, Status],
        role_by_id: dict[str, Role],
    ) -> list[str]:
        # Los usuarios nunca se siembran (se crean por registro/manualmente), así que acá
        # solo se vincula un usuario YA EXISTENTE a un rol, resuelto por email. Si el email
        # todavía no tiene cuenta, se omite la fila en vez de fallar todo el seed.
        from apps.autenticacion.models import User

        skipped: list[str] = []
        for row in seed_payload.user_role_seed_data:
            email = row.get("email")
            label = f"user_roles[{email}]"
            user = User.objects.filter(email__iexact=email).first() if email else None
            if user is None:
                skipped.append(str(email))
                continue
            pk = uuid_from_value(row["id"], f"{label}.id")
            status = self._resolve(status_by_id, row.get("key_status_id"), f"{label}.key_status_id")
            role = self._resolve(role_by_id, row.get("role_id"), f"{label}.role_id")
            UserRole.objects.update_or_create(
                id=pk,
                defaults={
                    "key_user": user,
                    "key_role": role,
                    "key_status": status,
                },
            )
        return skipped

    def _seed_permission_role(
        self,
        seed_payload: SeedPayload,
        status_by_id: dict[str, Status],
        role_by_id: dict[str, Role],
        permission_by_id: dict[str, Permission],
    ) -> None:
        for row in seed_payload.permission_role_seed_data:
            label = f"permission_role[{row.get('id')}]"
            pk = uuid_from_value(row["id"], f"{label}.id")
            status = self._resolve(status_by_id, row.get("key_status_id"), f"{label}.key_status_id")
            role = self._resolve(role_by_id, row.get("key_role_id"), f"{label}.key_role_id")
            permission = self._resolve(permission_by_id, row.get("key_permission_id"), f"{label}.key_permission_id")
            PermissionRole.objects.update_or_create(
                id=pk,
                defaults={
                    "key_role": role,
                    "key_permission": permission,
                    "key_status": status,
                },
            )

    def _resolve(self, cache: dict[str, Any], id_value: object, field_label: str) -> Any:
        if not id_value:
            raise CommandError(f"Missing required reference for {field_label}.")
        key = id_value.strip() if isinstance(id_value, str) else str(id_value)
        resolved = cache.get(key)
        if resolved is None:
            raise CommandError(f"{field_label} references unknown id: {id_value}")
        return resolved
