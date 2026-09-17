import { API_BASE_URL, ApiError, ensureCsrfCookie } from "@/lib/api"
import type { CrudStatusFilter } from "@/components/crud-grid"
import type { HistorialDetalleEntry, HistorialEntry } from "@/components/historial-dialog"

export interface Moneda {
  id: string
  name: string
  code: string
  symbol: string | null
  description: string | null
  status: string
  status_id: string
  creation_date: string
  update_date: string
}

// Lo que arma la grilla a partir de sus filas "sucias" (nuevas/editadas/anuladas) para
// mandar en un solo request (ver MonedasPage) — el backend lo aplica todo en una
// transacción atómica (bulk_save_monedas).
export interface MonedaBulkSavePayload {
  created?: Array<Partial<Moneda>>
  updated?: Array<Partial<Moneda> & { id: string }>
  voided?: string[]
  restored?: string[]
  inactivated?: string[]
}

export interface MonedaImportValidation {
  rows: Array<{ row: number; fields: Record<string, string> }>
  errors: Array<{ row: number; field: string; message: string }>
}

export interface MonedaImportResult {
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

export async function listMonedas(): Promise<Moneda[]> {
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/monedas/`, {
    credentials: "include",
  })
  return parseJsonResponse<Moneda[]>(response)
}

export async function bulkSaveMonedas(payload: MonedaBulkSavePayload): Promise<Moneda[]> {
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/monedas/bulk-save/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": await ensureCsrfCookie(),
    },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<Moneda[]>(response)
}

interface MonedaImportJobStatus {
  status: "Procesando" | "Completado" | "Error"
  processed_rows: number
  total_rows: number | null
  result?: MonedaImportValidation
  error?: string
}

async function startMonedasImportValidate(file: File): Promise<{ job_id: string }> {
  const formData = new FormData()
  formData.append("file", file)
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/monedas/import/validate/start/`, {
    method: "POST",
    credentials: "include",
    // Sin Content-Type a mano: el navegador arma el boundary del multipart solo.
    headers: { "X-CSRFToken": await ensureCsrfCookie() },
    body: formData,
  })
  return parseJsonResponse<{ job_id: string }>(response)
}

async function getMonedasImportValidateStatus(jobId: string): Promise<MonedaImportJobStatus> {
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/monedas/import/validate/status/${jobId}/`, {
    credentials: "include",
  })
  return parseJsonResponse<MonedaImportJobStatus>(response)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Paso 1: analiza el archivo (preview fila por fila + errores por celda) sin guardar nada.
// El análisis corre en un hilo aparte en el backend (ver MonedaImportJob) — acá se arranca
// el job y se va consultando su estado cada 300ms hasta que termine, informando el avance
// real (fila a fila) por onProgress en vez de esperar a ciegas un solo request largo.
export async function validateImportMonedas(
  file: File,
  onProgress?: (processedRows: number, totalRows: number) => void
): Promise<MonedaImportValidation> {
  const { job_id: jobId } = await startMonedasImportValidate(file)
  for (;;) {
    const jobStatus = await getMonedasImportValidateStatus(jobId)
    if (jobStatus.status === "Procesando") {
      onProgress?.(jobStatus.processed_rows, jobStatus.total_rows ?? 0)
      await sleep(300)
      continue
    }
    if (jobStatus.status === "Error") {
      throw new Error(jobStatus.error || "No se pudo analizar el archivo.")
    }
    return jobStatus.result as MonedaImportValidation
  }
}

// Paso 2: confirma la importación de un archivo ya analizado en el paso 1.
export async function commitImportMonedas(file: File): Promise<MonedaImportResult> {
  const formData = new FormData()
  formData.append("file", file)
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/monedas/import/`, {
    method: "POST",
    credentials: "include",
    headers: { "X-CSRFToken": await ensureCsrfCookie() },
    body: formData,
  })
  return parseJsonResponse<MonedaImportResult>(response)
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
  return downloadBlob("/api/configuraciones/monedas/template/", "plantilla_monedas.xlsx")
}

// Exporta lo mismo que se está viendo en la grilla (Activos/Inactivos/Anulados/Todos) —
// "all" no manda filtro, el backend exporta todo (menos "Eliminado", ver _user_monedas).
const EXPORT_FILENAME_SUFFIX: Partial<Record<CrudStatusFilter, string>> = {
  active: "_activas",
  inactive: "_inactivas",
  voided: "_anuladas",
}

export function exportMonedas(statusFilter: CrudStatusFilter = "all"): Promise<void> {
  const query = statusFilter !== "all" ? `?status=${statusFilter}` : ""
  const filename = `monedas${EXPORT_FILENAME_SUFFIX[statusFilter] ?? ""}.xlsx`
  return downloadBlob(`/api/configuraciones/monedas/export/${query}`, filename)
}

export async function getMonedaHistorial(monedaId: string): Promise<HistorialEntry[]> {
  const response = await fetch(`${API_BASE_URL}/api/configuraciones/monedas/${monedaId}/historial/`, {
    credentials: "include",
  })
  return parseJsonResponse<HistorialEntry[]>(response)
}

export async function getMonedaHistorialDetalle(
  monedaId: string,
  historialId: string
): Promise<HistorialDetalleEntry[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/configuraciones/monedas/${monedaId}/historial/${historialId}/detalle/`,
    { credentials: "include" }
  )
  return parseJsonResponse<HistorialDetalleEntry[]>(response)
}
