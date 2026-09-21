import { useEffect, useMemo, useState } from "react"

import { AppLayout } from "@/components/app-layout"
import { TransferListAssignment } from "@/components/transfer-list-assignment"
import { toastError } from "@/lib/toast"
import { getUsuarioRoles, listRoles, listUsuarios, saveUsuarioRoles, type Role, type Usuario } from "@/lib/seguridad-api"

// Qué roles tiene cada usuario (sec_user_roles) — acá NO se crean cuentas (eso es
// registro, ver apps.autenticacion), solo se elige un usuario ya existente y se lo
// vincula a los roles que ya existen. Mismo componente de "dos listas" que
// PermisosPage/MenusPage, con los papeles de dueño/ítem invertidos (dueño = usuario,
// ítem = rol).
export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [usuariosLoading, setUsuariosLoading] = useState(true)
  const [rolesLoading, setRolesLoading] = useState(true)

  useEffect(() => {
    listUsuarios()
      .then(setUsuarios)
      .catch((err: unknown) => toastError(err instanceof Error ? err.message : "No se pudieron cargar los usuarios."))
      .finally(() => setUsuariosLoading(false))
    listRoles()
      .then(setRoles)
      .catch((err: unknown) => toastError(err instanceof Error ? err.message : "No se pudieron cargar los roles."))
      .finally(() => setRolesLoading(false))
  }, [])

  const ownerOptions = useMemo(
    () =>
      usuarios.map((usuario) => ({
        id: usuario.id,
        label: usuario.username,
        sublabel: usuario.email,
      })),
    [usuarios]
  )

  const catalogItems = useMemo(
    () =>
      roles
        .filter((role) => role.status !== "Anulado")
        .map((role) => ({ id: role.id, label: role.name, sublabel: role.all_access ? "Acceso total" : undefined })),
    [roles]
  )

  return (
    <AppLayout>
      <TransferListAssignment
        ownerLabel="Usuario"
        ownerOptions={ownerOptions}
        ownersLoading={usuariosLoading}
        itemLabel="Roles"
        catalogItems={catalogItems}
        catalogLoading={rolesLoading}
        fetchAssigned={getUsuarioRoles}
        saveAssigned={saveUsuarioRoles}
      />
    </AppLayout>
  )
}
