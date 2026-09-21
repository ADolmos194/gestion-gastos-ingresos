import { useEffect, useMemo, useState } from "react"

import { AppLayout } from "@/components/app-layout"
import { TransferListAssignment } from "@/components/transfer-list-assignment"
import { toastError } from "@/lib/toast"
import { getRolePermissions, listPermissions, listRoles, saveRolePermissions, type Permission, type Role } from "@/lib/seguridad-api"

// Qué permiso tiene cada rol: acá NO se crean permisos (esos nacen del código, ver
// PermissionSerializer en el backend) — solo se elige un rol y se lo vincula a los
// permisos que ya existen. Mismo patrón de "dos listas" que MenusPage/UsuariosPage, sobre
// TransferListAssignment.
export default function PermisosPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [rolesLoading, setRolesLoading] = useState(true)
  const [permissionsLoading, setPermissionsLoading] = useState(true)

  useEffect(() => {
    listRoles()
      .then(setRoles)
      .catch((err: unknown) => toastError(err instanceof Error ? err.message : "No se pudieron cargar los roles."))
      .finally(() => setRolesLoading(false))
    listPermissions()
      .then(setPermissions)
      .catch((err: unknown) => toastError(err instanceof Error ? err.message : "No se pudieron cargar los permisos."))
      .finally(() => setPermissionsLoading(false))
  }, [])

  const ownerOptions = useMemo(
    () =>
      roles
        .filter((role) => role.status !== "Anulado")
        .map((role) => ({ id: role.id, label: role.name, sublabel: role.all_access ? "Acceso total" : undefined })),
    [roles]
  )

  const catalogItems = useMemo(
    () => permissions.map((permission) => ({ id: permission.id, label: permission.module_name, sublabel: permission.decorator_name })),
    [permissions]
  )

  return (
    <AppLayout>
      <TransferListAssignment
        ownerLabel="Rol"
        ownerOptions={ownerOptions}
        ownersLoading={rolesLoading}
        itemLabel="Permisos"
        catalogItems={catalogItems}
        catalogLoading={permissionsLoading}
        fetchAssigned={getRolePermissions}
        saveAssigned={saveRolePermissions}
      />
    </AppLayout>
  )
}
