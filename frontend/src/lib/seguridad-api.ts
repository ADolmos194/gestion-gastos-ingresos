import { API_BASE_URL, ApiError, ensureCsrfCookie } from "@/lib/api"

export interface Role {
  id: string
  name: string
  description: string | null
  all_access: boolean
  status: string
  status_id: string
  creation_date: string
  update_date: string
}

// Mismo contrato que MonedaBulkSavePayload (ver monedas-api.ts): la grilla arma estas
// cinco bolsas a partir de sus filas "sucias" y las manda en un solo request.
export interface RoleBulkSavePayload {
  created?: Array<Partial<Role>>
  updated?: Array<Partial<Role> & { id: string }>
  voided?: string[]
  restored?: string[]
  inactivated?: string[]
}

export interface Permission {
  id: string
  decorator_name: string
  module_name: string
  api_url: string
  action_name: string | null
  status: string
}

export interface MenuCatalogItem {
  id: string
  subject: string
  title: string
  icon: string | null
  router_to: string | null
  ordering: number
  key_father_menu: string | null
  status: string
  full_title: string
}

export interface Usuario {
  id: string
  username: string
  email: string
  first_name: string
  last_name: string
  role_ids: string[]
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let data: unknown
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { detail: `Error inesperado del servidor (${response.status}).` }
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, data)
  }
  return data as T
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" })
  return parseJsonResponse<T>(response)
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": await ensureCsrfCookie(),
    },
    body: JSON.stringify(body),
  })
  return parseJsonResponse<T>(response)
}

export function listRoles(): Promise<Role[]> {
  return getJson("/api/seguridad/roles/")
}

export function bulkSaveRoles(payload: RoleBulkSavePayload): Promise<Role[]> {
  return postJson("/api/seguridad/roles/bulk-save/", payload)
}

export function listPermissions(): Promise<Permission[]> {
  return getJson("/api/seguridad/permissions/")
}

export function listMenusCatalog(): Promise<MenuCatalogItem[]> {
  return getJson("/api/seguridad/menus/")
}

export function listUsuarios(): Promise<Usuario[]> {
  return getJson("/api/seguridad/usuarios/")
}

interface AssignedIdsResponse {
  assigned_ids: string[]
}

export async function getRolePermissions(roleId: string): Promise<string[]> {
  return (await getJson<AssignedIdsResponse>(`/api/seguridad/roles/${roleId}/permissions/`)).assigned_ids
}

export async function saveRolePermissions(roleId: string, permissionIds: string[]): Promise<string[]> {
  return (
    await postJson<AssignedIdsResponse>(`/api/seguridad/roles/${roleId}/permissions/`, { permission_ids: permissionIds })
  ).assigned_ids
}

export async function getRoleMenus(roleId: string): Promise<string[]> {
  return (await getJson<AssignedIdsResponse>(`/api/seguridad/roles/${roleId}/menus/`)).assigned_ids
}

export async function saveRoleMenus(roleId: string, menuIds: string[]): Promise<string[]> {
  return (await postJson<AssignedIdsResponse>(`/api/seguridad/roles/${roleId}/menus/`, { menu_ids: menuIds })).assigned_ids
}

export async function getUsuarioRoles(userId: string): Promise<string[]> {
  return (await getJson<AssignedIdsResponse>(`/api/seguridad/usuarios/${userId}/roles/`)).assigned_ids
}

export async function saveUsuarioRoles(userId: string, roleIds: string[]): Promise<string[]> {
  return (await postJson<AssignedIdsResponse>(`/api/seguridad/usuarios/${userId}/roles/`, { role_ids: roleIds }))
    .assigned_ids
}
