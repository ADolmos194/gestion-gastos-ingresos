import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react"
import { AgGridReact } from "ag-grid-react"
import type { CustomCellRendererProps } from "ag-grid-react"
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellClassRules,
  type CellContextMenuEvent,
  type CellValueChangedEvent,
  type ColDef,
  type GetRowIdParams,
  type GridApi,
  type RowClassRules,
} from "ag-grid-community"
import {
  BanIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  EllipsisIcon,
  EraserIcon,
  FileDownIcon,
  FileSpreadsheetIcon,
  HistoryIcon,
  ListIcon,
  Loader2Icon,
  PackageOpenIcon,
  PencilLineIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  SearchXIcon,
  Undo2Icon,
  UploadIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ColorPickerDialog } from "@/components/color-picker-dialog"
import { HistorialDialog, type HistorialDetalleEntry, type HistorialEntry } from "@/components/historial-dialog"
import { IconPickerDialog } from "@/components/icon-picker-dialog"
import { ImportPreviewGrid } from "@/components/import-preview-grid"
import { iconFromKey, UNOCSS_ICON_PREFIX } from "@/lib/menu-icons"
import { toastError, toastPromise, toastSuccess } from "@/lib/toast"
import { withMinDuration } from "@/lib/utils"

// AG Grid arma sus módulos por feature; hay que registrarlos una sola vez, acá al importar
// el archivo, no en cada render. AllCommunityModule alcanza para todo lo que usa este
// componente (no hace falta nada de Enterprise — ver por qué en el historial del proyecto:
// Handsontable era de pago para uso comercial y este componente se migró a AG Grid Community,
// que es MIT y gratis siempre, para poder cobrar por el sistema sin depender de una licencia).
ModuleRegistry.registerModules([AllCommunityModule])

const gridTheme = themeQuartz

// IDs reales de los status (ver frontend/.env, cfg_status en el backend) — se comparan
// contra esto para pintar filas/celdas y para el filtro Activos/Inactivos/Anulados, en vez
// de comparar por nombre.
const ACTIVE_STATUS_ID = import.meta.env.VITE_STATUS_ACTIVATE
const INACTIVE_STATUS_ID = import.meta.env.VITE_STATUS_INACTIVATE
const VOIDED_STATUS_ID = import.meta.env.VITE_STATUS_VOID

// Texto de la columna ESTADO para cada status EFECTIVO posible (ver effectiveStatusId más
// abajo) — coincide con el "name" real de cfg_status, pero se hardcodea porque para una fila
// con una acción pendiente de guardar (anular/inactivar/restaurar) esto tiene que reflejar
// el estado al que va a quedar, no el que el server todavía tiene, y en ese momento no hay
// ningún registro real del que leerlo.
const STATUS_LABEL_BY_ID: Record<string, string> = {
  [ACTIVE_STATUS_ID]: "Activo",
  [INACTIVE_STATUS_ID]: "Inactivo",
  [VOIDED_STATUS_ID]: "Anulado",
}

// Piso de tiempo que se deja ver el overlay de carga (inicial y en "Refrescar"), para que
// no sea un parpadeo imperceptible cuando el request es rápido (ej. localhost). Mismo
// criterio que AUTH_TRANSITION_DELAY_MS en auth-context.tsx.
const LOADING_MIN_MS = 500

// Delay en cascada para el toolbar del CrudGrid (ver `secondaryActions` más abajo): al abrir
// la búsqueda, cada botón secundario se contrae en orden (HIDE_DELAYS); al cerrarla, vuelven
// a aparecer en orden inverso (SHOW_DELAYS), como si se desplegaran desde el lado del "⋯".
// Escritos como strings literales completos (no template strings con el índice interpolado)
// porque Tailwind solo genera CSS para clases que puede encontrar como texto en el código.
const HIDE_DELAYS = ["delay-0", "delay-[50ms]", "delay-[100ms]", "delay-[150ms]", "delay-[200ms]"]
const SHOW_DELAYS = ["delay-[200ms]", "delay-[150ms]", "delay-[100ms]", "delay-[50ms]", "delay-0"]

// Todo maestro que use este grid necesita estos tres campos en lo que devuelve la API,
// además de los propios del módulo (ver CrudGridProps.columns).
export interface CrudRecord {
  id: string
  status: string
  status_id: string
}

export interface CrudColumn {
  data: string
  title: string
  // "color"/"icon": la celda no se tipea a mano, se abre un selector (ColorPickerDialog /
  // IconPickerDialog) al hacer click — ver ColorCellRenderer/IconCellRenderer.
  type?: "text" | "dropdown" | "color" | "icon"
  source?: string[]
  strict?: boolean
}

export interface CrudImportPreviewRow {
  row: number
  fields: Record<string, string>
}

export interface CrudImportError {
  row: number
  field: string
  message: string
}

// Resultado de analizar el archivo (paso 1, no guarda nada): el preview fila por fila más
// los errores por celda, para pintarlos en ImportPreviewGrid.
export interface CrudImportValidation {
  rows: CrudImportPreviewRow[]
  errors: CrudImportError[]
}

// Resultado de confirmar la importación (paso 2, ya con el archivo validado).
export interface CrudImportResult {
  committed: boolean
  created_count: number
}

export interface CrudBulkSavePayload {
  created: Record<string, unknown>[]
  updated: Array<Record<string, unknown> & { id: string }>
  voided: string[]
  restored: string[]
  inactivated: string[]
}

// Mismos cuatro valores en todos lados: el filtro de la barra (ver statusFilter más abajo)
// y qué le pasa "Exportar" a api.export para traer lo mismo que se está viendo.
export type CrudStatusFilter = "all" | "active" | "inactive" | "voided"

export interface CrudGridApi<T> {
  list: () => Promise<T[]>
  bulkSave: (payload: CrudBulkSavePayload) => Promise<T[]>
  // Analiza el archivo sin guardar nada (paso 1 del diálogo de importación). onProgress,
  // si el módulo lo soporta, informa el avance real fila a fila (ver ImportProgress).
  validateImport?: (file: File, onProgress?: (processedRows: number, totalRows: number) => void) => Promise<CrudImportValidation>
  // Confirma la importación de un archivo ya analizado (paso 2).
  commitImport?: (file: File) => Promise<CrudImportResult>
  downloadTemplate?: () => Promise<void>
  // Recibe el filtro de estado actual de la grilla, para exportar lo mismo que se está
  // viendo (Activos/Inactivos/Anulados/Todos) en vez de siempre todo.
  export?: (statusFilter: CrudStatusFilter) => Promise<void>
  // Historial de auditoría de una fila puntual (ver HistorialDialog) — si no se pasa, el
  // ítem "Historial" del menú click-derecho no aparece.
  fetchHistorial?: (recordId: string) => Promise<HistorialEntry[]>
  fetchHistorialDetalle?: (recordId: string, historialId: string) => Promise<HistorialDetalleEntry[]>
}

export interface CrudGridProps<T extends CrudRecord> {
  // Usado en los mensajes ("No se pudieron cargar las categorías", etc). En plural y
  // minúscula, p.ej. "categorías", "cuentas", "usuarios".
  entityName: string
  columns: CrudColumn[]
  // `data` de las columnas que no pueden quedar vacías para poder guardar.
  requiredFields: string[]
  emptyFieldValues: () => Record<string, string>
  fromRecord: (record: T) => Record<string, string>
  toPayload: (fields: Record<string, string>) => Record<string, unknown>
  api: CrudGridApi<T>
}

