import { useMemo } from "react"
import { AgGridReact } from "ag-grid-react"
import type { CustomCellRendererProps } from "ag-grid-react"
import { AllCommunityModule, ModuleRegistry, themeQuartz, type CellClassRules, type ColDef } from "ag-grid-community"

import type { CrudColumn } from "@/components/crud-grid"

// Ídem crud-grid.tsx: registrar los módulos acá también, por si este componente se termina
// usando en algún lugar que no pase primero por ese archivo (llamar registerModules más de
// una vez es inofensivo).
ModuleRegistry.registerModules([AllCommunityModule])

const gridTheme = themeQuartz

// Ancho aproximado por caracter (px) al tamaño de fuente que usa la grilla, más el padding
// horizontal de la celda — no es exacto (fuente no es monoespaciada) pero alcanza para que
// la columna no le quede chica al texto más largo que va a mostrar.
const CHAR_WIDTH_PX = 7.5
const CELL_PADDING_PX = 32
const MIN_COLUMN_WIDTH_PX = 140
const MAX_COLUMN_WIDTH_PX = 420

// El ancho de cada columna tiene que alcanzarle al texto más largo que va a mostrar esa
// columna — y eso no es solo el valor del campo: el mensaje de error (ver CellWithError)
// suele ser bastante más largo que cualquier valor ("El nombre es obligatorio.", etc.), así
// que si el ancho se calculara solo en base a los valores, el mensaje quedaría cortado.
function estimateColumnWidth(headerTitle: string, texts: string[]): number {
  const longest = texts.reduce((max, text) => Math.max(max, text.length), headerTitle.length)
  const estimated = Math.round(longest * CHAR_WIDTH_PX) + CELL_PADDING_PX
  return Math.min(MAX_COLUMN_WIDTH_PX, Math.max(MIN_COLUMN_WIDTH_PX, estimated))
}

export interface ImportPreviewRow {
  row: number
  fields: Record<string, string>
}

export interface ImportPreviewError {
  row: number
  field: string
  message: string
}

interface ImportPreviewGridProps {
  columns: CrudColumn[]
  rows: ImportPreviewRow[]
  errors: ImportPreviewError[]
}

// Vista previa de un archivo analizado antes de importar: una fila por cada fila del
// Excel, de solo lectura. La celda de la columna que tenga un error para esa fila se
// resalta en rojo y muestra el mensaje debajo del valor, dentro de la misma celda (no como
// tooltip flotante — quedaba chico y aparecía recién a los 2 segundos de hover, muy poco
// visible) — así el error aparece pegado al campo que lo originó, ya visible de entrada.
export function ImportPreviewGrid({ columns, rows, errors }: ImportPreviewGridProps) {
  const errorsByRow = useMemo(() => {
    const map = new Map<number, Map<string, string>>()
    for (const error of errors) {
      if (!map.has(error.row)) map.set(error.row, new Map())
      map.get(error.row)!.set(error.field, error.message)
    }
    return map
  }, [errors])

  const errorCellClassRules: CellClassRules<ImportPreviewRow> = useMemo(
    () => ({
      "!bg-red-100 !text-red-800": (params) => {
        const field = params.colDef.field?.replace("fields.", "")
        return !!field && !!params.data && !!errorsByRow.get(params.data.row)?.get(field)
      },
    }),
    [errorsByRow]
  )

  const columnDefs: ColDef<ImportPreviewRow>[] = useMemo(
    () => [
      {
        headerName: "1",
        pinned: "left",
        // Ídem crud-grid.tsx: sin flex:0 ni minWidth acá, el defaultColDef (flex:1,
        // minWidth:120) termina ganando y esta columna queda tan ancha como cualquier otra.
        width: 56,
        minWidth: 56,
        flex: 0,
        editable: false,
        sortable: false,
        filter: false,
        valueGetter: (params) => params.data?.row ?? (params.node?.rowIndex ?? 0) + 2,
        cellClass: "text-muted-foreground",
      },
      ...columns.map((col): ColDef<ImportPreviewRow> => {
        function CellWithError({ value, data }: CustomCellRendererProps<ImportPreviewRow, string>) {
          const error = data ? errorsByRow.get(data.row)?.get(col.data) : undefined
          return (
            <div className="flex h-full flex-col justify-center gap-0.5 py-1 leading-tight">
              <span className="truncate">{value}</span>
              {error && <span className="truncate text-[11px] font-normal text-red-700">{error}</span>}
            </div>
          )
        }
        // El ancho tiene que alcanzarle tanto a los valores de la columna como a los
        // mensajes de error que le puedan tocar (ver estimateColumnWidth) — no solo al
        // valor del campo, que suele ser mucho más corto que el mensaje.
        const values = rows.map((row) => row.fields[col.data] ?? "")
        const columnErrorMessages = errors.filter((error) => error.field === col.data).map((error) => error.message)
        const width = estimateColumnWidth(col.title, [...values, ...columnErrorMessages])
        return {
          field: `fields.${col.data}`,
          headerName: col.title,
          editable: false,
          sortable: false,
          filter: false,
          width,
          minWidth: width,
          cellClassRules: errorCellClassRules,
          cellRenderer: CellWithError,
        }
      }),
    ],
    [columns, errors, rows, errorCellClassRules, errorsByRow]
  )

  const defaultColDef: ColDef<ImportPreviewRow> = useMemo(
    () => ({
      resizable: true,
      flex: 1,
      minWidth: 120,
      headerClass: "[&_.ag-header-cell-label]:justify-center",
    }),
    []
  )

  return (
    <div className="relative min-w-0 overflow-auto rounded-md border">
      <AgGridReact<ImportPreviewRow>
        theme={gridTheme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={(params) => String(params.data.row)}
        // Filas un poco más altas que el default: el mensaje de error va en una segunda
        // línea, dentro de la misma celda, y necesita lugar debajo del valor.
        rowHeight={44}
        // Sin altura fija: con paginación de a 10 nunca hay más de 10 filas montadas a la
        // vez, así que domLayout="autoHeight" ya alcanza sin scroll interno.
        domLayout="autoHeight"
        pagination
        paginationPageSize={10}
        paginationPageSizeSelector={false}
      />
    </div>
  )
}
