export const API_BASE_URL = import.meta.env.VITE_URL_BASE

export interface MenuItem {
  id: string
  subject: string
  description: string | null
  title: string
  icon: string | null
  ordering: number
  to: string | null
  children: MenuItem[]
}

export interface PermisoFront {
  action: string
  subject: string
}

export interface UserInfo {
  id: string
  username: string
  name: string
  last_name: string
  email: string
  dni: string | null
  // true = rol de acceso total (ve todo el menú, sin restricciones).
  role: boolean
}

// Payload que devuelven login/me/refresh: usuario + el menú y los permisos que le
// corresponden, ya resueltos por el backend (ver apps.seguridad.services en el backend).
export interface SessionUser {
  user_info: UserInfo
  menus: MenuItem[]
  permisos_front: PermisoFront[]
  permisos_back: string[]
}

// DRF puede devolver el cuerpo de un error de tres formas distintas según de dónde salga:
// - {"detail": "..."}: errores generales (credenciales, link inválido, permisos, etc.)
// - {"campo": ["msg", ...], ...}: errores de validación por campo (serializers — registro,
//   reset-password, y ahora también validate_key_moneda en CuentaSerializer).
// - ["msg"]: `raise ValidationError("mensaje")` a nivel de vista, sin pasar por un
//   serializer (patrón usado en categoria/moneda/cuenta views.py para duplicados, "no
//   existe o no te pertenece", etc.) — DRF envuelve un string suelto en una lista.
// extractErrorMessage entiende los tres para que ApiError.message (lo que muestran los
// toasts de CrudGrid) nunca caiga al genérico "Error inesperado..." cuando el backend en
// realidad ya mandó un texto explicando qué pasó.
function extractErrorMessage(data: unknown, status: number): string {
  if (typeof data === "object" && data !== null) {
    if (!Array.isArray(data) && "detail" in data) {
      return String((data as { detail?: unknown }).detail)
    }
    const messages: string[] = Array.isArray(data)
      ? data.map(String)
      : Object.values(data as Record<string, unknown>).flatMap((value) =>
          Array.isArray(value) ? value.map(String) : [String(value)]
        )
    if (messages.length) {
      return messages.join(" ")
    }
  }
  return `Error inesperado del servidor (${status}).`
}

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(status: number, data: unknown) {
    super(extractErrorMessage(data, status))
    this.status = status
    this.data = data
  }
}

// Mismo criterio que extractErrorMessage, pero separando "general" (arriba del form) de
// "fields" (bajo cada input) — lo usan los forms de autenticación (registro, reset-password,
// verificación) que sí necesitan resaltar el input puntual, no solo un toast.
export interface ParsedApiError {
  general?: string
  fields: Record<string, string[]>
}

export function parseApiError(err: unknown): ParsedApiError {
  if (!(err instanceof ApiError)) {
    return { general: "No se pudo conectar con el servidor.", fields: {} }
  }
  if (typeof err.data !== "object" || err.data === null || Array.isArray(err.data)) {
    // {"detail": "..."} ya lo cubre err.message (ApiError ya lo extrajo); un array plano
    // (["msg"]) no tiene campos que resaltar, así que también cae acá como "general".
    return { general: err.message, fields: {} }
  }
  if ("detail" in err.data) {
    return { general: err.message, fields: {} }
  }
  const fields: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(err.data as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      fields[key] = value.map(String)
    }
  }
  return { fields }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

// El login/registro/etc necesitan el token csrftoken (double-submit cookie) en el
// header X-CSRFToken. Si el navegador todavía no lo tiene, lo pedimos una vez.
export async function ensureCsrfCookie(): Promise<string> {
  let token = readCookie("csrftoken")
  if (!token) {
    await fetch(`${API_BASE_URL}/api/auth/csrf/`, { credentials: "include" })
    token = readCookie("csrftoken")
  }
  if (!token) {
    throw new Error("No se pudo obtener el token CSRF del backend.")
  }
  return token
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase()
  const headers = new Headers(init.headers)

  if (!SAFE_METHODS.has(method)) {
    headers.set("X-CSRFToken", await ensureCsrfCookie())
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method,
    headers,
    // Requerido para que el navegador mande/reciba la cookie de sesión cross-origin.
    credentials: "include",
  })

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  let data: unknown
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      // El backend puede devolver HTML en errores no manejados (p.ej. un 500 de Django);
      // lo envolvemos para que ApiError siempre tenga un mensaje razonable.
      data = { detail: `Error inesperado del servidor (${response.status}).` }
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, data)
  }

  return data as T
}

// "identifier" acepta el username o el email registrado (ver backend LoginView).
export function login(identifier: string, password: string) {
  return apiFetch<SessionUser>("/api/auth/login/", {
    method: "POST",
    body: JSON.stringify({ username: identifier, password }),
  })
}

export function logout() {
  return apiFetch<void>("/api/auth/logout/", { method: "POST" })
}

export function me(signal?: AbortSignal) {
  return apiFetch<SessionUser>("/api/auth/me/", { signal })
}

export interface RefreshResult extends SessionUser {
  expires_in: number
}

// Confirma que la sesión sigue activa y desliza su expiración (ver RefreshSessionView en el
// backend). No hay token que refrescar, es una cookie de sesión de Django.
export function refresh(signal?: AbortSignal) {
  return apiFetch<RefreshResult>("/api/auth/refresh/", { method: "POST", signal })
}

export interface RegisterInput {
  username: string
  email: string
  password: string
  first_name?: string
  last_name?: string
}

// RegisterView no crea sesión (ver backend), por eso devuelve el usuario plano en vez del
// SessionUser con menú/permisos que sí trae login/me/refresh.
export interface RegisteredAccount {
  id: string
  username: string
  email: string
  first_name: string
  last_name: string
}

export function register(input: RegisterInput) {
  return apiFetch<RegisteredAccount>("/api/auth/register/", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function forgotPassword(email: string) {
  return apiFetch<{ detail: string }>("/api/auth/forgot-password/", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export function resetPassword(email: string, code: string, newPassword: string) {
  return apiFetch<{ detail: string }>("/api/auth/reset-password/", {
    method: "POST",
    body: JSON.stringify({ email, code, new_password: newPassword }),
  })
}

export function verifyEmail(email: string, code: string) {
  return apiFetch<{ detail: string }>("/api/auth/verify-email/", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  })
}

export function resendVerification(email: string) {
  return apiFetch<{ detail: string }>("/api/auth/resend-verification/", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiFetch<{ detail: string }>("/api/auth/change-password/", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}
