import { useEffect, useMemo, useState } from "react"

import { AppLayout } from "@/components/app-layout"
import { useCrudGrid, type CrudColumn } from "@/components/crud-grid"
import { listCategoriasActivas, type Categoria } from "@/lib/categorias-api"
import { listCuentasActivas, type Cuenta } from "@/lib/cuentas-api"
import {
  bulkSaveMovimientos,
  getMovimientoHistorial,
  getMovimientoHistorialDetalle,
  listMovimientos,
} from "@/lib/movimientos-api"

export default function MovimientosPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cuentas, setCuentas] = useState<Cuenta[]>([])

  useEffect(() => {
    listCategoriasActivas().then(setCategorias).catch(() => undefined)
    listCuentasActivas().then(setCuentas).catch(() => undefined)
  }, [])

  const categoriaNames = useMemo(() => categorias.map((categoria) => categoria.name), [categorias])
  const categoriaIdByName = useMemo(
    () => new Map(categorias.map((categoria) => [categoria.name, categoria.id])),
    [categorias]
  )

  const cuentaNames = useMemo(() => cuentas.map((cuenta) => cuenta.name), [cuentas])
  const cuentaIdByName = useMemo(() => new Map(cuentas.map((cuenta) => [cuenta.name, cuenta.id])), [cuentas])

  // Memoizado: useCrudGrid a su vez memoiza las columnas de AG Grid a partir de esto (ver
  // columnDefs en crud-grid.tsx) — mismo criterio que CuentasPage.
  const columns = useMemo<CrudColumn[]>(
    () => [
      { data: "fecha", title: "FECHA", type: "text" },
      { data: "categoria", title: "CATEGORÍA", type: "dropdown", source: categoriaNames, strict: true },
      { data: "cuenta", title: "CUENTA", type: "dropdown", source: cuentaNames, strict: true },
      { data: "monto", title: "MONTO", type: "text" },
      { data: "descripcion", title: "DESCRIPCIÓN", type: "text" },
    ],
    [categoriaNames, cuentaNames]
  )

  const { toolbar, counters, body } = useCrudGrid({
    entityName: "movimientos",
    columns,
    requiredFields: ["fecha", "categoria", "cuenta", "monto"],
    emptyFieldValues: () => ({ fecha: "", categoria: "", cuenta: "", monto: "", descripcion: "" }),
    fromRecord: (movimiento) => ({
      fecha: movimiento.movement_date,
      categoria: movimiento.categoria_nombre,
      cuenta: movimiento.cuenta_nombre,
      monto: movimiento.amount,
      descripcion: movimiento.description ?? "",
    }),
    toPayload: (fields) => ({
      movement_date: fields.fecha,
      key_categoria: categoriaIdByName.get(fields.categoria) ?? "",
      key_cuenta: cuentaIdByName.get(fields.cuenta) ?? "",
      amount: fields.monto,
      description: fields.descripcion || null,
    }),
    api: {
      list: listMovimientos,
      bulkSave: bulkSaveMovimientos,
      fetchHistorial: getMovimientoHistorial,
      fetchHistorialDetalle: getMovimientoHistorialDetalle,
    },
  })

  return (
    <AppLayout headerActions={toolbar} summary={counters}>
      {body}
    </AppLayout>
  )
}
