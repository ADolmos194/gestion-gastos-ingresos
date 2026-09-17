import { API_BASE_URL, ApiError, ensureCsrfCookie } from "@/lib/api"
import type { CrudStatusFilter } from "@/components/crud-grid"
import type { HistorialDetalleEntry, HistorialEntry } from "@/components/historial-dialog"

export interface TipoCuenta {
  id: string
  name: string
}

// Moneda activa tal como la expone /monedas/activas/ (ver moneda/views.py) — subconjunto
// de Moneda (frontend/src/lib/monedas-api.ts), solo lo que necesita el dropdown Moneda.
export interface MonedaActiva {
  id: string
  code: string
  name: string
}

export interface Cuenta {
  id: string
  name: string
  key_tipo: string
  tipo_nombre: string
  key_moneda: string
  moneda_code: string
  account_number: string | null
  titular_name: string | null
  status: string
  status_id: string
  creation_date: string
  update_date: string
}

// Lo que arma la grilla a partir de sus filas "sucias" (nuevas/editadas/anuladas) para
// mandar en un solo request (ver CuentasPage) — el backend lo aplica todo en una
// transacción atómica (bulk_save_cuentas).
export interface CuentaBulkSavePayload {
  created?: Array<Partial<Cuenta>>
  updated?: Array<Partial<Cuenta> & { id: string }>
  voided?: string[]
  restored?: string[]
  inactivated?: string[]
}

export interface CuentaImportValidation {
  rows: Array<{ row: number; fields: Record<string, string> }>
  errors: Array<{ row: number; field: string; message: string }>
}

export interface CuentaImportResult {
  committed: boolean
  created_count: number
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

export async function listTiposCuenta(): Promise<TipoCuenta[]> {
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/tipos-cuenta/`, {
    credentials: "include",
  })
  return parseJsonResponse<TipoCuenta[]>(response)
}

export async function listMonedasActivas(): Promise<MonedaActiva[]> {
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/monedas/activas/`, {
    credentials: "include",
  })
  return parseJsonResponse<MonedaActiva[]>(response)
}

export async function listCuentas(): Promise<Cuenta[]> {
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/cuentas/`, {
    credentials: "include",
  })
  return parseJsonResponse<Cuenta[]>(response)
}

export async function bulkSaveCuentas(payload: CuentaBulkSavePayload): Promise<Cuenta[]> {
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/cuentas/bulk-save/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": await ensureCsrfCookie(),
    },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<Cuenta[]>(response)
}

interface CuentaImportJobStatus {
  status: "Procesando" | "Completado" | "Error"
  processed_rows: number
  total_rows: number | null
  result?: CuentaImportValidation
  error?: string
}

async function startCuentasImportValidate(file: File): Promise<{ job_id: string }> {
  const formData = new FormData()
  formData.append("file", file)
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/cuentas/import/validate/start/`, {
    method: "POST",
    credentials: "include",
    // Sin Content-Type a mano: el navegador arma el boundary del multipart solo.
    headers: { "X-CSRFToken": await ensureCsrfCookie() },
    body: formData,
  })
  return parseJsonResponse<{ job_id: string }>(response)
}

async function getCuentasImportValidateStatus(jobId: string): Promise<CuentaImportJobStatus> {
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/cuentas/import/validate/status/${jobId}/`, {
    credentials: "include",
  })
  return parseJsonResponse<CuentaImportJobStatus>(response)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Paso 1: analiza el archivo (preview fila por fila + errores por celda) sin guardar nada.
// El análisis corre en un hilo aparte en el backend (ver CuentaImportJob) — acá se arranca
// el job y se va consultando su estado cada 300ms hasta que termine, informando el avance
// real (fila a fila) por onProgress en vez de esperar a ciegas un solo request largo.
export async function validateImportCuentas(
  file: File,
  onProgress?: (processedRows: number, totalRows: number) => void
): Promise<CuentaImportValidation> {
  const { job_id: jobId } = await startCuentasImportValidate(file)
  for (;;) {
    const jobStatus = await getCuentasImportValidateStatus(jobId)
    if (jobStatus.status === "Procesando") {
      onProgress?.(jobStatus.processed_rows, jobStatus.total_rows ?? 0)
      await sleep(300)
      continue
    }
    if (jobStatus.status === "Error") {
      throw new Error(jobStatus.error || "No se pudo analizar el archivo.")
    }
    return jobStatus.result as CuentaImportValidation
  }
}

// Paso 2: confirma la importación de un archivo ya analizado en el paso 1.
export async function commitImportCuentas(file: File): Promise<CuentaImportResult> {
  const formData = new FormData()
  formData.append("file", file)
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/cuentas/import/`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRFToken": await ensureCsrfCookie() },
    body: formData,
  })
  return parseJsonResponse<CuentaImportResult>(response)
}

async function downloadBlob(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" })
  if (!response.ok) {
    const text = await response.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = { detail: `Error inesperado del servidor (${response.status}).` }
    }
    throw new ApiError(response.status, data)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function downloadTemplate(): Promise<void> {
  return downloadBlob("/api/configuraciones/cuentas/template/", "plantilla_cuentas.xlsx")
}

// Exporta lo mismo que se está viendo en la grilla (Activos/Inactivos/Anulados/Todos) —
// "all" no manda filtro, el backend exporta todo (menos "Eliminado", ver _user_cuentas).
const EXPORT_FILENAME_SUFFIX: Partial<Record<CrudStatusFilter, string>> = {
  active: "_activas",
  inactive: "_inactivas",
  voided: "_anuladas",
}

export function exportCuentas(statusFilter: CrudStatusFilter = "all"): Promise<void> {
  const query = statusFilter !== "all" ? `?status=${statusFilter}` : ""
  const filename = `cuentas${EXPORT_FILENAME_SUFFIX[statusFilter] ?? ""}.xlsx`
  return downloadBlob(`/api/configuraciones/cuentas/export/${query}`, filename)
}

export async function getCuentaHistorial(cuentaId: string): Promise<HistorialEntry[]> {
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/cuentas/${cuentaId}/historial/`, {
    credentials: "include",
  })
  return parseJsonResponse<HistorialEntry[]>(response)
}

export async function getCuentaHistorialDetalle(
  cuentaId: string,
  historialId: string
): Promise<HistorialDetalleEntry[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/configuraciones/cuentas/${cuentaId}/historial/${historialId}/detalle/`,
    { credentials: "include" }
  )
  return parseJsonResponse<HistorialDetalleEntry[]>(response)
}
