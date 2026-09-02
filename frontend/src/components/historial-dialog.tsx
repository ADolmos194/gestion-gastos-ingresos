import { useCallback, useEffect, useMemo, useState } from "react"
import { AgGridReact } from "ag-grid-react"
import type { CustomCellRendererProps } from "ag-grid-react"
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community"
import { ArrowLeftIcon, EyeIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toastError } from "@/lib/toast"

// Ídem crud-grid.tsx/import-preview-grid.tsx: registrar los módulos acá también, por si
// este componente se termina usando en algún lugar que no pase primero por esos archivos.
ModuleRegistry.registerModules([AllCommunityModule])

const gridTheme = themeQuartz

export interface HistorialEntry {
  id: string
  evento: string
  modulo: string
  nom_tabla: string
  usuario: string | null
  fecha_hora: string
}

export interface HistorialDetalleEntry {
  id: string
  columna: string
  dato_antiguo: string | null
  dato_nuevo: string | null
}

// Nombres tal como los guarda cada vista al llamar registrar_creacion/registrar_actualizacion
// (ver apps.historial.services) — "delete" es anular (nunca se borra nada de verdad) y
// "import" cubre tanto lo creado como lo reactivado al importar un Excel.
const EVENTO_LABELS: Record<string, string> = {
  create: "Creación",
  update: "Edición",
  delete: "Anulación",
  import: "Importación",
}

function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
}

// Mismo criterio que import-preview-grid.tsx: en vez de recortar o hacer wrap, el ancho de
// cada columna se calcula según el texto más largo que va a mostrar (encabezado incluido),
// así el contenido entra siempre en una sola línea sin cortarse.
const CHAR_WIDTH_PX = 7.5
const CELL_PADDING_PX = 32
const MIN_COLUMN_WIDTH_PX = 110
const MAX_COLUMN_WIDTH_PX = 420

function estimateColumnWidth(headerTitle: string, texts: string[]): number {
  const longest = texts.reduce((max, text) => Math.max(max, text.length), headerTitle.length)
  const estimated = Math.round(longest * CHAR_WIDTH_PX) + CELL_PADDING_PX
  return Math.min(MAX_COLUMN_WIDTH_PX, Math.max(MIN_COLUMN_WIDTH_PX, estimated))
}

interface HistorialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Para el título — p.ej. el nombre de la categoría a la que pertenece este historial.
  recordLabel: string
  fetchHistorial: () => Promise<HistorialEntry[]>
  fetchDetalle: (historialId: string) => Promise<HistorialDetalleEntry[]>
}

