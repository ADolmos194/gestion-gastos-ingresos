import { API_BASE_URL, ApiError, ensureCsrfCookie } from "@/lib/api"
import type { HistorialDetalleEntry, HistorialEntry } from "@/components/historial-dialog"

export interface Movimiento {
  id: string
  movement_date: string
  key_categoria: string
  categoria_nombre: string
  tipo_nombre: string
  key_cuenta: string
  cuenta_nombre: string
  moneda_code: string
  amount: string
  description: string | null
  status: string
  status_id: string
  creation_date: string
  update_date: string
}

// Lo que arma la grilla a partir de sus filas "sucias" para mandar en un solo request (ver
// MovimientosPage) — el backend lo aplica todo en una transacción atómica
// (bulk_save_movimientos), mismo contrato que categorias-api.ts/cuentas-api.ts.
export interface MovimientoBulkSavePayload {
  created?: Array<Partial<Movimiento>>
  updated?: Array<Partial<Movimiento> & { id: string }>
  voided?: string[]
  restored?: string[]
  inactivated?: string[]
}

export interface Saldo {
  cuenta_id: string
  cuenta_nombre: string
  moneda_code: string
  saldo: string
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

export async function listMovimientos(): Promise<Movimiento[]> {
  const response = await fetch(`${API_BASE_URL}/api/finanzas/movimientos/`, {
    credentials: "include",
  })
  return parseJsonResponse<Movimiento[]>(response)
}

export async function listSaldos(): Promise<Saldo[]> {
  const response = await fetch(`${API_BASE_URL}/api/finanzas/movimientos/saldos/`, {
    credentials: "include",
  })
  return parseJsonResponse<Saldo[]>(response)
}

export async function bulkSaveMovimientos(payload: MovimientoBulkSavePayload): Promise<Movimiento[]> {
  const response = await fetch(`${API_BASE_URL}/api/finanzas/movimientos/bulk-save/`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": await ensureCsrfCookie(),
    },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<Movimiento[]>(response)
}

export async function getMovimientoHistorial(movimientoId: string): Promise<HistorialEntry[]> {
  const response = await fetch(`${API_BASE_URL}/api/finanzas/movimientos/${movimientoId}/historial/`, {
    credentials: "include",
  })
  return parseJsonResponse<HistorialEntry[]>(response)
}

export async function getMovimientoHistorialDetalle(
  movimientoId: string,
  historialId: string
): Promise<HistorialDetalleEntry[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/finanzas/movimientos/${movimientoId}/historial/${historialId}/detalle/`,
    { credentials: "include" }
  )
  return parseJsonResponse<HistorialDetalleEntry[]>(response)
}
