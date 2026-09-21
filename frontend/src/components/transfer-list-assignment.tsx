import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronRightIcon, LoaderCircleIcon, MinusIcon, PlusIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

// Cuánto dura la animación de salida de una fila antes de que realmente cambie de lista
// (ver animateThenCommit) — tiene que coincidir con la duration-* que usan las clases
// animate-out más abajo, si no la fila "salta" en vez de desvanecerse.
const EXIT_MS = 150
// Cuánto se mantiene el resalte (el tinte de fondo) en la fila recién llegada a la otra
// lista, después de terminar su animación de entrada — puramente cosmético, para que la
// mirada encuentre fácil "che, esto es lo que acabo de mover".
const HIGHLIGHT_MS = 650

function ItemRow({
  item,
  onToggle,
  icon,
  exiting,
  justMoved,
  index,
}: {
  item: TransferListCatalogItem
  onToggle: () => void
  icon: ReactNode
  exiting: boolean
  justMoved: boolean
  index: number
}) {
  return (
    <li
      className={cn(
        "duration-150",
        exiting
          ? "pointer-events-none animate-out fade-out-0 zoom-out-95"
          : "animate-in fade-in-0 slide-in-from-top-1"
      )}
      // Stagger liviano en "Agregar/Quitar todos": cada fila entra un poquito después que
      // la anterior en vez de todas a la vez, así se lee como un movimiento en cascada en
      // vez de un parpadeo. Tope en 12 para que una lista larga no tarde una eternidad en
      // terminar de entrar.
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={exiting}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-500 hover:bg-muted disabled:pointer-events-none",
          justMoved && "bg-primary/10"
        )}
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

  // Ids con la animación de salida en curso (ver animateThenCommit) — mientras están acá
  // siguen perteneciendo lógicamente a su lista de origen (pendingIds todavía no cambió),
  // solo se les pinta la clase de salida.
  const [exitingAvailable, setExitingAvailable] = useState<Set<string>>(new Set())
  const [exitingAssigned, setExitingAssigned] = useState<Set<string>>(new Set())
  // Ids que acaban de terminar de moverse — solo para el resalte momentáneo (ver
  // HIGHLIGHT_MS), no afecta a qué lista pertenecen.
  const [justMovedIds, setJustMovedIds] = useState<Set<string>>(new Set())

  // Evita que un setTimeout de una animación en curso termine escribiendo sobre el estado
  // de OTRO dueño si el usuario alcanza a cambiar de rol/usuario antes de que termine (no
  // debería poder pasar porque el selector se deshabilita con cambios pendientes, pero un
  // "Descartar cambios" a mitad de animación sí es posible) — cada operación de animación
  // guarda la generación vigente al arrancar y se aborta si ya cambió.
  const generationRef = useRef(0)

  // Selecciona el primer dueño en cuanto llega la lista, si todavía no hay ninguno elegido.
  useEffect(() => {
    if (!ownerId && ownerOptions.length > 0) {
      setOwnerId(ownerOptions[0].id)
    }
  }, [ownerId, ownerOptions])

  useEffect(() => {
    generationRef.current += 1
    setExitingAvailable(new Set())
    setExitingAssigned(new Set())
    setJustMovedIds(new Set())

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

  // Reproduce la salida de `ids` de su lista actual y, recién cuando termina, aplica
  // `commit` (el cambio real a pendingIds) — así el ítem tiene tiempo de desvanecerse antes
  // de desaparecer de golpe, y entra "fresco" (con su propia animación de entrada, gratis
  // por ser un nodo nuevo) del otro lado. Se usa tanto para un solo ítem como para
  // "Agregar/Quitar todos".
  function animateThenCommit(ids: string[], exitingSetter: React.Dispatch<React.SetStateAction<Set<string>>>, commit: () => void) {
    if (ids.length === 0) return
    const generation = generationRef.current
    exitingSetter((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })
    window.setTimeout(() => {
      if (generationRef.current !== generation) return
      commit()
      exitingSetter((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      })
      setJustMovedIds((prev) => new Set([...prev, ...ids]))
      window.setTimeout(() => {
        if (generationRef.current !== generation) return
        setJustMovedIds((prev) => {
          const next = new Set(prev)
          ids.forEach((id) => next.delete(id))
          return next
        })
      }, HIGHLIGHT_MS)
    }, EXIT_MS)
  }

  function addItem(id: string) {
    animateThenCommit([id], setExitingAvailable, () => {
      setPendingIds((prev) => new Set(prev).add(id))
    })
  }
  function removeItem(id: string) {
    animateThenCommit([id], setExitingAssigned, () => {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    })
  }
  function addAll() {
    const ids = catalogItems.filter((item) => !pendingIds.has(item.id)).map((item) => item.id)
    animateThenCommit(ids, setExitingAvailable, () => {
      setPendingIds(new Set(catalogItems.map((item) => item.id)))
    })
  }
  function removeAll() {
    const ids = [...pendingIds]
    animateThenCommit(ids, setExitingAssigned, () => {
      setPendingIds(new Set())
    })
  }
  function discardChanges() {
    generationRef.current += 1
    setExitingAvailable(new Set())
    setExitingAssigned(new Set())
    setJustMovedIds(new Set())
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
  // Le da a <SelectValue> cómo mostrar el trigger sin abrir el popup: sin esto, Base UI no
  // tiene de dónde sacar la etiqueta del valor ya seleccionado en el primer render (el
  // Popup recién monta sus <SelectItem> al abrirse) y termina mostrando el id crudo.
  const ownerItems = useMemo(
    () =>
      Object.fromEntries(
        ownerOptions.map((option) => [option.id, option.sublabel ? `${option.label} — ${option.sublabel}` : option.label])
      ),
    [ownerOptions]
  )

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <label className="mb-1.5 block text-sm font-medium" id="transfer-owner-label">
          {ownerLabel}
        </label>
        <Select
          items={ownerItems}
          value={ownerId || null}
          onValueChange={(value) => setOwnerId((value as string | null) ?? "")}
          disabled={ownersLoading || isDirty || ownerOptions.length === 0}
        >
          <SelectTrigger aria-labelledby="transfer-owner-label" className="w-full max-w-sm">
            <SelectValue
              placeholder={ownerOptions.length === 0 ? "Sin opciones" : `Elegí un ${ownerLabel.toLowerCase()}`}
            />
          </SelectTrigger>
          <SelectContent>
            {ownerOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
                {option.sublabel && <span className="text-muted-foreground">{option.sublabel}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            {available.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => addItem(item.id)}
                icon={<PlusIcon className="size-4" />}
                exiting={exitingAvailable.has(item.id)}
                justMoved={justMovedIds.has(item.id)}
                index={index}
              />
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
            {assigned.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => removeItem(item.id)}
                icon={<MinusIcon className="size-4" />}
                exiting={exitingAssigned.has(item.id)}
                justMoved={justMovedIds.has(item.id)}
                index={index}
              />
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