export interface CrudGridController {
  // Barra de íconos (Agregar fila, Guardar cambios, Importar, etc., todos juntos en una
  // sola fila) — se puede mostrar donde convenga, p.ej. AppLayout la pone a la par del
  // breadcrumb en vez de arriba de la tabla.
  toolbar: ReactNode
  // Conteo de filas activas/modificadas/anuladas/nuevas — pensado para el lugar que deja
  // libre el breadcrumb (que ahora vive en el navbar, no en esta fila).
  counters: ReactNode
  // La tabla en sí + los diálogos (resultado de importación, pickers de color/ícono).
  body: ReactNode
}

interface GridRow {
  id: string | null
  clientId: string
  status: string
  statusId: string
  dirty: boolean
  pendingVoid: boolean
  // Activo en el server, marcado para pasar a Inactivo, pendiente de "Guardar cambios" —
  // mismo criterio que pendingVoid pero para el otro destino posible (ver
  // inactivateRows más abajo).
  pendingInactive: boolean
  // Anulado o Inactivo en el server, marcado para volver a Activo, pendiente de "Guardar
  // cambios" — inversa de pendingVoid/pendingInactive (ver restoreRows más abajo).
  pendingRestore: boolean
  fields: Record<string, string>
}

function recordToRow<T extends CrudRecord>(record: T, fromRecord: (r: T) => Record<string, string>): GridRow {
  return {
    id: record.id,
    clientId: record.id,
    status: record.status,
    statusId: record.status_id,
    dirty: false,
    pendingVoid: false,
    pendingInactive: false,
    pendingRestore: false,
    fields: fromRecord(record),
  }
}

function blankRow(emptyFieldValues: () => Record<string, string>): GridRow {
  return {
    id: null,
    clientId: `new-${crypto.randomUUID()}`,
    // Todavía no existe en el servidor, pero al guardar nace Activo — se muestra así
    // desde ya para no inventar un estado que no existe en cfg_status.
    status: "ACTIVO",
    statusId: ACTIVE_STATUS_ID,
    dirty: true,
    pendingVoid: false,
    pendingInactive: false,
    pendingRestore: false,
    fields: emptyFieldValues(),
  }
}

// AG Grid, al editar una celda con `field` de ruta anidada ("fields.x"), escribe el valor
// directo sobre el objeto que le pasamos como `rowData` — no lo clona. Si `rows` y
// `savedRows` compartieran el mismo objeto `fields`, esa escritura en caliente corrompía
// también la "foto" de respaldo, y "Descartar cambios" terminaba clonando datos ya editados
// en vez de los originales. Por eso cualquier snapshot que se guarde en `savedRows` tiene
// que clonar `fields` aparte, para que la grilla nunca pueda tocarlo mutando `rows`.
function cloneRow(row: GridRow): GridRow {
  return { ...row, fields: { ...row.fields } }
}

// Ya Anulado en el server, o con una anulación recién marcada (pendingVoid, todavía sin
// guardar): no se puede seguir editando ese campo — ni a mano, ni con los pickers de
// color/ícono (ver isRowEditable más abajo, mismo criterio para ambos casos).
function isRowEditable(row: GridRow | undefined): boolean {
  if (!row) return false
  return !row.pendingVoid && row.statusId !== VOIDED_STATUS_ID
}

// Anulado desde el punto de vista del usuario ahora mismo — ya sea porque así está en el
// server, o porque se acaba de marcar pendingVoid sin guardar todavía. Si hay una
// restauración pendiente sin guardar (pendingRestore), ya no cuenta como anulado aunque el
// server todavía no se haya enterado (ver restoreRows/voidRows más abajo, y el menú
// click-derecho que usa esto para elegir entre "Anular registro"/"Activar registro").
function isRowVoided(row: GridRow): boolean {
  if (row.pendingRestore) return false
  return row.pendingVoid || row.statusId === VOIDED_STATUS_ID
}

// Mismo criterio que isRowVoided, para Inactivo en vez de Anulado — a las dos las junta el
// mismo botón "Activar registro" del menú click-derecho, así que nunca hace falta que las
// dos den true a la vez para la misma fila (voidRows/inactivateRows tampoco dejan).
function isRowInactive(row: GridRow): boolean {
  if (row.pendingRestore) return false
  return row.pendingInactive || row.statusId === INACTIVE_STATUS_ID
}

// Efectiva ahora mismo desde el punto de vista del usuario, ANTES de guardar — usado tanto
// por EstadoCellRenderer (el texto) como por estadoCellClassRules (el color de fondo), para
// que nunca puedan mostrar cosas distintas entre sí. Una fila nueva (sin pendings) cae en el
// fallback Activo porque blankRow ya la crea con statusId = ACTIVO.
function effectiveStatusId(row: GridRow): string {
  if (isRowVoided(row)) return VOIDED_STATUS_ID
  if (isRowInactive(row)) return INACTIVE_STATUS_ID
  return ACTIVE_STATUS_ID
}

// Mismas 5 bolsas que arma bulk_save_categorias/bulk_save_monedas en el backend (created/
// updated/voided/restored/inactivated) — un solo lugar para no repetir estos filtros entre
// handleSave (arma el payload) y el contador de cambios pendientes del botón "Guardar
// cambios" (ver pendingChangesCount más abajo), que tienen que coincidir siempre.
function collectPendingChanges(rows: GridRow[]) {
  return {
    created: rows.filter((row) => row.id === null),
    updated: rows.filter(
      (row) => row.id !== null && row.dirty && !row.pendingVoid && !row.pendingInactive && !row.pendingRestore
    ),
    voided: rows.filter((row) => row.pendingVoid && row.id !== null),
    inactivated: rows.filter((row) => row.pendingInactive && row.id !== null),
    restored: rows.filter((row) => row.pendingRestore && row.id !== null),
  }
}

// Celda de tipo "color": un swatch redondo pintado del color + el código hex. Reemplaza el
// truco de Handsontable (armar el DOM a mano con renderToStaticMarkup) por un componente
// React posta — AG Grid lo acepta directo como cellRenderer.
function ColorCellRenderer({ value }: CustomCellRendererProps<GridRow, string>) {
  return (
    <span className="flex h-full items-center gap-1.5">
      <span
        className="size-3.5 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: value || "transparent" }}
      />
      <span className="truncate">{value || "Sin color"}</span>
    </span>
  )
}

// Celda de tipo "icon": el ícono resuelto (vía iconFromKey, la misma lógica que usa el
// sidebar) + el nombre, en vez del string crudo "i-lucide-xxx".
function IconCellRenderer({ value }: CustomCellRendererProps<GridRow, string>) {
  const iconKey = value ?? ""
  const IconComponent = iconFromKey(iconKey)
  return (
    <span className="flex h-full items-center gap-1.5">
      <IconComponent className="size-4 shrink-0" />
      <span className="truncate">{iconKey ? iconKey.replace(UNOCSS_ICON_PREFIX, "") : "Sin ícono"}</span>
    </span>
  )
}

// Columna ESTADO: siempre el status EFECTIVO (ver effectiveStatusId), no `data.status` a
// secas — mientras una acción está pendiente de guardar, `data.status` todavía tiene el
// texto viejo (el registro real en el server no cambió todavía), así que acá se adelanta la
// vista al estado al que va a quedar, en línea con el color que pinta estadoCellClassRules
// más abajo (misma fuente, effectiveStatusId, para que texto y color nunca diverjan).
function EstadoCellRenderer({ data }: CustomCellRendererProps<GridRow, string>) {
  if (!data) return null
  return <>{STATUS_LABEL_BY_ID[effectiveStatusId(data)] ?? data.status}</>
}

