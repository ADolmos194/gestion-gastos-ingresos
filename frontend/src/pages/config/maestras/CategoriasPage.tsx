import { useEffect, useMemo, useState } from "react"

import { AppLayout } from "@/components/app-layout"
import { useCrudGrid, type CrudColumn } from "@/components/crud-grid"
import {
  bulkSaveCategorias,
  commitImportCategorias,
  downloadTemplate,
  exportCategorias,
  getCategoriaHistorial,
  getCategoriaHistorialDetalle,
  listCategorias,
  listTiposCategoria,
  validateImportCategorias,
  type TipoCategoria,
} from "@/lib/categorias-api"

export default function CategoriasPage() {
  const [tipos, setTipos] = useState<TipoCategoria[]>([])

  useEffect(() => {
    listTiposCategoria().then(setTipos).catch(() => undefined)
  }, [])

  const tipoNames = useMemo(() => tipos.map((tipo) => tipo.name), [tipos])
  const tipoIdByName = useMemo(() => new Map(tipos.map((tipo) => [tipo.name, tipo.id])), [tipos])

  // Memoizado: useCrudGrid a su vez memoiza las columnas de AG Grid a partir de esto (ver
  // columnDefs en crud-grid.tsx) — si esto llegara con una referencia nueva en cada render
  // sin necesidad, esa memoización de abajo no serviría de nada.
  const columns = useMemo<CrudColumn[]>(
    () => [
      { data: "name", title: "NOMBRES", type: "text" },
      { data: "tipo", title: "TIPO", type: "dropdown", source: tipoNames, strict: true },
      { data: "description", title: "DESCRIPCÍON", type: "text" },
      { data: "color", title: "COLOR", type: "color" },
      { data: "icon", title: "ÍCONO", type: "icon" },
    ],
    [tipoNames]
  )

  const { toolbar, counters, body } = useCrudGrid({
    entityName: "categorías",
    columns,
    requiredFields: ["name", "tipo"],
    emptyFieldValues: () => ({ name: "", tipo: "", description: "", color: "", icon: "" }),
    fromRecord: (categoria) => ({
      name: categoria.name,
      tipo: categoria.tipo_nombre,
      description: categoria.description ?? "",
      color: categoria.color ?? "",
      icon: categoria.icon ?? "",
    }),
    toPayload: (fields) => ({
      name: fields.name,
      key_tipo: tipoIdByName.get(fields.tipo) ?? "",
      description: fields.description || null,
      color: fields.color || null,
      icon: fields.icon || null,
    }),
    api: {
      list: listCategorias,
      bulkSave: bulkSaveCategorias,
      validateImport: validateImportCategorias,
      commitImport: commitImportCategorias,
      downloadTemplate,
      export: exportCategorias,
      fetchHistorial: getCategoriaHistorial,
      fetchHistorialDetalle: getCategoriaHistorialDetalle,
    },
  })

  return (
    <AppLayout headerActions={toolbar} summary={counters}>
      {body}
    </AppLayout>
  )
}
