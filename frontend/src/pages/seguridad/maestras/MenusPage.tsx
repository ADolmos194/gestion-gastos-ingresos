import { useEffect, useMemo, useState } from "react"

import { AppLayout } from "@/components/app-layout"
import { TransferListAssignment } from "@/components/transfer-list-assignment"
import { toastError } from "@/lib/toast"
import { getRoleMenus, listMenusCatalog, listRoles, saveRoleMenus, type MenuCatalogItem, type Role } from "@/lib/seguridad-api"

// Qué ítems del sidebar ve cada rol (sec_role_menu) — acá NO se crean menús (esos son
// rutas ya registradas en el frontend, ver MenuSerializer en el backend), solo se elige un
// rol y se lo vincula a los que ya existen.
export default function MenusPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [menus, setMenus] = useState<MenuCatalogItem[]>([])
  const [rolesLoading, setRolesLoading] = useState(true)
  const [menusLoading, setMenusLoading] = useState(true)

  useEffect(() => {
    listRoles()
      .then(setRoles)
      .catch((err: unknown) => toastError(err instanceof Error ? err.message : "No se pudieron cargar los roles."))
      .finally(() => setRolesLoading(false))
    listMenusCatalog()
      .then(setMenus)
      .catch((err: unknown) => toastError(err instanceof Error ? err.message : "No se pudieron cargar los menús."))
      .finally(() => setMenusLoading(false))
  }, [])

  const ownerOptions = useMemo(
    () =>
      roles
        .filter((role) => role.status !== "Anulado")
        .map((role) => ({ id: role.id, label: role.name, sublabel: role.all_access ? "Acceso total" : undefined })),
    [roles]
  )

  const catalogItems = useMemo(
    () =>
      [...menus]
        .sort((a, b) => a.full_title.localeCompare(b.full_title))
        .map((menu) => ({ id: menu.id, label: menu.full_title })),
    [menus]
  )

  return (
    <AppLayout>
      <TransferListAssignment
        ownerLabel="Rol"
        ownerOptions={ownerOptions}
        ownersLoading={rolesLoading}
        itemLabel="Menús"
        catalogItems={catalogItems}
        catalogLoading={menusLoading}
        fetchAssigned={getRoleMenus}
        saveAssigned={saveRoleMenus}
      />
    </AppLayout>
  )
}
