from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.autenticacion.models import User
from apps.configuraciones.services import ACTIVE_STATUS_NAME, VOIDED_STATUS_NAME, get_status_by_name

from .models import Menu, Permission, PermissionRole, Role, RoleMenu, UserRole

# Ids fijos del seed (ver seed_roles.json/seed_menu.json) — se usan por id en vez de
# resolverlos por nombre porque estos tests necesitan que sean EXACTAMENTE esos registros
# (el único rol all_access que trae el seed, el ítem de menú "Roles"), no "cualquiera que
# matchee".
_ALL_ACCESS_ROLE_ID = "99092d2d-42ba-4e40-a158-11f50876fa6e"
_LIMITED_ROLE_ID = "9726bc04-3c0e-4ff5-b547-d4192b403ff5"
_ROLES_MENU_ID = "390f4810-5924-4eeb-9de6-f4c653e7bdf6"
_PERMISOS_MENU_ID = "78e89df8-ca6c-459c-8b20-b43d23393c23"


class SeguridadTestCaseBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_local_db", verbosity=0)
        cls.active_status = get_status_by_name(ACTIVE_STATUS_NAME)

    def setUp(self):
        self.admin = User.objects.create_user(username="admin_user", email="admin_user@test.local", password="x")
        UserRole.objects.create(key_user=self.admin, key_role_id=_ALL_ACCESS_ROLE_ID, key_status=self.active_status)
        self.admin_client = APIClient()
        self.admin_client.login(username="admin_user", password="x")

        self.plain = User.objects.create_user(username="plain_user", email="plain_user@test.local", password="x")
        self.plain_client = APIClient()
        self.plain_client.login(username="plain_user", password="x")


