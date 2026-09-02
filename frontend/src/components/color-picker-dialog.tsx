import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const DEFAULT_COLOR = "#3b82f6"

// Mismos colores que ya usa cfg_status (ver seed_statuses.json) — no son "los únicos
// válidos" (el input de color de al lado permite cualquier hex), son atajos para no tener
// que abrir el selector nativo del sistema operativo para los casos más comunes.
const PRESET_COLORS = [
  "#22c55e",
  "#ef4444",
  "#f97316",
  "#8b5cf6",
  "#0ea5e9",
  "#6366f1",
  "#fbbf24",
  "#10b981",
]

interface ColorPickerDialogProps {
  open: boolean
  value: string
  onOpenChange: (open: boolean) => void
  onSelect: (value: string) => void
}

export function ColorPickerDialog({ open, value, onOpenChange, onSelect }: ColorPickerDialogProps) {
  const [draft, setDraft] = useState(HEX_COLOR_PATTERN.test(value) ? value : DEFAULT_COLOR)

  // Reabrir el diálogo (por ejemplo para otra fila) tiene que arrancar del valor de ESA
  // fila, no del último borrador que haya quedado de la anterior.
  useEffect(() => {
    if (open) setDraft(HEX_COLOR_PATTERN.test(value) ? value : DEFAULT_COLOR)
  }, [open, value])

  const isValid = HEX_COLOR_PATTERN.test(draft)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Elegir color</DialogTitle>
          <DialogDescription>Usá el selector, un atajo de abajo, o escribí el código hexadecimal.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={isValid ? draft : DEFAULT_COLOR}
            onChange={(event) => setDraft(event.target.value)}
            className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
          />
          <Field className="flex-1">
            <FieldLabel htmlFor="color-picker-hex">Código hex</FieldLabel>
            <Input
              id="color-picker-hex"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="#22c55e"
              aria-invalid={!isValid}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setDraft(preset)}
              title={preset}
              style={{ backgroundColor: preset }}
              className={`size-7 rounded-full border-2 transition-transform hover:scale-110 ${
                draft.toLowerCase() === preset ? "border-foreground" : "border-transparent"
              }`}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!isValid}
            onClick={() => {
              onSelect(draft)
              onOpenChange(false)
            }}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
