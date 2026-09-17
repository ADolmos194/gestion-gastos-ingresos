from datetime import date

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.autenticacion.models import User
from apps.configuraciones.categoria.models import Categoria, TipoCategoria
from apps.configuraciones.cuenta.models import Cuenta, TipoCuenta
from apps.configuraciones.moneda.models import Moneda
from apps.configuraciones.services import ACTIVE_STATUS_NAME, VOIDED_STATUS_NAME, get_status_by_name
from apps.seguridad.models import UserRole

from .models import Movimiento


class MovimientoTestsBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_local_db", verbosity=0)
        cls.active_status = get_status_by_name(ACTIVE_STATUS_NAME)
        cls.tipo_gasto = TipoCategoria.objects.get(name="Gasto")
        cls.tipo_ingreso = TipoCategoria.objects.get(name="Ingreso")
        cls.tipo_cuenta = TipoCuenta.objects.filter(key_status=cls.active_status).first()

    def setUp(self):
        self.user = User.objects.create_user(username="fin_user", email="fin_user@test.local", password="x")
        self.client = APIClient()
        self.client.login(username="fin_user", password="x")

        self.moneda = Moneda.objects.create(key_user=self.user, name="Sol", code="PEN", key_status=self.active_status)
        self.cuenta = Cuenta.objects.create(
            key_user=self.user,
            key_tipo=self.tipo_cuenta,
            key_moneda=self.moneda,
            name="Cuenta Principal",
            key_status=self.active_status,
        )
        self.categoria_gasto = Categoria.objects.create(
            key_user=self.user, key_tipo=self.tipo_gasto, name="Comida", key_status=self.active_status
        )
        self.categoria_ingreso = Categoria.objects.create(
            key_user=self.user, key_tipo=self.tipo_ingreso, name="Salario", key_status=self.active_status
        )

    def _bulk_save(self, payload):
        return self.client.post("/api/finanzas/movimientos/bulk-save/", payload, format="json")


class MovimientoBulkSaveTests(MovimientoTestsBase):
    def test_create_gasto_success(self):
        response = self._bulk_save(
            {
                "created": [
                    {
                        "movement_date": "2026-09-01",
                        "key_categoria": str(self.categoria_gasto.id),
                        "key_cuenta": str(self.cuenta.id),
                        "amount": "50.00",
                        "description": "Almuerzo",
                    }
                ]
            }
        )
        self.assertEqual(response.status_code, 200, response.data)
        movimiento = Movimiento.objects.get(key_user=self.user)
        self.assertEqual(str(movimiento.amount), "50.00")
        self.assertEqual(response.data[0]["tipo_nombre"], "Gasto")

    def test_create_rejects_other_users_categoria(self):
        victim = User.objects.create_user(username="fin_victim", email="fin_victim@test.local", password="x")
        victim_categoria = Categoria.objects.create(
            key_user=victim, key_tipo=self.tipo_gasto, name="Otra", key_status=self.active_status
        )
        response = self._bulk_save(
            {
                "created": [
                    {
                        "movement_date": "2026-09-01",
                        "key_categoria": str(victim_categoria.id),
                        "key_cuenta": str(self.cuenta.id),
                        "amount": "10.00",
                    }
                ]
            }
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Movimiento.objects.filter(key_user=self.user).exists())

    def test_create_rejects_other_users_cuenta(self):
        victim = User.objects.create_user(username="fin_victim2", email="fin_victim2@test.local", password="x")
        victim_moneda = Moneda.objects.create(key_user=victim, name="Dolar", code="USD", key_status=self.active_status)
        victim_cuenta = Cuenta.objects.create(
            key_user=victim,
            key_tipo=self.tipo_cuenta,
            key_moneda=victim_moneda,
            name="Cuenta Ajena",
            key_status=self.active_status,
        )
        response = self._bulk_save(
            {
                "created": [
                    {
                        "movement_date": "2026-09-01",
                        "key_categoria": str(self.categoria_gasto.id),
                        "key_cuenta": str(victim_cuenta.id),
                        "amount": "10.00",
                    }
                ]
            }
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Movimiento.objects.filter(key_user=self.user).exists())

    def test_update_movimiento(self):
        self._bulk_save(
            {
                "created": [
                    {
                        "movement_date": "2026-09-01",
                        "key_categoria": str(self.categoria_gasto.id),
                        "key_cuenta": str(self.cuenta.id),
                        "amount": "50.00",
                    }
                ]
            }
        )
        movimiento = Movimiento.objects.get(key_user=self.user)
        response = self._bulk_save({"updated": [{"id": str(movimiento.id), "amount": "75.50"}]})
        self.assertEqual(response.status_code, 200, response.data)
        movimiento.refresh_from_db()
        self.assertEqual(str(movimiento.amount), "75.50")

    def test_anular_then_restaurar(self):
        self._bulk_save(
            {
                "created": [
                    {
                        "movement_date": "2026-09-01",
                        "key_categoria": str(self.categoria_gasto.id),
                        "key_cuenta": str(self.cuenta.id),
                        "amount": "50.00",
                    }
                ]
            }
        )
        movimiento = Movimiento.objects.get(key_user=self.user)

        self._bulk_save({"voided": [str(movimiento.id)]})
        movimiento.refresh_from_db()
        self.assertEqual(movimiento.key_status.name, VOIDED_STATUS_NAME)

        self._bulk_save({"restored": [str(movimiento.id)]})
        movimiento.refresh_from_db()
        self.assertEqual(movimiento.key_status.name, ACTIVE_STATUS_NAME)

    def test_create_without_permission_is_denied(self):
        UserRole.objects.filter(key_user=self.user).delete()
        response = self._bulk_save(
            {
                "created": [
                    {
                        "movement_date": "2026-09-01",
                        "key_categoria": str(self.categoria_gasto.id),
                        "key_cuenta": str(self.cuenta.id),
                        "amount": "50.00",
                    }
                ]
            }
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Movimiento.objects.filter(key_user=self.user).exists())


class SaldoCalculationTests(MovimientoTestsBase):
    def _create(self, categoria, amount):
        response = self._bulk_save(
            {
                "created": [
                    {
                        "movement_date": "2026-09-01",
                        "key_categoria": str(categoria.id),
                        "key_cuenta": str(self.cuenta.id),
                        "amount": amount,
                    }
                ]
            }
        )
        self.assertEqual(response.status_code, 200, response.data)
        return Movimiento.objects.filter(key_user=self.user).latest("creation_date")

    def _get_saldo(self):
        response = self.client.get("/api/finanzas/movimientos/saldos/")
        self.assertEqual(response.status_code, 200, response.data)
        return next(row for row in response.data if row["cuenta_id"] == str(self.cuenta.id))

    def test_saldo_nets_ingresos_and_gastos(self):
        self._create(self.categoria_ingreso, "1000.00")
        self._create(self.categoria_gasto, "300.00")
        saldo = self._get_saldo()
        self.assertEqual(str(saldo["saldo"]), "700.00")
        self.assertEqual(saldo["moneda_code"], "PEN")

    def test_voided_movimiento_excluded_from_saldo(self):
        self._create(self.categoria_ingreso, "1000.00")
        gasto = self._create(self.categoria_gasto, "300.00")
        self._bulk_save({"voided": [str(gasto.id)]})
        saldo = self._get_saldo()
        self.assertEqual(str(saldo["saldo"]), "1000.00")

    def test_cuenta_without_movimientos_has_zero_saldo(self):
        saldo = self._get_saldo()
        self.assertEqual(saldo["saldo"], 0)
