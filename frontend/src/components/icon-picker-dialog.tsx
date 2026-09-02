import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { iconFromKey, UNOCSS_ICON_PREFIX } from "@/lib/menu-icons"
import { LUCIDE_ICON_NAMES } from "@/lib/lucide-icon-names"

// Son miles de íconos disponibles — no tiene sentido (ni rinde) pintarlos todos de una,
// así que solo se muestran los primeros que matchean la búsqueda.
const MAX_RESULTS = 60

interface IconPickerDialogProps {
  open: boolean
  value: string
  onOpenChange: (open: boolean) => void
  onSelect: (value: string) => void
}

export function IconPickerDialog({ open, value, onOpenChange, onSelect }: IconPickerDialogProps) {
  const [search, setSearch] = useState("")

  const results = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matches = query ? LUCIDE_ICON_NAMES.filter((name) => name.includes(query)) : LUCIDE_ICON_NAMES
    return matches.slice(0, MAX_RESULTS)
  }, [search])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setSearch("")
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Elegir ícono</DialogTitle>
          <DialogDescription>Buscá por nombre (en inglés) y hacé click en el que quieras usar.</DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder="Buscar ícono…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
          {results.map((name) => {
            const IconComponent = iconFromKey(name)
            const iconValue = `${UNOCSS_ICON_PREFIX}${name}`
            return (
              <Button
                key={name}
                type="button"
                variant={iconValue === value ? "default" : "outline"}
                className="flex h-auto flex-col items-center gap-1 py-2 text-[10px]"
                onClick={() => {
                  onSelect(iconValue)
                  onOpenChange(false)
                }}
              >
                <IconComponent className="size-5" />
                <span className="w-full truncate text-center">{name}</span>
              </Button>
            )
          })}
          {results.length === 0 && (
            <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
              No se encontró ningún ícono con ese nombre.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
