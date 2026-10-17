"""Tests de la sanitización anti inyección de fórmulas en las exportaciones .xlsx
(excel_utils.dataframe_to_xlsx_response). Son SimpleTestCase: nada de base de datos."""
from io import BytesIO

import openpyxl
import pandas as pd
from django.test import SimpleTestCase

from apps.configuraciones.excel_utils import dataframe_to_xlsx_response


class XlsxFormulaInjectionTests(SimpleTestCase):
    DANGEROUS_VALUES = [
        '=HYPERLINK("http://evil.example", "click")',
        "+2",
        "-1+1",
        "@SUM(A1:A2)",
        "\t=cmd|'/C calc'!A0",
        "\r=2",
    ]

    def _cell_values(self, df: pd.DataFrame) -> list[list[object]]:
        response = dataframe_to_xlsx_response(df, "test.xlsx", "Hoja1", "Activo", "Cancelado")
        workbook = openpyxl.load_workbook(BytesIO(response.content))
        worksheet = workbook["Hoja1"]
        return [list(row) for row in worksheet.iter_rows(values_only=True)]

    def test_valores_peligrosos_quedan_prefijados_con_comilla(self):
        df = pd.DataFrame([self.DANGEROUS_VALUES], columns=[f"col{i}" for i in range(len(self.DANGEROUS_VALUES))])
        rows = self._cell_values(df)
        data_row = rows[1]
        for value, cell in zip(self.DANGEROUS_VALUES, data_row):
            self.assertEqual(cell, "'" + value, msg=f"celda debería estar prefijada: {value!r}")

    def test_valores_normales_no_se_tocan(self):
        df = pd.DataFrame([["Comida", "Gasto", "Almuerzo", "Activo"]], columns=["N", "T", "D", "Estado"])
        rows = self._cell_values(df)
        self.assertEqual(rows[1], ["Comida", "Gasto", "Almuerzo", "Activo"])

    def test_header_se_mantiene(self):
        df = pd.DataFrame([["Comida", "Activo"]], columns=["Nombre", "Estado"])
        rows = self._cell_values(df)
        self.assertEqual(rows[0], ["Nombre", "Estado"])