from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.autenticacion.models import User
from apps.configuraciones.moneda.models import Moneda
from apps.configuraciones.services import ACTIVE_STATUS_NAME, VOIDED_STATUS_NAME, get_status_by_name
from apps.seguridad.models import UserRole

from .models import Cuenta, TipoCuenta


class CuentaKeyMonedaOwnershipTests(TestCase):
    """Regresión del IDOR corregido en CuentaSerializer.validate_key_moneda.

    Antes del fix, bulk_save_cuentas aceptaba el id de una Moneda de OTRO usuario sin
    validar nada: key_moneda usa el PrimaryKeyRelatedField que arma DRF por defecto
    (queryset=Moneda.objects.all()), que no filtra por dueño. Un usuario podía enviar a
    mano el UUID de una moneda ajena y quedaba vinculada igual, rompiendo el aislamiento
    multi-tenant que el resto del módulo sí respeta (ver key_user en cada queryset de
    views.py).
    """

    @classmethod
    def setUpTestData(cls):
        # Los catálogos (Status, TipoCuenta, roles/permisos) no vienen de las migraciones:
        # los carga este management command, el mismo que corre un dev en local.
        call_command("seed_local_db", verbosity=0)

        cls.active_status = get_status_by_name(ACTIVE_STATUS_NAME)
        cls.tipo = TipoCuenta.objects.filter(key_status=cls.active_status).first()

        cls.victim = User.objects.create_user(username="victima_idor", email="victima_idor@test.local", password="x")
        cls.attacker = User.objects.create_user(username="atacante_idor", email="atacante_idor@test.local", password="x")

        cls.victim_moneda = Moneda.objects.create(
            key_user=cls.victim, name="Victim Coin", code="VIC", key_status=cls.active_status
        )
        cls.attacker_moneda = Moneda.objects.create(
            key_user=cls.attacker, name="Attacker Coin", code="ATK", key_status=cls.active_status
        )

    def setUp(self):
        self.client = APIClient()
        # client.login() resuelve la sesión directo contra el backend de auth de Django,
        # sin pasar por LoginView (no importa email_verified/is_locked para este test).
        self.client.login(username="atacante_idor", password="x")

    def _bulk_save(self, payload):
        return self.client.post("/api/configuraciones/cuentas/bulk-save/", payload, format="json")

    def test_create_rejects_other_users_moneda(self):
        response = self._bulk_save(
            {"created": [{"name": "Cuenta robada", "key_tipo": str(self.tipo.id), "key_moneda": str(self.victim_moneda.id)}]}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("key_moneda", response.data)
        self.assertFalse(Cuenta.objects.filter(key_user=self.attacker).exists())

    def test_create_accepts_own_moneda(self):
        response = self._bulk_save(
            {"created": [{"name": "Cuenta legítima", "key_tipo": str(self.tipo.id), "key_moneda": str(self.attacker_moneda.id)}]}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(
            Cuenta.objects.filter(
                key_user=self.attacker, key_moneda=self.attacker_moneda, name="Cuenta legítima"
            ).exists()
        )

    def test_update_rejects_reassigning_to_other_users_moneda(self):
        cuenta = Cuenta.objects.create(
            key_user=self.attacker,
            key_tipo=self.tipo,
            key_moneda=self.attacker_moneda,
            name="Cuenta propia",
            key_status=self.active_status,
        )
        response = self._bulk_save({"updated": [{"id": str(cuenta.id), "key_moneda": str(self.victim_moneda.id)}]})
        self.assertEqual(response.status_code, 400)
        cuenta.refresh_from_db()
        self.assertEqual(cuenta.key_moneda_id, self.attacker_moneda.id)

    def test_update_without_touching_key_moneda_still_works(self):
        # Un update parcial que no toca key_moneda no debe disparar la validación (ni
        # fallar por eso) — cubre que validate_key_moneda no rompa el caso común.
        cuenta = Cuenta.objects.create(
            key_user=self.attacker,
            key_tipo=self.tipo,
            key_moneda=self.attacker_moneda,
            name="Cuenta propia",
            key_status=self.active_status,
        )
        response = self._bulk_save({"updated": [{"id": str(cuenta.id), "titular_name": "Nuevo titular"}]})
        self.assertEqual(response.status_code, 200, response.data)
        cuenta.refresh_from_db()
        self.assertEqual(cuenta.titular_name, "Nuevo titular")


class TipoCuentaBulkSaveTests(TestCase):
    """CRUD nuevo del catálogo de Tipo de Cuenta (antes solo lectura) — reusa los permisos
    de Cuenta (configuracion-cuentas-*), ver bulk_save_tipos_cuenta en views.py."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_local_db", verbosity=0)
        cls.active_status = get_status_by_name(ACTIVE_STATUS_NAME)
        cls.moneda_tipo = TipoCuenta.objects.filter(key_status=cls.active_status).first()

    def setUp(self):
        self.user = User.objects.create_user(username="tipo_cta_user", email="tipo_cta_user@test.local", password="x")
        self.client = APIClient()
        self.client.login(username="tipo_cta_user", password="x")

    def _bulk_save(self, payload):
        return self.client.post("/api/configuraciones/tipos-cuenta/bulk-save/", payload, format="json")

    def test_create_success(self):
        response = self._bulk_save({"created": [{"name": "Tarjeta de Crédito", "description": "Tarjeta"}]})
        self.assertEqual(response.status_code, 200, response.data)
        tipo = TipoCuenta.objects.get(name="Tarjeta de Crédito")

        # Regresión: _registrar_creacion_tipo debe grabar nom_tabla="cfg_tipo_cuentas", no
        # "cfg_cuentas" (el de Cuenta) — antes de este fix, _crear_tipos_cuenta reusaba por
        # error el _registrar_creacion ya atado a la tabla de Cuenta.
        from apps.historial.models import Historial

        historial = Historial.objects.get(key_record=str(tipo.id))
        self.assertEqual(historial.nom_tabla, "cfg_tipo_cuentas")

    def test_create_blocks_duplicate_name_global(self):
        # El catálogo es global (sin key_user): el duplicado bloquea aunque lo haya creado
        # otro usuario, a diferencia de Categoria/Moneda/Cuenta (que son por usuario).
        response = self._bulk_save({"created": [{"name": "Banco"}]})  # ya viene seedeado
        self.assertEqual(response.status_code, 400)

    def test_cannot_void_tipo_in_use(self):
        from apps.configuraciones.moneda.models import Moneda

        moneda = Moneda.objects.create(key_user=self.user, name="Sol", code="PEN", key_status=self.active_status)
        cuenta = Cuenta.objects.create(
            key_user=self.user,
            key_tipo=self.moneda_tipo,
            key_moneda=moneda,
            name="Mi cuenta",
            key_status=self.active_status,
        )
        response = self._bulk_save({"voided": [str(self.moneda_tipo.id)]})
        self.assertEqual(response.status_code, 400)
        self.moneda_tipo.refresh_from_db()
        self.assertEqual(self.moneda_tipo.key_status.name, ACTIVE_STATUS_NAME)
        cuenta.refresh_from_db()
        self.assertEqual(cuenta.key_tipo_id, self.moneda_tipo.id)

    def test_can_void_tipo_not_in_use(self):
        create_response = self._bulk_save({"created": [{"name": "Tipo Libre"}]})
        tipo_id = create_response.data[-1]["id"]
        response = self._bulk_save({"voided": [tipo_id]})
        self.assertEqual(response.status_code, 200, response.data)
        tipo = TipoCuenta.objects.get(id=tipo_id)
        self.assertEqual(tipo.key_status.name, VOIDED_STATUS_NAME)

    def test_create_without_permission_is_denied(self):
        UserRole.objects.filter(key_user=self.user).delete()
        response = self._bulk_save({"created": [{"name": "Tipo Sin Permiso"}]})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(TipoCuenta.objects.filter(name="Tipo Sin Permiso").exists())
