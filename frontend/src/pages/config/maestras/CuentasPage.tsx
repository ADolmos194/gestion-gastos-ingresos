import { useEffect, useMemo, useState } from "react"

import { AppLayout } from "@/components/app-layout"
import { useCrudGrid, type CrudColumn } from "@/components/crud-grid"
import {
  bulkSaveCuentas,
  commitImportCuentas,
  downloadTemplate,
  exportCuentas,
  getCuentaHistorial,
  getCuentaHistorialDetalle,
  listCuentas,
  listMonedasActivas,
  listTiposCuenta,
  validateImportCuentas,
  type MonedaActiva,
  type TipoCuenta,
} from "@/lib/cuentas-api"

export default function CuentasPage() {
  const [tipos, setTipos] = useState<TipoCuenta[]>([])
  const [monedas, setMonedas] = useState<MonedaActiva[]>([])

  useEffect(() => {
    listTiposCuenta().then(setTipos).catch(() => undefined)
    listMonedasActivas().then(setMonedas).catch(() => undefined)
  }, [])

  const tipoNames = useMemo(() => tipos.map((tipo) => tipo.name), [tipos])
  const tipoIdByName = useMemo(() => new Map(tipos.map((tipo) => [tipo.name, tipo.id])), [tipos])

  const monedaCodes = useMemo(() => monedas.map((moneda) => moneda.code), [monedas])
  const monedaIdByCode = useMemo(() => new Map(monedas.map((moneda) => [moneda.code, moneda.id])), [monedas])

  // Memoizado: useCrudGrid a su vez memoiza las columnas de AG Grid a partir de esto (ver
  // columnDefs en crud-grid.tsx) — mismo criterio que CategoriasPage.
  const columns = useMemo<CrudColumn[]>(
    () => [
      { data: "name", title: "NOMBRE", type: "text" },
      { data: "tipo", title: "TIPO", type: "dropdown", source: tipoNames, strict: true },
      { data: "moneda", title: "MONEDA", type: "dropdown", source: monedaCodes, strict: true },
      { data: "account_number", title: "N° DE CUENTA", type: "text" },
      { data: "titular_name", title: "TITULAR", type: "text" },
    ],
    [tipoNames, monedaCodes]
  )

  const { toolbar, counters, body } = useCrudGrid({
    entityName: "cuentas",
    columns,
    requiredFields: ["name", "tipo", "moneda"],
    emptyFieldValues: () => ({ name: "", tipo: "", moneda: "", account_number: "", titular_name: "" }),
    fromRecord: (cuenta) => ({
      name: cuenta.name,
      tipo: cuenta.tipo_nombre,
      moneda: cuenta.moneda_code,
      account_number: cuenta.account_number ?? "",
      titular_name: cuenta.titular_name ?? "",
    }),
    toPayload: (fields) => ({
      name: fields.name,
      key_tipo: tipoIdByName.get(fields.tipo) ?? "",
      key_moneda: monedaIdByCode.get(fields.moneda) ?? "",
      account_number: fields.account_number || null,
      titular_name: fields.titular_name || null,
    }),
    api: {
      list: listCuentas,
      bulkSave: bulkSaveCuentas,
      validateImport: validateImportCuentas,
      commitImport: commitImportCuentas,
      downloadTemplate,
      export: exportCuentas,
      fetchHistorial: getCuentaHistorial,
      fetchHistorialDetalle: getCuentaHistorialDetalle,
    },
  })

  return (
    <AppLayout headerActions={toolbar} summary={counters}>
      {body}
    </AppLayout>
  )
}
