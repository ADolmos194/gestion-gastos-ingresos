from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from apps.autenticacion.models import User
from apps.configuraciones.excel_utils import MAX_IMPORT_FILE_SIZE_BYTES
from apps.configuraciones.services import ACTIVE_STATUS_NAME, VOIDED_STATUS_NAME, get_status_by_name
from apps.seguridad.models import UserRole

from .models import Categoria, TipoCategoria


class CategoriaBulkSaveTests(TestCase):
    """Cobertura base del contrato de bulk_save_categorias — hasta ahora este módulo no
    tenía ningún test (ver tests.py, era el stub de Django sin tocar)."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_local_db", verbosity=0)
        cls.active_status = get_status_by_name(ACTIVE_STATUS_NAME)
        cls.tipo = TipoCategoria.objects.filter(key_status=cls.active_status).first()

    def setUp(self):
        self.user = User.objects.create_user(username="cat_user", email="cat_user@test.local", password="x")
        self.client = APIClient()
        self.client.login(username="cat_user", password="x")

    def _bulk_save(self, payload):
        return self.client.post("/api/configuraciones/categorias/bulk-save/", payload, format="json")

    def test_create_success(self):
        response = self._bulk_save({"created": [{"name": "Comida", "key_tipo": str(self.tipo.id)}]})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Categoria.objects.filter(key_user=self.user, name="Comida").exists())

    def test_create_blocks_duplicate_active_name(self):
        self._bulk_save({"created": [{"name": "Comida", "key_tipo": str(self.tipo.id)}]})
        response = self._bulk_save({"created": [{"name": "comida", "key_tipo": str(self.tipo.id)}]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Categoria.objects.filter(key_user=self.user, name__iexact="Comida").count(), 1)

    def test_voided_name_does_not_block_recreate(self):
        self._bulk_save({"created": [{"name": "Comida", "key_tipo": str(self.tipo.id)}]})
        categoria = Categoria.objects.get(key_user=self.user, name="Comida")
        self._bulk_save({"voided": [str(categoria.id)]})
        categoria.refresh_from_db()
        self.assertEqual(categoria.key_status.name, VOIDED_STATUS_NAME)

        response = self._bulk_save({"created": [{"name": "Comida", "key_tipo": str(self.tipo.id)}]})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Categoria.objects.filter(key_user=self.user, name="Comida").count(), 2)

    def test_update_duplicate_check(self):
        self._bulk_save(
            {
                "created": [
                    {"name": "Comida", "key_tipo": str(self.tipo.id)},
                    {"name": "Transporte", "key_tipo": str(self.tipo.id)},
                ]
            }
        )
        transporte = Categoria.objects.get(key_user=self.user, name="Transporte")
        response = self._bulk_save({"updated": [{"id": str(transporte.id), "name": "Comida"}]})
        self.assertEqual(response.status_code, 400)
        transporte.refresh_from_db()
        self.assertEqual(transporte.name, "Transporte")

    def test_anular_then_restaurar(self):
        self._bulk_save({"created": [{"name": "Comida", "key_tipo": str(self.tipo.id)}]})
        categoria = Categoria.objects.get(key_user=self.user, name="Comida")

        self._bulk_save({"voided": [str(categoria.id)]})
        categoria.refresh_from_db()
        self.assertEqual(categoria.key_status.name, VOIDED_STATUS_NAME)

        self._bulk_save({"restored": [str(categoria.id)]})
        categoria.refresh_from_db()
        self.assertEqual(categoria.key_status.name, ACTIVE_STATUS_NAME)

    def test_create_without_permission_is_denied(self):
        # Sin rol activo: build_user_access devuelve permisos_back vacío, así que cualquier
        # bolsa del payload que necesite un permiso queda bloqueada (ver require_permission()
        # sin argumento en bulk_save_categorias, que valida cada bolsa a mano).
        UserRole.objects.filter(key_user=self.user).delete()
        response = self._bulk_save({"created": [{"name": "Comida", "key_tipo": str(self.tipo.id)}]})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Categoria.objects.filter(key_user=self.user).exists())

    def test_import_rejects_oversized_file(self):
        # No hace falta que sea un .xlsx (zip) válido: el chequeo de tamaño comprimido en
        # validate_import_upload corre ANTES del chequeo de zip bomb y de que pandas
        # intente leerlo (ver excel_utils.py e import_categorias en views.py).
        oversized = SimpleUploadedFile(
            "plantilla.xlsx", b"0" * (MAX_IMPORT_FILE_SIZE_BYTES + 1), content_type="application/octet-stream"
        )
        response = self.client.post("/api/configuraciones/categorias/import/", {"file": oversized}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("tamaño máximo", str(response.data))

    def test_import_rejects_zip_bomb(self):
        # Un .xlsx es un .zip: contenido muy repetitivo comprime a una fracción mínima de
        # su tamaño real (acá, ~101 MB de ceros pasan largo el límite de comprimido de
        # excel_utils.MAX_IMPORT_FILE_SIZE_BYTES=10MB, pero el .zip resultante pesa unos
        # pocos KB) — sin el chequeo de tamaño descomprimido, esto pasaría el primer filtro
        # y solo se frenaría (o no) cuando pandas/openpyxl intentaran leerlo entero en
        # memoria.
        import io
        import zipfile

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("xl/worksheets/sheet1.xml", b"0" * (101 * 1024 * 1024))
        bomb = SimpleUploadedFile("plantilla.xlsx", buffer.getvalue(), content_type="application/octet-stream")

        response = self.client.post("/api/configuraciones/categorias/import/", {"file": bomb}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("inválido", str(response.data))


class TipoCategoriaBulkSaveTests(TestCase):
    """CRUD nuevo del catálogo de Tipo de Categoría (antes solo lectura) — reusa los
    permisos de Categoria (configuracion-categorias-*), ver bulk_save_tipos_categoria."""

    @classmethod
    def setUpTestData(cls):
        call_command("seed_local_db", verbosity=0)
        cls.active_status = get_status_by_name(ACTIVE_STATUS_NAME)

    def setUp(self):
        self.user = User.objects.create_user(username="tipo_cat_user", email="tipo_cat_user@test.local", password="x")
        self.client = APIClient()
        self.client.login(username="tipo_cat_user", password="x")

    def _bulk_save(self, payload):
        return self.client.post("/api/configuraciones/tipos-categoria/bulk-save/", payload, format="json")

    def test_create_success(self):
        response = self._bulk_save({"created": [{"name": "Ahorro", "description": "Categoría de ahorro"}]})
        self.assertEqual(response.status_code, 200, response.data)
        tipo = TipoCategoria.objects.get(name="Ahorro")

        # Regresión: mismo bug que TipoCuenta (ver cuenta/tests.py) — nom_tabla debe ser
        # "cfg_tipo_categorias", no "cfg_categorias".
        from apps.historial.models import Historial

        historial = Historial.objects.get(key_record=str(tipo.id))
        self.assertEqual(historial.nom_tabla, "cfg_tipo_categorias")

    def test_create_blocks_duplicate_name_global(self):
        response = self._bulk_save({"created": [{"name": "Gasto"}]})  # ya viene seedeado
        self.assertEqual(response.status_code, 400)

    def test_cannot_inactivar_tipo_in_use(self):
        tipo = TipoCategoria.objects.filter(key_status=self.active_status).first()
        Categoria.objects.create(key_user=self.user, key_tipo=tipo, name="Comida", key_status=self.active_status)
        response = self._bulk_save({"inactivated": [str(tipo.id)]})
        self.assertEqual(response.status_code, 400)
        tipo.refresh_from_db()
        self.assertEqual(tipo.key_status.name, ACTIVE_STATUS_NAME)
