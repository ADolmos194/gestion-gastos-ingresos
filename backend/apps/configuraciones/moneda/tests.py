from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.autenticacion.models import User
from apps.configuraciones.services import ACTIVE_STATUS_NAME, VOIDED_STATUS_NAME, get_status_by_name
from apps.seguridad.models import UserRole

from .models import Moneda


class MonedaBulkSaveTests(TestCase):
    """Cobertura base del contrato de bulk_save_monedas — mismo criterio que
    categoria/tests.py, este módulo tampoco tenía ningún test hasta ahora."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_local_db", verbosity=0)
        cls.active_status = get_status_by_name(ACTIVE_STATUS_NAME)

    def setUp(self):
        self.user = User.objects.create_user(username="mon_user", email="mon_user@test.local", password="x")
        self.client = APIClient()
        self.client.login(username="mon_user", password="x")

    def _bulk_save(self, payload):
        return self.client.post("/api/configuraciones/monedas/bulk-save/", payload, format="json")

    def test_create_success(self):
        response = self._bulk_save({"created": [{"name": "Sol Peruano", "code": "pen"}]})
        self.assertEqual(response.status_code, 200, response.data)
        # validate_code normaliza a mayúsculas (ver serializers.py) — confirma que el fix no
        # rompió esa normalización.
        self.assertTrue(Moneda.objects.filter(key_user=self.user, code="PEN").exists())

    def test_create_blocks_duplicate_active_code(self):
        self._bulk_save({"created": [{"name": "Sol Peruano", "code": "PEN"}]})
        response = self._bulk_save({"created": [{"name": "Otro Sol", "code": "pen"}]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Moneda.objects.filter(key_user=self.user, code="PEN").count(), 1)

    def test_voided_code_does_not_block_recreate(self):
        self._bulk_save({"created": [{"name": "Sol Peruano", "code": "PEN"}]})
        moneda = Moneda.objects.get(key_user=self.user, code="PEN")
        self._bulk_save({"voided": [str(moneda.id)]})
        moneda.refresh_from_db()
        self.assertEqual(moneda.key_status.name, VOIDED_STATUS_NAME)

        response = self._bulk_save({"created": [{"name": "Sol Peruano Nuevo", "code": "PEN"}]})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Moneda.objects.filter(key_user=self.user, code="PEN").count(), 2)

    def test_update_duplicate_check(self):
        self._bulk_save(
            {"created": [{"name": "Sol Peruano", "code": "PEN"}, {"name": "Dólar", "code": "USD"}]}
        )
        dolar = Moneda.objects.get(key_user=self.user, code="USD")
        response = self._bulk_save({"updated": [{"id": str(dolar.id), "code": "pen"}]})
        self.assertEqual(response.status_code, 400)
        dolar.refresh_from_db()
        self.assertEqual(dolar.code, "USD")

    def test_anular_then_restaurar(self):
        self._bulk_save({"created": [{"name": "Sol Peruano", "code": "PEN"}]})
        moneda = Moneda.objects.get(key_user=self.user, code="PEN")

        self._bulk_save({"voided": [str(moneda.id)]})
        moneda.refresh_from_db()
        self.assertEqual(moneda.key_status.name, VOIDED_STATUS_NAME)

        self._bulk_save({"restored": [str(moneda.id)]})
        moneda.refresh_from_db()
        self.assertEqual(moneda.key_status.name, ACTIVE_STATUS_NAME)

    def test_create_without_permission_is_denied(self):
        UserRole.objects.filter(key_user=self.user).delete()
        response = self._bulk_save({"created": [{"name": "Sol Peruano", "code": "PEN"}]})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Moneda.objects.filter(key_user=self.user).exists())