// Auditoría de un registro puntual: quién hizo qué y cuándo (lista, vía fetchHistorial), y
// un botón "Detalle" por fila que muestra columna por columna qué valor tenía antes y cuál
// después (vía fetchDetalle) — mismo diálogo, solo cambia qué grilla AG Grid muestra adentro.
export function HistorialDialog({ open, onOpenChange, recordLabel, fetchHistorial, fetchDetalle }: HistorialDialogProps) {
  const [loading, setLoading] = useState(false)
  const [entries, setEntries] = useState<HistorialEntry[]>([])
  const [selected, setSelected] = useState<HistorialEntry | null>(null)
  const [detalleLoading, setDetalleLoading] = useState(false)
  const [detalle, setDetalle] = useState<HistorialDetalleEntry[]>([])

  useEffect(() => {
    if (!open) return
    setSelected(null)
    setLoading(true)
    fetchHistorial()
      .then(setEntries)
      .catch((err) => toastError(err instanceof Error ? err.message : "No se pudo cargar el historial."))
      .finally(() => setLoading(false))
  }, [open, fetchHistorial])

  // useCallback (no una función suelta): entra como dependencia del useMemo de columnDefs
  // de abajo — sin esto, el cellRenderer del botón "Detalle" quedaba con la primera
  // referencia de fetchDetalle para siempre (columnDefs nunca se recalculaba), así que al
  // reabrir el diálogo sobre OTRA fila el botón seguía pidiendo el historial de la fila
  // vieja.
  const openDetalle = useCallback(
    (entry: HistorialEntry) => {
      setSelected(entry)
      setDetalleLoading(true)
      fetchDetalle(entry.id)
        .then(setDetalle)
        .catch((err) => toastError(err instanceof Error ? err.message : "No se pudo cargar el detalle."))
        .finally(() => setDetalleLoading(false))
    },
    [fetchDetalle]
  )

  const columnDefs: ColDef<HistorialEntry>[] = useMemo(() => {
    const eventoTexts = entries.map((e) => EVENTO_LABELS[e.evento] ?? e.evento)
    const moduloTexts = entries.map((e) => e.modulo)
    const tablaTexts = entries.map((e) => e.nom_tabla)
    const usuarioTexts = entries.map((e) => e.usuario || "—")
    const fechaTexts = entries.map((e) => formatFechaHora(e.fecha_hora))
    return [
      {
        field: "evento",
        headerName: "Evento",
        width: estimateColumnWidth("Evento", eventoTexts),
        valueFormatter: (params) => (params.value ? (EVENTO_LABELS[params.value] ?? params.value) : ""),
      },
      { field: "modulo", headerName: "Módulo", width: estimateColumnWidth("Módulo", moduloTexts) },
      { field: "nom_tabla", headerName: "Tabla", width: estimateColumnWidth("Tabla", tablaTexts) },
      {
        field: "usuario",
        headerName: "Usuario",
        width: estimateColumnWidth("Usuario", usuarioTexts),
        valueFormatter: (params) => params.value || "—",
      },
      {
        field: "fecha_hora",
        headerName: "Fecha/Hora",
        width: estimateColumnWidth("Fecha/Hora", fechaTexts),
        valueFormatter: (params) => (params.value ? formatFechaHora(params.value) : ""),
      },
      {
        headerName: "",
        pinned: "right",
        width: 64,
        minWidth: 64,
        flex: 0,
        sortable: false,
        filter: false,
        cellRenderer: (params: CustomCellRendererProps<HistorialEntry>) =>
          params.data ? (
            <div className="flex h-full items-center justify-center">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      onClick={() => openDetalle(params.data as HistorialEntry)}
                    />
                  }
                >
                  <EyeIcon className="size-4" />
                </TooltipTrigger>
                <TooltipContent>Detalle</TooltipContent>
              </Tooltip>
            </div>
          ) : null,
      },
    ]
  }, [entries, openDetalle])

  const detalleColumnDefs: ColDef<HistorialDetalleEntry>[] = useMemo(() => {
    const columnaTexts = detalle.map((d) => d.columna)
    const antiguoTexts = detalle.map((d) => d.dato_antiguo || "—")
    const nuevoTexts = detalle.map((d) => d.dato_nuevo || "—")
    return [
      { field: "columna", headerName: "Columna", width: estimateColumnWidth("Columna", columnaTexts) },
      {
        field: "dato_antiguo",
        headerName: "Dato antiguo",
        width: estimateColumnWidth("Dato antiguo", antiguoTexts),
        flex: 1,
        valueFormatter: (params) => params.value || "—",
      },
      {
        field: "dato_nuevo",
        headerName: "Dato nuevo",
        width: estimateColumnWidth("Dato nuevo", nuevoTexts),
        flex: 1,
        valueFormatter: (params) => params.value || "—",
      },
    ]
  }, [detalle])

  const defaultColDef: ColDef = useMemo(
    () => ({ resizable: true, headerClass: "[&_.ag-header-cell-label]:justify-center" }),
    []
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selected && (
              <Button variant="ghost" size="icon" className="size-7 -ml-1.5" onClick={() => setSelected(null)}>
                <ArrowLeftIcon className="size-4" />
              </Button>
            )}
            {selected ? `Detalle — ${EVENTO_LABELS[selected.evento] ?? selected.evento}` : `Historial de ${recordLabel}`}
          </DialogTitle>
          <DialogDescription>
            {selected
              ? "Qué valor tenía cada campo antes de este evento, y cuál quedó después."
              : "Quién hizo qué y cuándo sobre este registro."}
          </DialogDescription>
        </DialogHeader>

        {!selected && (
          // Sin altura fija: domLayout="autoHeight" hace que la grilla crezca según el
          // contenido real (wrapText/autoHeight en las columnas largas hacen lo mismo por
          // fila) — así ninguna celda queda cortada. min-h para que el spinner/mensaje de
          // vacío de abajo tengan dónde centrarse mientras no hay filas todavía.
          <div className="relative min-w-0 overflow-auto rounded-md border" style={{ minHeight: 160 }}>
            <AgGridReact<HistorialEntry>
              theme={gridTheme}
              rowData={entries}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              getRowId={(params) => params.data.id}
              domLayout="autoHeight"
              pagination
              paginationPageSize={10}
              paginationPageSizeSelector={false}
            />
            {loading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground backdrop-blur-[1px]">
                <Loader2Icon className="size-5 animate-spin" />
                Cargando historial…
              </div>
            )}
            {!loading && entries.length === 0 && (
              <div className="pointer-events-none absolute inset-0 top-9 flex items-center justify-center text-sm text-muted-foreground">
                Todavía no hay historial para este registro.
              </div>
            )}
          </div>
        )}

        {selected && (
          <div className="relative min-w-0 overflow-auto rounded-md border" style={{ minHeight: 120 }}>
            <AgGridReact<HistorialDetalleEntry>
              theme={gridTheme}
              rowData={detalle}
              columnDefs={detalleColumnDefs}
              defaultColDef={defaultColDef}
              getRowId={(params) => params.data.id}
              domLayout="autoHeight"
              pagination
              paginationPageSize={10}
              paginationPageSizeSelector={false}
            />
            {detalleLoading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground backdrop-blur-[1px]">
                <Loader2Icon className="size-5 animate-spin" />
                Cargando detalle…
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
