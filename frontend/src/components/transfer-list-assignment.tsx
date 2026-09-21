import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronRightIcon, LoaderCircleIcon, MinusIcon, PlusIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { toastError, toastSuccess } from "@/lib/toast"
import { cn } from "@/lib/utils"

export interface TransferListOwnerOption {
  id: string
  label: string
  sublabel?: string
}

export interface TransferListCatalogItem {
  id: string
  label: string
  sublabel?: string
}

interface TransferListAssignmentProps {
  // "Rol"/"Usuario" — encabeza el selector de a quién se le está asignando algo.
  ownerLabel: string
  ownerOptions: TransferListOwnerOption[]
  ownersLoading: boolean
  // "Permisos"/"Menús"/"Roles" — lo que se está asignando.
  itemLabel: string
  catalogItems: TransferListCatalogItem[]
  catalogLoading: boolean
  fetchAssigned: (ownerId: string) => Promise<string[]>
  saveAssigned: (ownerId: string, ids: string[]) => Promise<string[]>
}

function ItemRow({
  item,
  onToggle,
  icon,
}: {
  item: TransferListCatalogItem
  onToggle: () => void
  icon: ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
      >
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.label}</span>
          {item.sublabel && <span className="block truncate text-xs text-muted-foreground">{item.sublabel}</span>}
        </span>
      </button>
    </li>
  )
}

