import { useMemo } from "react"

import { AppLayout } from "@/components/app-layout"
import { useCrudGrid, type CrudColumn } from "@/components/crud-grid"
import {
  bulkSaveMonedas,
  commitImportMonedas,
  downloadTemplate,
  exportMonedas,
  getMonedaHistorial,
  getMonedaHistorialDetalle,
  listMonedas,
  validateImportMonedas,
} from "@/lib/monedas-api"

export default function MonedasPage() {
  // Memoizado: useCrudGrid a su vez memoiza las columnas de AG Grid a partir de esto (ver
  // columnDefs en crud-grid.tsx) — mismo criterio que CategoriasPage.
  const columns = useMemo<CrudColumn[]>(
    () => [
      { data: "name", title: "NOMBRE", type: "text" },
      { data: "code", title: "CÓDIGO", type: "text" },
      { data: "symbol", title: "SÍMBOLO", type: "text" },
      { data: "description", title: "DESCRIPCÍON", type: "text" },
    ],
    []
  )

  const { toolbar, counters, body } = useCrudGrid({
    entityName: "monedas",
    columns,
    requiredFields: ["name", "code"],
    emptyFieldValues: () => ({ name: "", code: "", symbol: "", description: "" }),
    fromRecord: (moneda) => ({
      name: moneda.name,
      code: moneda.code,
      symbol: moneda.symbol ?? "",
      description: moneda.description ?? "",
    }),
    toPayload: (fields) => ({
      name: fields.name,
      code: fields.code,
      symbol: fields.symbol || null,
      description: fields.description || null,
    }),
    api: {
      list: listMonedas,
      bulkSave: bulkSaveMonedas,
      validateImport: validateImportMonedas,
      commitImport: commitImportMonedas,
      downloadTemplate,
      export: exportMonedas,
      fetchHistorial: getMonedaHistorial,
      fetchHistorialDetalle: getMonedaHistorialDetalle,
    },
  })

  return (
    <AppLayout headerActions={toolbar} summary={counters}>
      {body}
    </AppLayout>
  )
}