class RolePermissionGateTests(SeguridadTestCaseBase):
    """Nadie sin all_access debería poder ni siquiera LEER estos endpoints — ver el
    comentario de constants.PERM_MANAGE sobre por qué no está en ningún rol por defecto."""

    def test_plain_user_cannot_list_roles(self):
        response = self.plain_client.get("/api/seguridad/roles/")
        self.assertEqual(response.status_code, 403)

    def test_plain_user_cannot_bulk_save_roles(self):
        response = self.plain_client.post("/api/seguridad/roles/bulk-save/", {"created": [{"name": "X"}]}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Role.objects.filter(name="X").exists())

    def test_plain_user_cannot_list_permissions_or_menus(self):
        self.assertEqual(self.plain_client.get("/api/seguridad/permissions/").status_code, 403)
        self.assertEqual(self.plain_client.get("/api/seguridad/menus/").status_code, 403)

    def test_plain_user_cannot_read_or_assign_role_permissions(self):
        url = f"/api/seguridad/roles/{_LIMITED_ROLE_ID}/permissions/"
        self.assertEqual(self.plain_client.get(url).status_code, 403)
        self.assertEqual(self.plain_client.post(url, {"permission_ids": []}, format="json").status_code, 403)

    def test_anonymous_is_rejected(self):
        anon = APIClient()
        response = anon.get("/api/seguridad/roles/")
        self.assertEqual(response.status_code, 401)

    def test_admin_can_list_roles(self):
        response = self.admin_client.get("/api/seguridad/roles/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(any(row["id"] == _ALL_ACCESS_ROLE_ID for row in response.data))


class RoleBulkSaveTests(SeguridadTestCaseBase):
    def _bulk_save(self, payload):
        return self.admin_client.post("/api/seguridad/roles/bulk-save/", payload, format="json")

    def test_create_update_void_restore_inactivate_cycle(self):
        response = self._bulk_save({"created": [{"name": "Soporte", "description": "Rol de soporte"}]})
        self.assertEqual(response.status_code, 200, response.data)
        role = Role.objects.get(name="Soporte")
        self.assertFalse(role.all_access)

        response = self._bulk_save({"updated": [{"id": str(role.id), "description": "Soporte nivel 1"}]})
        self.assertEqual(response.status_code, 200, response.data)
        role.refresh_from_db()
        self.assertEqual(role.description, "Soporte nivel 1")

        response = self._bulk_save({"inactivated": [str(role.id)]})
        self.assertEqual(response.status_code, 200, response.data)
        role.refresh_from_db()
        self.assertEqual(role.key_status.name, "Inactivo")

        response = self._bulk_save({"restored": [str(role.id)]})
        self.assertEqual(response.status_code, 200, response.data)
        role.refresh_from_db()
        self.assertEqual(role.key_status.name, ACTIVE_STATUS_NAME)

        response = self._bulk_save({"voided": [str(role.id)]})
        self.assertEqual(response.status_code, 200, response.data)
        role.refresh_from_db()
        self.assertEqual(role.key_status.name, VOIDED_STATUS_NAME)

    def test_blocks_duplicate_active_name(self):
        self._bulk_save({"created": [{"name": "Soporte"}]})
        response = self._bulk_save({"created": [{"name": "soporte"}]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Role.objects.filter(name__iexact="Soporte").count(), 1)

    def test_voided_name_still_blocks_recreate(self):
        # A diferencia de Categoria/Moneda (por-usuario), Role.name es unique=True real a
        # nivel de base (igual que TipoCategoria) — un nombre queda reservado para siempre,
        # anulado o no. Ver el comentario de _find_blocking_role_duplicate en views.py.
        self._bulk_save({"created": [{"name": "Soporte"}]})
        role = Role.objects.get(name="Soporte")
        self._bulk_save({"voided": [str(role.id)]})
        response = self._bulk_save({"created": [{"name": "Soporte"}]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Role.objects.filter(name="Soporte").count(), 1)

    def test_cannot_void_last_all_access_role(self):
        response = self._bulk_save({"voided": [_ALL_ACCESS_ROLE_ID]})
        self.assertEqual(response.status_code, 400)
        role = Role.objects.get(id=_ALL_ACCESS_ROLE_ID)
        self.assertEqual(role.key_status.name, ACTIVE_STATUS_NAME)

    def test_cannot_strip_all_access_from_last_role(self):
        response = self._bulk_save({"updated": [{"id": _ALL_ACCESS_ROLE_ID, "all_access": False}]})
        self.assertEqual(response.status_code, 400)
        role = Role.objects.get(id=_ALL_ACCESS_ROLE_ID)
        self.assertTrue(role.all_access)

    def test_can_void_all_access_role_when_another_exists(self):
        self._bulk_save({"created": [{"name": "Segundo Admin", "all_access": True}]})
        response = self._bulk_save({"voided": [_ALL_ACCESS_ROLE_ID]})
        self.assertEqual(response.status_code, 200, response.data)
        role = Role.objects.get(id=_ALL_ACCESS_ROLE_ID)
        self.assertEqual(role.key_status.name, VOIDED_STATUS_NAME)


class CatalogTests(SeguridadTestCaseBase):
    def test_list_permissions_includes_manage_permission(self):
        response = self.admin_client.get("/api/seguridad/permissions/")
        self.assertEqual(response.status_code, 200)
        decorator_names = [row["decorator_name"] for row in response.data]
        self.assertIn("seguridad-manage", decorator_names)

    def test_list_menus_includes_full_title(self):
        response = self.admin_client.get("/api/seguridad/menus/")
        self.assertEqual(response.status_code, 200)
        roles_menu = next(row for row in response.data if row["id"] == _ROLES_MENU_ID)
        self.assertEqual(roles_menu["full_title"], "Seguridad > Maestras > Roles")


class RolePermissionAssignmentTests(SeguridadTestCaseBase):
    def setUp(self):
        super().setUp()
        self.manage_permission = Permission.objects.get(decorator_name="seguridad-manage")

    def test_get_starts_empty(self):
        response = self.admin_client.get(f"/api/seguridad/roles/{_LIMITED_ROLE_ID}/permissions/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(str(self.manage_permission.id), response.data["assigned_ids"])

    def test_assign_then_unassign(self):
        url = f"/api/seguridad/roles/{_LIMITED_ROLE_ID}/permissions/"
        response = self.admin_client.post(url, {"permission_ids": [str(self.manage_permission.id)]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["assigned_ids"], [str(self.manage_permission.id)])
        self.assertTrue(
            PermissionRole.objects.filter(
                key_role_id=_LIMITED_ROLE_ID, key_permission=self.manage_permission, key_status__name=ACTIVE_STATUS_NAME
            ).exists()
        )

        response = self.admin_client.post(url, {"permission_ids": []}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["assigned_ids"], [])
        # No se borra la fila, se anula (mismo criterio "anular, no borrar" del resto del
        # sistema) — así queda rastro de que ese rol tuvo ese permiso alguna vez.
        link = PermissionRole.objects.get(key_role_id=_LIMITED_ROLE_ID, key_permission=self.manage_permission)
        self.assertEqual(link.key_status.name, VOIDED_STATUS_NAME)

    def test_reassign_reactivates_instead_of_duplicating(self):
        url = f"/api/seguridad/roles/{_LIMITED_ROLE_ID}/permissions/"
        self.admin_client.post(url, {"permission_ids": [str(self.manage_permission.id)]}, format="json")
        self.admin_client.post(url, {"permission_ids": []}, format="json")
        self.admin_client.post(url, {"permission_ids": [str(self.manage_permission.id)]}, format="json")
        self.assertEqual(
            PermissionRole.objects.filter(key_role_id=_LIMITED_ROLE_ID, key_permission=self.manage_permission).count(), 1
        )

    def test_rejects_unknown_permission_id(self):
        url = f"/api/seguridad/roles/{_LIMITED_ROLE_ID}/permissions/"
        response = self.admin_client.post(url, {"permission_ids": ["00000000-0000-0000-0000-000000000000"]}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_assigning_manage_permission_actually_grants_access(self):
        """Prueba de punta a punta del punto central de todo este módulo: un usuario SIN
        all_access, pero con un rol al que se le asignó seguridad-manage, puede administrar
        seguridad igual que un all_access — así se ve que el flujo de asignación (esto) y
        el chequeo real (HasBackendPermission/require_permission) están mirando lo mismo."""
        self.admin_client.post(
            f"/api/seguridad/roles/{_LIMITED_ROLE_ID}/permissions/",
            {"permission_ids": [str(self.manage_permission.id)]},
            format="json",
        )
        limited_user = User.objects.create_user(username="limited_user", email="limited_user@test.local", password="x")
        UserRole.objects.create(key_user=limited_user, key_role_id=_LIMITED_ROLE_ID, key_status=self.active_status)
        limited_client = APIClient()
        limited_client.login(username="limited_user", password="x")

        response = limited_client.get("/api/seguridad/roles/")
        self.assertEqual(response.status_code, 200)


class RoleMenuAssignmentTests(SeguridadTestCaseBase):
    def test_assign_then_unassign(self):
        url = f"/api/seguridad/roles/{_LIMITED_ROLE_ID}/menus/"
        response = self.admin_client.post(url, {"menu_ids": [_ROLES_MENU_ID, _PERMISOS_MENU_ID]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertCountEqual(response.data["assigned_ids"], [_ROLES_MENU_ID, _PERMISOS_MENU_ID])

        response = self.admin_client.post(url, {"menu_ids": [_ROLES_MENU_ID]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["assigned_ids"], [_ROLES_MENU_ID])
        self.assertFalse(
            RoleMenu.objects.filter(
                key_role_id=_LIMITED_ROLE_ID, key_menu_id=_PERMISOS_MENU_ID, key_status__name=ACTIVE_STATUS_NAME
            ).exists()
        )

    def test_rejects_unknown_menu_id(self):
        url = f"/api/seguridad/roles/{_LIMITED_ROLE_ID}/menus/"
        response = self.admin_client.post(url, {"menu_ids": ["00000000-0000-0000-0000-000000000000"]}, format="json")
        self.assertEqual(response.status_code, 400)


class UsuarioRolesAssignmentTests(SeguridadTestCaseBase):
    def test_list_usuarios_reports_role_ids(self):
        # self.admin trae DOS roles: _LIMITED_ROLE_ID porque post_save en User se lo asigna
        # a TODO usuario nuevo (ver apps.autenticacion.signals.DEFAULT_ROLE_ID, que apunta a
        # este mismo id), más _ALL_ACCESS_ROLE_ID asignado a mano en setUp.
        response = self.admin_client.get("/api/seguridad/usuarios/")
        self.assertEqual(response.status_code, 200)
        admin_row = next(row for row in response.data if row["id"] == str(self.admin.id))
        self.assertCountEqual(admin_row["role_ids"], [_LIMITED_ROLE_ID, _ALL_ACCESS_ROLE_ID])

    def test_assign_role_to_other_user(self):
        url = f"/api/seguridad/usuarios/{self.plain.id}/roles/"
        response = self.admin_client.post(url, {"role_ids": [_LIMITED_ROLE_ID]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["assigned_ids"], [_LIMITED_ROLE_ID])

        response = self.admin_client.post(url, {"role_ids": []}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["assigned_ids"], [])

    def test_admin_cannot_strip_their_own_last_all_access_role(self):
        url = f"/api/seguridad/usuarios/{self.admin.id}/roles/"
        response = self.admin_client.post(url, {"role_ids": []}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(
            UserRole.objects.filter(
                key_user=self.admin, key_role_id=_ALL_ACCESS_ROLE_ID, key_status__name=ACTIVE_STATUS_NAME
            ).exists()
        )

    def test_admin_can_swap_their_own_role_for_another_all_access_role(self):
        self.admin_client.post(
            "/api/seguridad/roles/bulk-save/", {"created": [{"name": "Segundo Admin", "all_access": True}]}, format="json"
        )
        segundo_admin_id = str(Role.objects.get(name="Segundo Admin").id)

        url = f"/api/seguridad/usuarios/{self.admin.id}/roles/"
        response = self.admin_client.post(url, {"role_ids": [segundo_admin_id]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["assigned_ids"], [segundo_admin_id])

    def test_rejects_unknown_role_id(self):
        url = f"/api/seguridad/usuarios/{self.plain.id}/roles/"
        response = self.admin_client.post(url, {"role_ids": ["00000000-0000-0000-0000-000000000000"]}, format="json")
        self.assertEqual(response.status_code, 400)