// Pantalla genérica de "dos listas": se elige un dueño (rol o usuario) a la izquierda del
// header, y se mueven ítems entre "Disponibles" y "Asignados" — usada por PermisosPage
// (rol -> permisos), MenusPage (rol -> menús) y UsuariosPage (usuario -> roles), así los
// tres comparten un único componente en vez de reimplementar la misma mecánica tres veces.
export function TransferListAssignment({
  ownerLabel,
  ownerOptions,
  ownersLoading,
  itemLabel,
  catalogItems,
  catalogLoading,
  fetchAssigned,
  saveAssigned,
}: TransferListAssignmentProps) {
  const [ownerId, setOwnerId] = useState<string>("")
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set())
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [assignedLoading, setAssignedLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [availableFilter, setAvailableFilter] = useState("")
  const [assignedFilter, setAssignedFilter] = useState("")

  // Selecciona el primer dueño en cuanto llega la lista, si todavía no hay ninguno elegido.
  useEffect(() => {
    if (!ownerId && ownerOptions.length > 0) {
      setOwnerId(ownerOptions[0].id)
    }
  }, [ownerId, ownerOptions])

  useEffect(() => {
    if (!ownerId) return
    let cancelled = false
    setAssignedLoading(true)
    fetchAssigned(ownerId)
      .then((ids) => {
        if (cancelled) return
        const idSet = new Set(ids)
        setAssignedIds(idSet)
        setPendingIds(idSet)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        toastError(err instanceof Error ? err.message : "No se pudo cargar la asignación.")
      })
      .finally(() => {
        if (!cancelled) setAssignedLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId])

  const isDirty = useMemo(() => {
    if (pendingIds.size !== assignedIds.size) return true
    for (const id of pendingIds) {
      if (!assignedIds.has(id)) return true
    }
    return false
  }, [pendingIds, assignedIds])

  const catalogById = useMemo(() => new Map(catalogItems.map((item) => [item.id, item])), [catalogItems])

  const available = useMemo(
    () =>
      catalogItems
        .filter((item) => !pendingIds.has(item.id))
        .filter((item) => matchesFilter(item, availableFilter)),
    [catalogItems, pendingIds, availableFilter]
  )
  const assigned = useMemo(
    () =>
      [...pendingIds]
        .map((id) => catalogById.get(id))
        .filter((item): item is TransferListCatalogItem => Boolean(item))
        .filter((item) => matchesFilter(item, assignedFilter))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [pendingIds, catalogById, assignedFilter]
  )

  function addItem(id: string) {
    setPendingIds((prev) => new Set(prev).add(id))
  }
  function removeItem(id: string) {
    setPendingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }
  function addAll() {
    setPendingIds(new Set(catalogItems.map((item) => item.id)))
  }
  function removeAll() {
    setPendingIds(new Set())
  }
  function discardChanges() {
    setPendingIds(assignedIds)
  }

  async function handleSave() {
    if (!ownerId) return
    setSaving(true)
    try {
      const result = await saveAssigned(ownerId, [...pendingIds])
      const idSet = new Set(result)
      setAssignedIds(idSet)
      setPendingIds(idSet)
      toastSuccess(`${itemLabel} actualizados.`)
    } catch (err) {
      toastError(err instanceof Error ? err.message : `No se pudo guardar la asignación de ${itemLabel.toLowerCase()}.`)
    } finally {
      setSaving(false)
    }
  }

  const selectedOwner = ownerOptions.find((option) => option.id === ownerId)

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <label className="mb-1.5 block text-sm font-medium" htmlFor="transfer-owner-select">
          {ownerLabel}
        </label>
        <select
          id="transfer-owner-select"
          value={ownerId}
          disabled={ownersLoading || isDirty}
          onChange={(event) => setOwnerId(event.target.value)}
          className="h-8 w-full max-w-sm rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
        >
          {ownerOptions.length === 0 && <option value="">Sin opciones</option>}
          {ownerOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
              {option.sublabel ? ` — ${option.sublabel}` : ""}
            </option>
          ))}
        </select>
        {isDirty && (
          <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            Guardá o descartá los cambios antes de elegir {ownerLabel === "Rol" ? "otro rol" : "otro usuario"}.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        <Card className="flex min-h-72 flex-col p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{itemLabel} disponibles</h3>
            <Button type="button" variant="ghost" size="sm" disabled={available.length === 0} onClick={addAll}>
              Agregar todos
            </Button>
          </div>
          <SearchBox value={availableFilter} onChange={setAvailableFilter} />
          <ItemList
            loading={catalogLoading || assignedLoading}
            emptyLabel={`No hay ${itemLabel.toLowerCase()} disponibles.`}
          >
            {available.map((item) => (
              <ItemRow key={item.id} item={item} onToggle={() => addItem(item.id)} icon={<PlusIcon className="size-4" />} />
            ))}
          </ItemList>
        </Card>

        <div className="hidden items-center justify-center text-muted-foreground md:flex">
          <ChevronRightIcon className="size-5" />
        </div>

        <Card className="flex min-h-72 flex-col p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{itemLabel} asignados</h3>
            <Button type="button" variant="ghost" size="sm" disabled={pendingIds.size === 0} onClick={removeAll}>
              Quitar todos
            </Button>
          </div>
          <SearchBox value={assignedFilter} onChange={setAssignedFilter} />
          <ItemList loading={catalogLoading || assignedLoading} emptyLabel={`Este ${ownerLabel.toLowerCase()} no tiene ${itemLabel.toLowerCase()} asignados.`}>
            {assigned.map((item) => (
              <ItemRow key={item.id} item={item} onToggle={() => removeItem(item.id)} icon={<MinusIcon className="size-4" />} />
            ))}
          </ItemList>
        </Card>
      </div>

      <div className="flex items-center justify-end gap-2">
        {isDirty && (
          <Button type="button" variant="outline" onClick={discardChanges} disabled={saving}>
            Descartar cambios
          </Button>
        )}
        <Button type="button" onClick={handleSave} disabled={!isDirty || saving || !ownerId}>
          {saving && <LoaderCircleIcon className="size-4 animate-spin" />}
          Guardar cambios
        </Button>
      </div>
      {selectedOwner === undefined && !ownersLoading && ownerOptions.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay {ownerLabel === "Rol" ? "roles" : "usuarios"} para elegir.</p>
      )}
    </div>
  )
}

function matchesFilter(item: TransferListCatalogItem, filter: string): boolean {
  if (!filter.trim()) return true
  const haystack = `${item.label} ${item.sublabel ?? ""}`.toLowerCase()
  return haystack.includes(filter.trim().toLowerCase())
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative mb-2">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Buscar…" className="pl-7" />
    </div>
  )
}

function ItemList({
  loading,
  emptyLabel,
  children,
}: {
  loading: boolean
  emptyLabel: string
  children: ReactNode
}) {
  const isEmpty = !loading && Array.isArray(children) && children.length === 0
  return (
    <ul className={cn("flex-1 space-y-0.5 overflow-y-auto rounded-md", loading && "opacity-50")}>
      {loading ? (
        <li className="flex items-center justify-center py-8 text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
        </li>
      ) : isEmpty ? (
        <li className="px-2 py-8 text-center text-sm text-muted-foreground">{emptyLabel}</li>
      ) : (
        children
      )}
    </ul>
  )
}
