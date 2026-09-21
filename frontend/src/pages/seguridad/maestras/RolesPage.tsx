import { useMemo } from "react"

import { AppLayout } from "@/components/app-layout"
import { useCrudGrid, type CrudColumn } from "@/components/crud-grid"
import { bulkSaveRoles, listRoles } from "@/lib/seguridad-api"

// "Sí"/"No" en vez de un tipo "checkbox" propio en CrudColumn (que no existe, ver
// crud-grid.tsx: solo text/dropdown/color/icon) — mismo truco que un dropdown común, con
// una lista estricta de 2 valores.
const ALL_ACCESS_YES = "Sí"
const ALL_ACCESS_NO = "No"

export default function RolesPage() {
  const columns = useMemo<CrudColumn[]>(
    () => [
      { data: "name", title: "NOMBRE", type: "text" },
      { data: "description", title: "DESCRIPCIÓN", type: "text" },
      { data: "all_access", title: "ACCESO TOTAL", type: "dropdown", source: [ALL_ACCESS_NO, ALL_ACCESS_YES], strict: true },
    ],
    []
  )

  const { toolbar, counters, body } = useCrudGrid({
    entityName: "roles",
    columns,
    requiredFields: ["name"],
    emptyFieldValues: () => ({ name: "", description: "", all_access: ALL_ACCESS_NO }),
    fromRecord: (role) => ({
      name: role.name,
      description: role.description ?? "",
      all_access: role.all_access ? ALL_ACCESS_YES : ALL_ACCESS_NO,
    }),
    toPayload: (fields) => ({
      name: fields.name,
      description: fields.description || null,
      all_access: fields.all_access === ALL_ACCESS_YES,
    }),
    api: {
      list: listRoles,
      bulkSave: bulkSaveRoles,
    },
  })

  return (
    <AppLayout headerActions={toolbar} summary={counters}>
      {body}
    </AppLayout>
  )
}