// Toda la lógica y el estado de un maestro tipo-planilla: cargar, agregar fila, editar,
// anular, guardar en lote, importar/exportar. Devuelve `toolbar` y `body` por separado
// para que quien lo use pueda ubicarlos en layouts distintos (ver CrudGrid más abajo, que
// simplemente los pone uno después del otro).
export function useCrudGrid<T extends CrudRecord>({
  entityName,
  columns,
  requiredFields,
  emptyFieldValues,
  fromRecord,
  toPayload,
  api,
}: CrudGridProps<T>): CrudGridController {
  const gridApiRef = useRef<GridApi<GridRow> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [rows, setRows] = useState<GridRow[]>([])
  // Última foto tal como vino del servidor: "Descartar cambios" vuelve acá sin pegarle
  // de nuevo al backend (a diferencia de "Refrescar", que sí vuelve a pedir los datos).
  const [savedRows, setSavedRows] = useState<GridRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Celda de color/ícono en la que se hizo click (ver ColorCellRenderer/IconCellRenderer +
  // onCellClicked en hotColumns) — abre el picker correspondiente para esa fila/campo.
  const [activePicker, setActivePicker] = useState<{
    type: "color" | "icon"
    clientId: string
    fieldKey: string
    currentValue: string
  } | null>(null)

  // Menú al click derecho sobre una fila (ver onCellContextMenu más abajo). AG Grid
  // Community no trae menú contextual propio (eso es Enterprise), así que este es uno
  // armado a mano — un popover posicionado en las coordenadas del click, con la única
  // acción que tenía el menú de Handsontable: anular ese registro puntual.
  // `row` decide qué acción mostrar (Anular/Activar, según su propio estado); `targetRows`
  // es sobre qué filas actuar al confirmar — la fila clickeada sola, o toda la selección
  // con checkbox si esa fila formaba parte de una selección de más de una (ver
  // onCellContextMenu, mismo criterio que un right-click sobre una selección múltiple en
  // cualquier gestor de archivos).
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: GridRow; targetRows: GridRow[] } | null>(
    null
  )

  // Fila cuyo historial se está mostrando (ver HistorialDialog) — null cierra el diálogo.
  const [historialRow, setHistorialRow] = useState<GridRow | null>(null)

  // HistorialDialog solo llama a estas dos cuando open=true, momento en el que historialRow
  // ya está seteado (open = historialRow !== null) — el "!" es seguro en ese punto.
  const fetchHistorialForRow = useCallback(() => {
    return api.fetchHistorial!(historialRow!.id as string)
  }, [api, historialRow])
  const fetchHistorialDetalleForRow = useCallback(
    (historialId: string) => {
      return api.fetchHistorialDetalle!(historialRow!.id as string, historialId)
    },
    [api, historialRow]
  )

  const [importOpen, setImportOpen] = useState(false)
  // "idle": recién abierto, esperando que se elija/arrastre un archivo.
  // "validating": analizando (paso 1, api.validateImport) — todavía no se guardó nada.
  // "invalid" / "valid": ya se analizó; "valid" habilita el botón "Importar" (paso 2).
  const [importStage, setImportStage] = useState<"idle" | "validating" | "invalid" | "valid">("idle")
  const [importValidation, setImportValidation] = useState<CrudImportValidation | null>(null)
  // Avance real (fila a fila) durante importStage === "validating" — lo informa
  // api.validateImport vía onProgress, si el módulo lo soporta (ver processImportFile).
  const [importProgress, setImportProgress] = useState<{ processedRows: number; totalRows: number }>({
    processedRows: 0,
    totalRows: 0,
  })
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [importCommitting, setImportCommitting] = useState(false)
  const [importDragOver, setImportDragOver] = useState(false)

  const [statusFilter, setStatusFilter] = useState<CrudStatusFilter>("active")
  // Búsqueda libre por texto, independiente del filtro Activos/Inactivos/Anulados/Todos de
  // arriba — se le pasa tal cual a AG Grid (quickFilterText más abajo), que ya sabe buscar
  // por cualquier columna visible sin que este componente tenga que saber cuáles son.
  const [searchText, setSearchText] = useState("")
  // El campo de texto de la búsqueda no está siempre en pantalla: arranca colapsado en un
  // solo ícono de lupa y se abre al lado al hacer click (ver toolbar más abajo).
  const [searchOpen, setSearchOpen] = useState(false)
  // El campo queda siempre montado (para poder animar su ancho con una transición CSS real
  // en vez de aparecer/desaparecer de golpe — ver toolbar más abajo), así que autoFocus no
  // sirve: hay que enfocarlo a mano cuando se abre.
  const searchInputRef = useRef<HTMLInputElement>(null)

  function openSearch() {
    setSearchOpen(true)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  function closeSearch() {
    setSearchOpen(false)
    setSearchText("")
  }
  // Filas que la grilla termina mostrando después de paginación/quickFilterText — lo informa
  // AG Grid vía onModelUpdated/onGridReady (ver más abajo). Sirve para distinguir "la
  // búsqueda no encontró nada" de "el filtro Activos/Inactivos/Anulados no encontró nada"
  // (ver los overlays de "sin resultados" más abajo).
  const [displayedRowCount, setDisplayedRowCount] = useState(0)

  // Activos/Inactivos/Anulados/Todos se resuelve acá, filtrando `rows` en React — no depende
  // de nada de la grilla, así que el filtro por columna nativo (Estado) queda libre aparte.
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          statusFilter === "all" ||
          (statusFilter === "active" && row.statusId === ACTIVE_STATUS_ID) ||
          (statusFilter === "inactive" && row.statusId === INACTIVE_STATUS_ID) ||
          (statusFilter === "voided" && row.statusId === VOIDED_STATUS_ID)
      ),
    [rows, statusFilter]
  )

  async function loadAll() {
    setLoading(true)
    try {
      const records = await withMinDuration(api.list(), LOADING_MIN_MS)
      const freshRows = records.map((record) => recordToRow(record, fromRecord))
      setRows(freshRows)
      setSavedRows(freshRows.map(cloneRow))
    } catch (err) {
      toastError(err instanceof Error ? err.message : `No se pudieron cargar los/las ${entityName}.`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleDiscardChanges() {
    const hasChanges = rows.some((row) => row.id === null || row.dirty || row.pendingVoid)
    if (!hasChanges) {
      toastError("No hay cambios pendientes para descartar.")
      return
    }
    setRows(savedRows.map(cloneRow))
    toastSuccess("Cambios descartados.")
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await loadAll()
    } finally {
      setRefreshing(false)
    }
  }

  function handleAddRow() {
    setRows((prev) => [...prev, blankRow(emptyFieldValues)])
  }

  function handleClearFilters() {
    gridApiRef.current?.setFilterModel(null)
    setStatusFilter("active")
    closeSearch()
  }

  const onCellValueChanged = useCallback((event: CellValueChangedEvent<GridRow>) => {
    const clientId = event.data.clientId
    setRows((prev) => prev.map((row) => (row.clientId === clientId ? { ...row, dirty: true } : row)))
  }, [])

  const onCellContextMenu = useCallback((event: CellContextMenuEvent<GridRow>) => {
    if (!event.data) return
    const mouseEvent = event.event as MouseEvent | null
    if (!mouseEvent) return
    mouseEvent.preventDefault()
    const row = event.data
    const selected = gridApiRef.current?.getSelectedRows() ?? []
    const targetRows = selected.length > 1 && selected.some((r) => r.clientId === row.clientId) ? selected : [row]
    setContextMenu({ x: mouseEvent.clientX, y: mouseEvent.clientY, row, targetRows })
  }, [])

  // El menú se cierra solo si la página se mueve debajo (quedaría con la posición vieja).
  useEffect(() => {
    if (!contextMenu) return
    function close() {
      setContextMenu(null)
    }
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [contextMenu])

  // Confirmación de ColorPickerDialog/IconPickerDialog (ver activePicker). `fields` se
  // arma de cero para no mutar el objeto que la grilla ya tiene como `rowData` (ver
  // cloneRow más arriba, mismo motivo).
  function updateFieldValue(clientId: string, fieldKey: string, value: string) {
    setRows((prev) =>
      prev.map((row) =>
        row.clientId === clientId ? { ...row, fields: { ...row.fields, [fieldKey]: value }, dirty: true } : row
      )
    )
  }

  // Acción "Anular registro" del menú click-derecho (ver contextMenu más abajo) — targetRows
  // es la fila clickeada sola, o toda la selección con checkbox si esa fila formaba parte
  // de una selección de más de una.
  function voidRows(targetRows: GridRow[]) {
    if (targetRows.length === 0) {
      toastError("Seleccioná al menos una fila.")
      return
    }
    const targetClientIds = new Set(targetRows.map((row) => row.clientId))
    setRows((prev) =>
      prev
        // Una fila nueva (todavía no guardada) no tiene nada que anular en el servidor:
        // se saca directo de la grilla en vez de marcarla.
        .filter((row) => !(targetClientIds.has(row.clientId) && row.id === null))
        .map((row) =>
          targetClientIds.has(row.clientId) && row.id !== null && !isRowVoided(row)
            ? { ...row, pendingVoid: true, pendingInactive: false, dirty: true }
            : row
        )
    )
  }

  // Como voidRows pero a Inactivo en vez de Anulado — "Inactivar registro" del menú
  // click-derecho, solo se ofrece sobre una fila que hoy está Activa (ver el JSX del menú).
  function inactivateRows(targetRows: GridRow[]) {
    if (targetRows.length === 0) {
      toastError("Seleccioná al menos una fila.")
      return
    }
    const targetClientIds = new Set(targetRows.map((row) => row.clientId))
    setRows((prev) =>
      prev
        .filter((row) => !(targetClientIds.has(row.clientId) && row.id === null))
        .map((row) =>
          targetClientIds.has(row.clientId) && row.id !== null && !isRowVoided(row) && !isRowInactive(row)
            ? { ...row, pendingInactive: true, pendingVoid: false, dirty: true }
            : row
        )
    )
  }

  // Inversa de voidRows/inactivateRows: "Activar registro" del menú click-derecho, sobre
  // una fila (o selección) ya Anulada o Inactiva — no distingue cuál de las dos era, las
  // dos vuelven a Activo igual. Si el cambio todavía no se guardó (pendingVoid/
  // pendingInactive), alcanza con destildarlo acá mismo — recién si ya está así en el
  // server hace falta mandar algo a guardar (pendingRestore, ver handleSave).
  function restoreRows(targetRows: GridRow[]) {
    if (targetRows.length === 0) {
      toastError("Seleccioná al menos una fila.")
      return
    }
    const targetClientIds = new Set(targetRows.map((row) => row.clientId))
    setRows((prev) =>
      prev.map((row) => {
        if (!targetClientIds.has(row.clientId)) return row
        if (row.pendingVoid || row.pendingInactive) {
          return { ...row, pendingVoid: false, pendingInactive: false, dirty: false }
        }
        if (row.statusId === VOIDED_STATUS_ID || row.statusId === INACTIVE_STATUS_ID) {
          return { ...row, pendingRestore: true, dirty: true }
        }
        return row
      })
    )
  }

  async function handleSave() {
    const { created: createdRows, updated: updatedRows, voided: voidedRows, inactivated: inactivatedRows, restored: restoredRows } =
      collectPendingChanges(rows)
    const created = createdRows.map((row) => toPayload(row.fields))
    const updated = updatedRows.map((row) => ({ id: row.id as string, ...toPayload(row.fields) }))
    const voided = voidedRows.map((row) => row.id as string)
    const inactivated = inactivatedRows.map((row) => row.id as string)
    const restored = restoredRows.map((row) => row.id as string)

    if (
      created.length === 0 &&
      updated.length === 0 &&
      voided.length === 0 &&
      inactivated.length === 0 &&
      restored.length === 0
    ) {
      toastError("No hay cambios pendientes para guardar.")
      return
    }

    const dirtyRows = rows.filter(
      (row) => row.id === null || (row.dirty && !row.pendingVoid && !row.pendingInactive && !row.pendingRestore)
    )
    const missingRequired = dirtyRows.some((row) => requiredFields.some((field) => !row.fields[field]))
    if (missingRequired) {
      const labels = columns.filter((col) => requiredFields.includes(col.data)).map((col) => `"${col.title}"`)
      toastError(`Completá ${labels.join(" y ")} en todas las filas nuevas o editadas.`)
      return
    }

    setSaving(true)
    try {
      const result = await toastPromise(api.bulkSave({ created, updated, voided, restored, inactivated }), {
        loading: "Guardando cambios…",
        success: "Cambios guardados correctamente.",
        error: (err) => (err instanceof Error ? err.message : "No se pudieron guardar los cambios."),
      })
      const freshRows = result.map((record) => recordToRow(record, fromRecord))
      setRows(freshRows)
      setSavedRows(freshRows.map(cloneRow))
    } catch {
      // el toast ya avisó del error
    } finally {
      setSaving(false)
    }
  }

  // El botón "Importar" de la barra ya no dispara el selector de archivos directo: abre el
  // diálogo (vacío, en estado "idle") y desde ahí el usuario elige o arrastra el archivo.
  function openImportDialog() {
    setImportStage("idle")
    setImportValidation(null)
    setPendingImportFile(null)
    setImportOpen(true)
  }

  // Paso 1: analiza el archivo contra api.validateImport, sin guardar nada todavía. El
  // resultado (preview + errores por celda) se pinta con ImportPreviewGrid.
  async function processImportFile(file: File) {
    if (!api.validateImport) return
    setImportStage("validating")
    setImportProgress({ processedRows: 0, totalRows: 0 })
    try {
      const result = await api.validateImport(file, (processedRows, totalRows) =>
        setImportProgress({ processedRows, totalRows })
      )
      setPendingImportFile(file)
      setImportValidation(result)
      setImportStage(result.errors.length > 0 ? "invalid" : "valid")
    } catch (err) {
      toastError(err instanceof Error ? err.message : "No se pudo analizar el archivo.")
      setImportStage("idle")
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) processImportFile(file)
  }

  function handleImportDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setImportDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) processImportFile(file)
  }

  // Paso 2: recién acá se confirma/guarda, con el mismo archivo ya analizado en el paso 1.
  async function handleConfirmImport() {
    if (!pendingImportFile || !api.commitImport) return
    setImportCommitting(true)
    try {
      const result = await api.commitImport(pendingImportFile)
      toastSuccess(`Se importaron ${result.created_count} registro(s) correctamente.`)
      setImportOpen(false)
      await loadAll()
    } catch (err) {
      toastError(err instanceof Error ? err.message : "No se pudo importar el archivo.")
    } finally {
      setImportCommitting(false)
    }
  }

  async function handleDownloadTemplate() {
    if (!api.downloadTemplate) return
    try {
      await api.downloadTemplate()
    } catch (err) {
      toastError(err instanceof Error ? err.message : "No se pudo descargar la plantilla.")
    }
  }

  async function handleExport() {
    if (!api.export) return
    try {
      await api.export(statusFilter)
    } catch (err) {
      toastError(err instanceof Error ? err.message : "No se pudo exportar.")
    }
  }

  function openFieldPicker(type: "color" | "icon", fieldKey: string, row: GridRow) {
    if (!isRowEditable(row)) return
    setActivePicker({ type, clientId: row.clientId, fieldKey, currentValue: row.fields[fieldKey] ?? "" })
  }

  const getRowId = useCallback((params: GetRowIdParams<GridRow>) => params.data.clientId, [])

  // Fila ya Anulada en el server, o recién marcada para anular (pendingVoid, sin guardar
  // todavía): toda la fila en rojo. Marcada para inactivar: naranja — deliberadamente
  // distinto del celeste de abajo (nueva/restaurar) para no pisarle el significado, y del
  // rojo de Anular (Inactivo no es una baja, es un estado intermedio). Nueva, o marcada para
  // restaurar (pendingRestore, sin guardar): celeste. Editada, pendiente de guardar:
  // amarilla. "!" (Tailwind important) porque el tema de AG Grid trae su propio background
  // de celda, con más especificidad que una clase utilitaria suelta.
  const rowClassRules: RowClassRules<GridRow> = useMemo(
    () => ({
      "!bg-red-100 opacity-80": (params) => params.data?.pendingVoid === true,
      "!bg-orange-100 opacity-80": (params) =>
        params.data?.pendingVoid !== true && params.data?.pendingInactive === true,
      "!bg-blue-50": (params) =>
        params.data?.pendingVoid !== true &&
        params.data?.pendingInactive !== true &&
        (params.data?.id === null || params.data?.pendingRestore === true),
      "!bg-yellow-100": (params) =>
        params.data?.pendingVoid !== true &&
        params.data?.pendingInactive !== true &&
        params.data?.pendingRestore !== true &&
        params.data?.id !== null &&
        params.data?.dirty === true,
    }),
    []
  )

  // Solo en la columna ESTADO: siempre refleja el status EFECTIVO (effectiveStatusId, mismo
  // criterio que ya usaba el texto de EstadoCellRenderer) — no el status crudo del server
  // condicionado a "no dirty, ya guardada". Antes, una fila nueva o con una acción pendiente
  // (anular/inactivar/restaurar) sin guardar todavía se quedaba sin color de fondo en esta
  // celda (solo la fila entera se resaltaba vía rowClassRules), aunque el texto ya adelantara
  // el estado final — de ahí que "Activo" en una fila recién creada, o recién reactivada,
  // no se viera verde hasta después de guardar. Ahora el color sigue al mismo estado
  // "adelantado" que ya mostraba el texto, así nunca pueden divergir entre sí.
  const estadoCellClassRules: CellClassRules<GridRow> = useMemo(
    () => ({
      "text-center uppercase font-medium !bg-green-100 !text-green-800": (params) =>
        !!params.data && effectiveStatusId(params.data) === ACTIVE_STATUS_ID,
      "text-center uppercase font-medium !bg-red-100 !text-red-800": (params) =>
        !!params.data && effectiveStatusId(params.data) === VOIDED_STATUS_ID,
      // Naranja, no gris: un gris (slate) quedaba casi invisible contra el fondo de la
      // grilla, y además el celeste ya significa "nueva/restaurar" (ver rowClassRules) — el
      // naranja lo deja claramente distinguible de los otros tres estados (verde/rojo/celeste).
      "text-center uppercase font-medium !bg-orange-100 !text-orange-800": (params) =>
        !!params.data && effectiveStatusId(params.data) === INACTIVE_STATUS_ID,
    }),
    []
  )

  const columnDefs: ColDef<GridRow>[] = useMemo(
    () => [
      {
        headerName: "1",
        pinned: "left",
        // Tres cosas hacen falta para que esta columna quede angosta en vez de terminar
        // tan ancha como cualquier otra: flex:0 (si no, el flex:1 de defaultColDef la hace
        // crecer), y minWidth acá (si no, se queda con el minWidth:120 de defaultColDef,
        // que le gana al width de acá como piso mínimo).
        width: 48,
        minWidth: 48,
        flex: 0,
        resizable: false,
        sortable: false,
        filter: false,
        editable: false,
        valueGetter: (params) => (params.node?.rowIndex ?? 0) + 2,
        cellClass: "text-muted-foreground",
      },
      ...columns.map((col): ColDef<GridRow> => {
        if (col.type === "color" || col.type === "icon") {
          return {
            field: `fields.${col.data}`,
            headerName: col.title,
            editable: false,
            filter: "agTextColumnFilter",
            cellRenderer: col.type === "color" ? ColorCellRenderer : IconCellRenderer,
            cellClass: (params) => (isRowEditable(params.data) ? "cursor-pointer" : ""),
            onCellClicked: (params) => {
              if (params.data) openFieldPicker(col.type as "color" | "icon", col.data, params.data)
            },
          }
        }
        return {
          field: `fields.${col.data}`,
          headerName: col.title,
          editable: (params) => isRowEditable(params.data),
          // Sin floatingFilter: esa fila fija de inputs debajo del encabezado se veía
          // como una fila de datos vacía (sin número, sin nada) — el filtro se sigue
          // pudiendo usar igual, desde el ícono ▼ del propio encabezado de columna.
          filter: "agTextColumnFilter",
          // Sin checkboxSelection acá: rowSelection={{mode: "multiRow"}} ya agrega su
          // propia columna dedicada de checkboxes — ponerlo también acá duplicaba el
          // checkbox (uno en esa columna + otro pisado sobre NOMBRES).
          ...(col.type === "dropdown"
            ? { cellEditor: "agSelectCellEditor", cellEditorParams: { values: col.source ?? [] } }
            : {}),
        }
      }),
      {
        headerName: "ESTADO",
        editable: false,
        filter: false,
        cellRenderer: EstadoCellRenderer,
        cellClassRules: estadoCellClassRules,
      },
    ],
    [columns, estadoCellClassRules]
  )

  const defaultColDef: ColDef<GridRow> = useMemo(
    () => ({
      resizable: true,
      flex: 1,
      minWidth: 120,
      // AG Grid deja el título del encabezado alineado a la izquierda por default; acá se
      // centra vía la clase interna .ag-header-cell-label (no hay un param de theme para
      // esto, solo alineación de texto de celda).
      headerClass: "[&_.ag-header-cell-label]:justify-center",
    }),
    []
  )

  // Total de filas que "Guardar cambios" mandaría ahora mismo (nuevas + editadas + a anular
  // + a inactivar + a restaurar) — mismas 5 bolsas que arma handleSave, ver
  // collectPendingChanges. Alimenta el badge del botón de Guardar (más abajo).
  const pendingChanges = collectPendingChanges(rows)
  const pendingChangesCount =
    pendingChanges.created.length +
    pendingChanges.updated.length +
    pendingChanges.voided.length +
    pendingChanges.inactivated.length +
    pendingChanges.restored.length

  // Agregar fila, filtro de estado, Guardar y Refrescar se usan seguido y quedan siempre
  // visibles. Descartar cambios/Limpiar filtro/Importar/Descargar plantilla/Exportar se usan
  // poco: normalmente sueltas, pero al abrir la búsqueda (que necesita su lugar al lado de la
  // lupa) se contraen en cascada y se juntan en el menú "⋯" para no competir por espacio —
  // ver secondaryActions y su render más abajo, cerca del final.
  const secondaryActions = [
    { key: "discard", show: true, icon: <Undo2Icon className="text-amber-600" />, label: "Descartar cambios", onClick: handleDiscardChanges },
    { key: "clear", show: true, icon: <EraserIcon className="text-slate-500" />, label: "Limpiar filtro", onClick: handleClearFilters },
    { key: "import", show: Boolean(api.validateImport), icon: <UploadIcon className="text-violet-600" />, label: "Importar", onClick: openImportDialog },
    { key: "template", show: Boolean(api.downloadTemplate), icon: <FileDownIcon className="text-indigo-600" />, label: "Descargar plantilla", onClick: handleDownloadTemplate },
    { key: "export", show: Boolean(api.export), icon: <FileSpreadsheetIcon className="text-emerald-600" />, label: "Exportar datos", onClick: handleExport },
  ].filter((action) => action.show)

  const toolbar = (
    <div className="flex shrink-0 items-center gap-1.5 [&>*]:shrink-0">
      {/* Búsqueda libre, aparte del filtro Activos/Inactivos/Anulados/Todos de más abajo:
          busca por texto en cualquier columna visible (ver quickFilterText en AgGridReact),
          no por status. El ícono de lupa queda siempre fijo a la izquierda; el campo queda
          siempre montado (nunca aparece/desaparece de golpe) y su contenedor anima el ancho
          con transition — crece de 0 hacia su ancho final empujando en tiempo real, despacio,
          al resto de los íconos hacia la derecha (reflow real del flex, no una animación de
          mentira). */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={searchOpen ? "default" : "outline"}
              size="icon-sm"
              className="ml-3"
              onClick={() => (searchOpen ? closeSearch() : openSearch())}
            />
          }
        >
          <SearchIcon className={searchOpen ? undefined : "text-slate-600"} />
        </TooltipTrigger>
        <TooltipContent>Buscar</TooltipContent>
      </Tooltip>
      <div
        className={`overflow-hidden transition-[width] duration-500 ease-in-out ${searchOpen ? "w-32 sm:w-40" : "w-0"}`}
      >
        <div
          className={`relative w-32 sm:w-40 transition-opacity duration-300 ${searchOpen ? "opacity-100 delay-150" : "opacity-0"}`}
        >
          <Input
            ref={searchInputRef}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeSearch()
            }}
            placeholder="Buscar…"
            aria-label="Buscar registro"
            tabIndex={searchOpen ? 0 : -1}
            className="h-7 w-full rounded-[min(var(--radius-md),12px)] border-border bg-background pr-7 text-sm shadow-none"
          />
          {searchText && (
            <button
              type="button"
              onClick={() => setSearchText("")}
              aria-label="Limpiar búsqueda"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {/* Agregar fila, filtro de estado, Guardar y Refrescar: se usan tanto o más que la
          búsqueda, así que quedan siempre visibles, se esté buscando o no — nunca se
          esconden ni se mudan al menú "⋯". */}
      <Separator orientation="vertical" className="h-6" />
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="icon-sm" onClick={handleAddRow} />}>
          <PlusIcon className="text-blue-600" />
        </TooltipTrigger>
        <TooltipContent>Agregar fila</TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="h-6" />
      {/* Filtro Activos/Inactivos/Anulados: filtra `rows` por statusId en React (ver
          visibleRows más arriba), no toca el filtro nativo por columna de la grilla. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              size="icon-sm"
              onClick={() => setStatusFilter("all")}
            />
          }
        >
          <ListIcon className={statusFilter === "all" ? undefined : "text-slate-600"} />
        </TooltipTrigger>
        <TooltipContent>Ver todos</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={statusFilter === "active" ? "default" : "outline"}
              size="icon-sm"
              onClick={() => setStatusFilter("active")}
            />
          }
        >
          <CircleCheckIcon className={statusFilter === "active" ? undefined : "text-green-600"} />
        </TooltipTrigger>
        <TooltipContent>Ver activos</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={statusFilter === "inactive" ? "default" : "outline"}
              size="icon-sm"
              onClick={() => setStatusFilter("inactive")}
            />
          }
        >
          <CircleDashedIcon className={statusFilter === "inactive" ? undefined : "text-orange-600"} />
        </TooltipTrigger>
        <TooltipContent>Ver inactivos</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={statusFilter === "voided" ? "default" : "outline"}
              size="icon-sm"
              onClick={() => setStatusFilter("voided")}
            />
          }
        >
          <BanIcon className={statusFilter === "voided" ? undefined : "text-red-600"} />
        </TooltipTrigger>
        <TooltipContent>Ver anulados</TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="h-6" />
      {/* relative + badge absoluto: mismo patrón que un contador de notificaciones, para que
          el usuario vea de un vistazo cuántos cambios se mandarían sin tener que mirar la
          fila de contadores aparte (ver pendingChangesCount más arriba). Oculto en 0 — no
          tiene sentido un badge avisando "nada para guardar". */}
      <div className="relative inline-flex">
        <Tooltip>
          <TooltipTrigger render={<Button size="icon-sm" onClick={handleSave} disabled={saving} />}>
            <SaveIcon />
          </TooltipTrigger>
          <TooltipContent>Guardar cambios</TooltipContent>
        </Tooltip>
        {pendingChangesCount > 0 && (
          <span className="pointer-events-none absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-amber-600 text-[10px] font-semibold text-white">
            {pendingChangesCount > 99 ? "99+" : pendingChangesCount}
          </span>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="icon-sm" onClick={handleRefresh} disabled={refreshing} />}>
          <RefreshCwIcon className={refreshing ? "animate-spin text-sky-600" : "text-sky-600"} />
        </TooltipTrigger>
        <TooltipContent>Refrescar</TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="h-6" />
      {/* Descartar cambios, Limpiar filtro, Importar/Descargar plantilla/Exportar: estas sí
          se usan poco, así que se agrupan en el menú "⋯" mientras hay que hacerle lugar al
          campo de búsqueda. Ambos grupos quedan siempre montados (igual que el campo de
          búsqueda más arriba) y solo animan ancho + opacidad — así el swap no es instantáneo:
          cada botón se contrae en cascada (stagger por índice vía *_DELAYS) y recién cuando
          termina el último aparece el "⋯"; al cerrar la búsqueda es al revés, el "⋯" se
          esconde de una y los botones se despliegan en cascada. */}
      {secondaryActions.map((action, index) => (
        <div
          key={action.key}
          // -mr-1.5 cancela el gap-1.5 del toolbar cuando el botón está colapsado (w-0): sin
          // esto, el `gap` del flex sigue metiendo su espacio entre cada botón invisible y el
          // siguiente, dejando un hueco vacío entre el separador y el "⋯" aunque no haya
          // nada ahí en el medio.
          className={`overflow-hidden transition-[width,margin-right] duration-300 ease-in-out ${
            searchOpen ? `w-0 -mr-1.5 ${HIDE_DELAYS[index]}` : `w-7 mr-0 ${SHOW_DELAYS[index]}`
          }`}
        >
          <div
            className={`transition-opacity duration-200 ${
              searchOpen ? `opacity-0 ${HIDE_DELAYS[index]}` : `opacity-100 ${SHOW_DELAYS[index]}`
            }`}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    tabIndex={searchOpen ? -1 : 0}
                    onClick={action.onClick}
                  />
                }
              >
                {action.icon}
              </TooltipTrigger>
              <TooltipContent>{action.label}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      ))}
      <div
        // Mismo motivo que -mr-1.5 en secondaryActions más arriba: cancela el gap-1.5 del
        // toolbar mientras el "⋯" está colapsado (w-0), para que no deje un hueco fantasma
        // entre el separador y el campo de búsqueda cuando los botones sueltos están visibles.
        className={`overflow-hidden transition-[width,margin-right] duration-300 ease-in-out ${searchOpen ? "w-7 mr-0 delay-[500ms]" : "w-0 -mr-1.5 delay-0"}`}
      >
        <div className={`transition-opacity duration-200 ${searchOpen ? "opacity-100 delay-[550ms]" : "opacity-0 delay-0"}`}>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" tabIndex={searchOpen ? 0 : -1} />}>
              <EllipsisIcon className="text-slate-600" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-48">
              {secondaryActions.map((action) => (
                <DropdownMenuItem key={action.key} onClick={action.onClick}>
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/* Fuera del if/else de arriba: el file input tiene que seguir montado aunque la
          búsqueda esté abierta (el diálogo de importación puede seguir abierto de una
          apertura anterior y su "Elegir archivo" dispara este ref). */}
      {api.validateImport && (
        <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileInputChange} />
      )}
    </div>
  )

  // 0 mientras no se sepa el total todavía (justo al arrancar el job) — la barra empieza
  // vacía en vez de saltar a un % engañoso.
  const importProgressPercent =
    importProgress.totalRows > 0
      ? Math.min(100, Math.round((importProgress.processedRows / importProgress.totalRows) * 100))
      : 0

  // Activas: filas ya guardadas (id !== null) cuyo estado actual es "Activo" y que no
  // están pendientes de anular ni de inactivar. No cuenta filas nuevas todavía sin guardar.
  const activeExistingCount = rows.filter(
    (row) => row.id !== null && !row.pendingVoid && !row.pendingInactive && row.statusId === ACTIVE_STATUS_ID
  ).length
  // Modificadas: filas ya guardadas con una edición pendiente, todavía sin confirmar con
  // "Guardar cambios" (no cuenta las marcadas para anular/inactivar — esas van aparte, en
  // anuladas/inactivas).
  const modifiedCount = rows.filter(
    (row) => row.id !== null && row.dirty && !row.pendingVoid && !row.pendingInactive
  ).length
  // Inactivas: tanto las ya Inactivas en el server como las recién marcadas para inactivar
  // sin guardar todavía (pendingInactive) — mismo criterio que isRowInactive.
  const inactiveCount = rows.filter((row) => row.id !== null && isRowInactive(row)).length
  // Anuladas: tanto las ya Anuladas en el server como las recién marcadas para anular sin
  // guardar todavía (pendingVoid) — mismo criterio que isRowVoided, que además excluye las
  // que están con una restauración pendiente (pendingRestore) aunque el server todavía
  // diga Anulado.
  const voidedCount = rows.filter((row) => row.id !== null && isRowVoided(row)).length
  // Nuevas: filas agregadas con "Agregar fila" que todavía no existen en el servidor.
  const newCount = rows.filter((row) => row.id === null).length

  // Siempre una sola fila (nunca grilla ni wrap): en pantallas chicas queda angosta y, junto
  // con el toolbar, entra en la franja con scroll horizontal que arma AppLayout — así el
  // conjunto contadores + íconos se ve como una sola línea en cualquier pantalla, en vez de
  // partirse en dos.
  const counters = (
    <div className="flex shrink-0 items-center gap-2 text-xs whitespace-nowrap text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <CircleCheckIcon className="size-3.5 text-green-600" />
        <span className="font-medium text-foreground">{activeExistingCount}</span>
        activas
      </span>
      <span className="inline-flex items-center gap-1">
        <PencilLineIcon className="size-3.5 text-amber-600" />
        <span className="font-medium text-foreground">{modifiedCount}</span>
        modificadas
      </span>
      <span className="inline-flex items-center gap-1">
        <CircleDashedIcon className="size-3.5 text-orange-600" />
        <span className="font-medium text-foreground">{inactiveCount}</span>
        inactivas
      </span>
      <span className="inline-flex items-center gap-1">
        <BanIcon className="size-3.5 text-red-600" />
        <span className="font-medium text-foreground">{voidedCount}</span>
        anuladas
      </span>
      <Separator orientation="vertical" className="h-3.5" />
      <span className="inline-flex items-center gap-1">
        <PlusIcon className="size-3.5 text-blue-600" />
        <span className="font-medium text-foreground">{newCount}</span>
        nuevas
      </span>
    </div>
  )

  const body = (
    <>
      <div className="relative min-w-0 rounded-md border">
        {/* onContextMenu acá (nivel React, no el evento interno de AG Grid) para que el
            menú nativo del navegador ("Inspeccionar", etc.) no aparezca superpuesto al
            propio de la grilla — llamar preventDefault solo dentro de onCellContextMenu no
            alcanzaba, el navegador igual mostraba el suyo por encima. */}
        <div style={{ height: 480 }} onContextMenu={(event) => event.preventDefault()}>
          <AgGridReact<GridRow>
            theme={gridTheme}
            rowData={visibleRows}
            quickFilterText={searchText}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={getRowId}
            rowClassRules={rowClassRules}
            rowSelection={{ mode: "multiRow" }}
            pagination
            paginationPageSize={10}
            paginationPageSizeSelector={[10, 15, 20]}
            onCellValueChanged={onCellValueChanged}
            onCellContextMenu={onCellContextMenu}
            // Vacío: el estado sin filas lo maneja el overlay de acá abajo (mismo lugar
            // para "todavía no hay ninguna" y "ninguna coincide con el filtro"), en vez
            // del "No rows to show" que trae AG Grid por default.
            overlayNoRowsTemplate="<span></span>"
            // Se dispara con cualquier cambio en lo que la grilla termina mostrando —
            // incluida la búsqueda (quickFilterText) — así el overlay de "sin resultados"
            // de acá abajo sabe cuándo la búsqueda no encontró nada, sin duplicar en React
            // la lógica de qué campos busca AG Grid.
            onModelUpdated={(params) => setDisplayedRowCount(params.api.getDisplayedRowCount())}
            onGridReady={(params) => {
              gridApiRef.current = params.api
              setDisplayedRowCount(params.api.getDisplayedRowCount())
            }}
          />
        </div>
        {contextMenu && (
          <div
            className="fixed inset-0 z-50"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setContextMenu(null)
            }}
          >
            <div
              className="absolute min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              {/* Una fila anulada o inactiva no se puede volver a anular/inactivar, solo
                  activar — y una activa no se puede "activar" de nuevo, solo anular o
                  inactivar. El menú muestra solo las acciones que corresponden según
                  isRowVoided/isRowInactive de la fila clickeada. Si esa fila era parte de
                  una selección de más de una, targetRows trae toda la selección y el texto
                  pasa a plural. */}
              {isRowVoided(contextMenu.row) || isRowInactive(contextMenu.row) ? (
                <button
                  type="button"
                  onClick={() => {
                    restoreRows(contextMenu.targetRows)
                    setContextMenu(null)
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-green-600 hover:bg-accent"
                >
                  <RotateCcwIcon className="size-4" />
                  {contextMenu.targetRows.length > 1 ? "Activar registros" : "Activar registro"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!isRowEditable(contextMenu.row)}
                    onClick={() => {
                      inactivateRows(contextMenu.targetRows)
                      setContextMenu(null)
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-orange-600 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                  >
                    <CircleDashedIcon className="size-4" />
                    {contextMenu.targetRows.length > 1 ? "Inactivar registros" : "Inactivar registro"}
                  </button>
                  <button
                    type="button"
                    disabled={!isRowEditable(contextMenu.row)}
                    onClick={() => {
                      voidRows(contextMenu.targetRows)
                      setContextMenu(null)
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-red-600 hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                  >
                    <XCircleIcon className="size-4" />
                    {contextMenu.targetRows.length > 1 ? "Anular registros" : "Anular registro"}
                  </button>
                </>
              )}
              {/* Historial es por registro puntual (no por selección, aunque se haya
                  clickeado con varias filas tildadas) y solo tiene sentido para una fila ya
                  guardada — una fila nueva todavía no tiene nada en el historial. */}
              {api.fetchHistorial && contextMenu.row.id !== null && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <button
                    type="button"
                    onClick={() => {
                      setHistorialRow(contextMenu.row)
                      setContextMenu(null)
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent"
                  >
                    <HistoryIcon className="size-4" />
                    Historial
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {(loading || refreshing) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground backdrop-blur-[1px]">
            <Loader2Icon className="size-5 animate-spin" />
            Cargando {entityName}…
          </div>
        )}
        {/* Vacío por completo (nunca se cargó nada) vs. vacío por el filtro Activos/
            Anulados (hay filas, pero ninguna con ese status) — dos mensajes distintos,
            evaluado contra visibleRows (lo que la grilla muestra), no contra rows (todo). */}
        {!loading && !refreshing && visibleRows.length === 0 && rows.length === 0 && (
          <div className="pointer-events-none absolute inset-0 top-9 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <PackageOpenIcon className="size-7 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">Todavía no hay {entityName}</p>
              <p className="text-xs text-muted-foreground">
                Usá <span className="font-medium text-foreground">"Agregar fila"</span> para crear la primera.
              </p>
            </div>
          </div>
        )}
        {!loading && !refreshing && visibleRows.length === 0 && rows.length > 0 && (
          <div className="pointer-events-none absolute inset-0 top-9 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <SearchXIcon className="size-7 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                No hay {entityName}{" "}
                {statusFilter === "voided" ? "anuladas" : statusFilter === "inactive" ? "inactivas" : "activas"}
              </p>
              <p className="text-xs text-muted-foreground">Probá con otro filtro de estado, arriba en la barra.</p>
            </div>
          </div>
        )}
        {/* Hay filas para el filtro de estado actual, pero la búsqueda (quickFilterText) no
            encontró ninguna — mensaje aparte del de arriba, para no confundir "no hay
            activas" con "ninguna activa coincide con lo que buscaste". */}
        {!loading && !refreshing && visibleRows.length > 0 && displayedRowCount === 0 && searchText.trim() !== "" && (
          <div className="pointer-events-none absolute inset-0 top-9 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <SearchXIcon className="size-7 text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">Ningún resultado para "{searchText.trim()}"</p>
              <p className="text-xs text-muted-foreground">Probá con otra búsqueda, o borrala con la ✕ del campo.</p>
            </div>
          </div>
        )}
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Importar {entityName}</DialogTitle>
            <DialogDescription>
              Subí tu archivo Excel (o la plantilla del modelo) para analizarlo. Si hay errores se muestran acá antes
              de importar nada.
            </DialogDescription>
          </DialogHeader>

          {importStage === "idle" && (
            <div
              onDragOver={(event) => {
                event.preventDefault()
                setImportDragOver(true)
              }}
              onDragLeave={() => setImportDragOver(false)}
              onDrop={handleImportDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed p-10 text-center transition-colors ${
                importDragOver ? "border-primary bg-accent" : "border-input"
              }`}
            >
              <UploadIcon className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Arrastrá acá tu archivo .xlsx, o hacé click para elegirlo.
              </p>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                Elegir archivo
              </Button>
            </div>
          )}

          {importStage === "validating" && (
            <div className="flex flex-col items-center justify-center gap-4 p-10">
              <div className="w-full max-w-sm">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Analizando archivo…</span>
                  <span className="font-medium tabular-nums text-foreground">{importProgressPercent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                    style={{ width: `${importProgressPercent}%` }}
                  />
                </div>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {importProgress.totalRows > 0
                    ? `Fila ${importProgress.processedRows} de ${importProgress.totalRows}`
                    : "Empezando…"}
                </p>
              </div>
            </div>
          )}

          {(importStage === "invalid" || importStage === "valid") && importValidation && (
            <div className="flex flex-col gap-3">
              {importStage === "valid" ? (
                <p className="flex items-center gap-2 text-sm text-green-700">
                  <CircleCheckIcon className="size-4" />
                  El archivo es válido: {importValidation.rows.length} registro(s) listo(s) para importar.
                </p>
              ) : (
                <p className="flex items-center gap-2 text-sm text-destructive">
                  <CircleXIcon className="size-4" />
                  Se encontr{importValidation.errors.length === 1 ? "ó" : "aron"} {importValidation.errors.length}{" "}
                  error{importValidation.errors.length === 1 ? "" : "es"} — el detalle está debajo del valor, en
                  cada celda en rojo.
                </p>
              )}
              <ImportPreviewGrid columns={columns} rows={importValidation.rows} errors={importValidation.errors} />
            </div>
          )}

          <DialogFooter>
            {(importStage === "invalid" || importStage === "valid") && (
              <Button variant="outline" onClick={openImportDialog}>
                Elegir otro archivo
              </Button>
            )}
            {importStage === "valid" && (
              <Button onClick={handleConfirmImport} disabled={importCommitting}>
                Importar
              </Button>
            )}
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ColorPickerDialog
        open={activePicker?.type === "color"}
        value={activePicker?.currentValue ?? ""}
        onOpenChange={(open) => {
          if (!open) setActivePicker(null)
        }}
        onSelect={(value) => {
          if (activePicker) updateFieldValue(activePicker.clientId, activePicker.fieldKey, value)
        }}
      />
      <IconPickerDialog
        open={activePicker?.type === "icon"}
        value={activePicker?.currentValue ?? ""}
        onOpenChange={(open) => {
          if (!open) setActivePicker(null)
        }}
        onSelect={(value) => {
          if (activePicker) updateFieldValue(activePicker.clientId, activePicker.fieldKey, value)
        }}
      />
      {api.fetchHistorial && (
        <HistorialDialog
          open={historialRow !== null}
          onOpenChange={(open) => {
            if (!open) setHistorialRow(null)
          }}
          // La primera columna suele ser la que identifica la fila para el usuario (p.ej.
          // NOMBRES en categorías) — no hay un campo "nombre" genérico en CrudColumn.
          recordLabel={(historialRow && columns[0] && historialRow.fields[columns[0].data]) || entityName}
          fetchHistorial={fetchHistorialForRow}
          fetchDetalle={fetchHistorialDetalleForRow}
        />
      )}
    </>
  )

  return { toolbar, counters, body }
}

// Wrapper de conveniencia para cuando no hace falta separar la barra del breadcrumb (ver
// useCrudGrid si necesitás ubicarlos en layouts distintos, como hace CategoriasPage).
export function CrudGrid<T extends CrudRecord>(props: CrudGridProps<T>) {
  const { toolbar, counters, body } = useCrudGrid(props)
  return (
    <>
      {toolbar}
      {counters}
      {body}
    </>
  )
}
