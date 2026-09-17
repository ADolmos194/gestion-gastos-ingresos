from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.autenticacion.models import User
from apps.configuraciones.moneda.models import Moneda
from apps.configuraciones.services import ACTIVE_STATUS_NAME, get_status_by_name

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
