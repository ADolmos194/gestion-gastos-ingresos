import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ChevronRightIcon, LoaderCircleIcon, MinusIcon, PlusIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { toastError, toastSuccess } from "@/lib/toast"
import { cn } from "@/lib/utils"

type TransferDirection = "add" | "remove"

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

// Cuánto tarda un ítem en "viajar" de una lista a la otra: es tanto la duración del vuelo
// de la cajita (ver FlyingChip/fly-item en index.css, HARDCODEADA ahí como 480ms porque
// Tailwind arma esa clase en build time, no puede interpolar esta constante) como el
// tiempo que la fila de origen se queda desvaneciéndose antes de desaparecer de golpe —
// tienen que durar lo mismo, si no la fila se esfuma antes de que la cajita llegue.
const TRANSFER_MS = 480
// Cuánto se mantiene el resalte (el tinte de fondo) en la fila recién llegada a la otra
// lista, después de terminar su animación de entrada — puramente cosmético, para que la
// mirada encuentre fácil "che, esto es lo que acabo de mover".
const HIGHLIGHT_MS = 650
// Cuánto se ve la flechita "en tránsito" entre las dos listas (ver TransferArrow) — un
// poco más que TRANSFER_MS a propósito: se queda prendida un toque después de que la
// cajita ya aterrizó, como un eco del movimiento. No depende de cuánto tarde el commit real.
const ARROW_MS = TRANSFER_MS + 120

function ItemRow({
  item,
  onToggle,
  icon,
  exiting,
  justMoved,
  index,
  rowRef,
}: {
  item: TransferListCatalogItem
  onToggle: () => void
  icon: ReactNode
  exiting: boolean
  justMoved: boolean
  index: number
  rowRef: (el: HTMLLIElement | null) => void
}) {
  return (
    <li
      ref={rowRef}
      className={cn(
        exiting
          ? // Dura lo mismo que el vuelo de la cajita (TRANSFER_MS, ver FlyingChip más
            // abajo) para que la fila de origen se termine de desvanecer justo cuando la
            // cajita aterriza del otro lado — ninguna de las dos "gana" la carrera visual.
            "pointer-events-none animate-out fade-out-0 zoom-out-95 duration-[480ms]"
          : "animate-in fade-in-0 slide-in-from-top-1 duration-150"
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

// Separador entre las dos columnas: en reposo es solo un chevron gris fijo, pero mientras
// hay un traspaso en curso (ver ARROW_MS) se convierte en tres chevrons "persiguiéndose"
// en el color primario — la idea es que se lea como "esto está viajando hacia la otra
// lista" (no un spinner genérico, sino uno con dirección), tanto al agregar como al quitar.
function TransferArrow({ direction }: { direction: TransferDirection | null }) {
  if (!direction) {
    return (
      <div className="hidden items-center justify-center text-muted-foreground md:flex">
        <ChevronRightIcon className="size-5" />
      </div>
    )
  }
  return (
    <div
      className={cn("hidden items-center justify-center text-primary md:flex", direction === "remove" && "-scale-x-100")}
      aria-hidden="true"
    >
      <span className="flex items-center -space-x-2.5">
        {[0, 1, 2].map((step) => (
          <ChevronRightIcon
            key={step}
            className="size-4 animate-[chase-arrow_0.9s_ease-in-out_infinite]"
            style={{ animationDelay: `${step * 150}ms` }}
          />
        ))}
      </span>
    </div>
  )
}

interface FlyingChip {
  key: string
  label: string
  // Cada cajita guarda su propia dirección (no se lee del estado transferDirection del
  // padre): si un segundo traspaso arranca mientras el primero todavía tiene cajitas en
  // el aire, esas cajitas viejas no pueden cambiar de ícono a mitad de vuelo solo porque
  // el traspaso más nuevo va para el otro lado.
  direction: TransferDirection
  // Punto de partida en coordenadas de viewport (el centro de la fila que se tocó).
  left: number
  top: number
  // Distancia en píxeles hasta el punto de llegada — se le pasa a la animación fly-item
  // (ver index.css) como las variables CSS --fly-dx/--fly-dy.
  dx: number
  dy: number
  delay: number
}

// La "cajita" que de verdad viaja de una lista a la otra — a diferencia de TransferArrow
// (que es un ícono fijo en el medio, solo indica dirección en general), esta es el ítem
// tocado en sí: sale de su fila real, recorre un arco por la pantalla (ver @keyframes
// fly-item en index.css) y se desvanece justo al llegar a la lista de destino.
function FlyingChipEl({ chip, onDone }: { chip: FlyingChip; onDone: (key: string) => void }) {
  return (
    <span
      onAnimationEnd={() => onDone(chip.key)}
      style={
        {
          left: chip.left,
          top: chip.top,
          animationDelay: `${chip.delay}ms`,
          "--fly-dx": `${chip.dx}px`,
          "--fly-dy": `${chip.dy}px`,
        } as CSSProperties
      }
      // La duración (480ms) está a propósito hardcodeada acá en vez de interpolar
      // TRANSFER_MS: Tailwind arma esta clase en build time escaneando el texto literal
      // del código, no puede leer una constante de JS en tiempo de ejecución.
      className="pointer-events-none fixed z-100 flex max-w-48 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-lg ring-1 ring-foreground/10 animate-[fly-item_480ms_ease-in]"
    >
      {chip.direction === "add" ? (
        <PlusIcon className="size-3 shrink-0 text-primary" />
      ) : (
        <MinusIcon className="size-3 shrink-0 text-destructive" />
      )}
      <span className="truncate">{chip.label}</span>
    </span>
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
  // Qué traspaso está en curso ahora mismo (o null si no hay ninguno) — solo maneja el
  // ícono central de TransferArrow, independiente de exitingAvailable/exitingAssigned.
  const [transferDirection, setTransferDirection] = useState<TransferDirection | null>(null)
  // Las cajitas voladoras en pantalla ahora mismo (ver FlyingChipEl) — cada una se borra
  // sola vía onAnimationEnd, no hace falta un timeout acá para limpiarlas.
  const [flyingChips, setFlyingChips] = useState<FlyingChip[]>([])

  // Posición real en pantalla de cada fila (para que la cajita sepa de dónde salir) y de
  // cada lista completa (para saber hacia dónde volar) — un Map en vez de estado porque
  // esto es pura lectura del DOM en el momento del click, no algo que dispare renders.
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const availableListRef = useRef<HTMLUListElement>(null)
  const assignedListRef = useRef<HTMLUListElement>(null)

  function registerRow(id: string) {
    return (el: HTMLLIElement | null) => {
      if (el) rowRefs.current.set(id, el)
      else rowRefs.current.delete(id)
    }
  }

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
    setTransferDirection(null)
    setFlyingChips([])

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
  // "Agregar/Quitar todos". `direction` solo prende la flecha central (ver TransferArrow),
  // por eso se apaga con su propio timeout (ARROW_MS) en vez de compartir el de justMovedIds.
  // Arma una cajita voladora por cada id, desde el centro real de su fila hasta un punto
  // fijo cerca de la esquina superior de la lista de destino (no vale la pena calcular
  // exactamente dónde va a insertarse — la lista está ordenada alfabéticamente y puede
  // reordenarse en el momento — el gesto de "llegó a esta lista" ya se entiende igual).
  function spawnFlyingChips(ids: string[], direction: TransferDirection) {
    const destEl = direction === "add" ? assignedListRef.current : availableListRef.current
    if (!destEl) return
    const destRect = destEl.getBoundingClientRect()
    const destX = destRect.left + 28
    const destY = destRect.top + 20

    const chips: FlyingChip[] = []
    ids.forEach((id, index) => {
      const rowEl = rowRefs.current.get(id)
      const item = catalogById.get(id)
      if (!rowEl || !item) return
      const rect = rowEl.getBoundingClientRect()
      const startX = rect.left + rect.width / 2
      const startY = rect.top + rect.height / 2
      chips.push({
        key: `${id}-${index}-${Date.now()}`,
        label: item.label,
        direction,
        left: startX,
        top: startY,
        dx: destX - startX,
        dy: destY - startY,
        delay: Math.min(index, 12) * 40,
      })
    })
    if (chips.length > 0) {
      setFlyingChips((prev) => [...prev, ...chips])
    }
  }

  function removeFlyingChip(key: string) {
    setFlyingChips((prev) => prev.filter((chip) => chip.key !== key))
  }

  function animateThenCommit(
    ids: string[],
    direction: TransferDirection,
    exitingSetter: React.Dispatch<React.SetStateAction<Set<string>>>,
    commit: () => void
  ) {
    if (ids.length === 0) return
    const generation = generationRef.current
    exitingSetter((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })
    setTransferDirection(direction)
    spawnFlyingChips(ids, direction)
    window.setTimeout(() => {
      if (generationRef.current !== generation) return
      setTransferDirection(null)
    }, ARROW_MS)
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
    }, TRANSFER_MS)
  }

  function addItem(id: string) {
    animateThenCommit([id], "add", setExitingAvailable, () => {
      setPendingIds((prev) => new Set(prev).add(id))
    })
  }
  function removeItem(id: string) {
    animateThenCommit([id], "remove", setExitingAssigned, () => {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    })
  }
  function addAll() {
    const ids = catalogItems.filter((item) => !pendingIds.has(item.id)).map((item) => item.id)
    animateThenCommit(ids, "add", setExitingAvailable, () => {
      setPendingIds(new Set(catalogItems.map((item) => item.id)))
    })
  }
  function removeAll() {
    const ids = [...pendingIds]
    animateThenCommit(ids, "remove", setExitingAssigned, () => {
      setPendingIds(new Set())
    })
  }
  function discardChanges() {
    generationRef.current += 1
    setExitingAvailable(new Set())
    setExitingAssigned(new Set())
    setJustMovedIds(new Set())
    setTransferDirection(null)
    setFlyingChips([])
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
    <>
    <Card className="flex flex-col gap-4 p-4">
      <div>
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
            <SelectGroup>
              <SelectLabel>{ownerLabel === "Rol" ? "Roles" : "Usuarios"}</SelectLabel>
              {ownerOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                  {option.sublabel && <span className="text-muted-foreground">{option.sublabel}</span>}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {isDirty && (
          <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            Guardá o descartá los cambios antes de elegir {ownerLabel === "Rol" ? "otro rol" : "otro usuario"}.
          </p>
        )}
        {selectedOwner === undefined && !ownersLoading && ownerOptions.length === 0 && (
          <p className="mt-1.5 text-sm text-muted-foreground">No hay {ownerLabel === "Rol" ? "roles" : "usuarios"} para elegir.</p>
        )}
      </div>

      <Separator />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        <div className="flex min-h-72 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{itemLabel} disponibles</h3>
            <Button type="button" variant="ghost" size="sm" disabled={available.length === 0} onClick={addAll}>
              Agregar todos
            </Button>
          </div>
          <SearchBox value={availableFilter} onChange={setAvailableFilter} />
          <ItemList
            listRef={availableListRef}
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
                rowRef={registerRow(item.id)}
              />
            ))}
          </ItemList>
        </div>

        <TransferArrow direction={transferDirection} />

        <div className="flex min-h-72 flex-col border-t pt-3 md:border-t-0 md:pt-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{itemLabel} asignados</h3>
            <Button type="button" variant="ghost" size="sm" disabled={pendingIds.size === 0} onClick={removeAll}>
              Quitar todos
            </Button>
          </div>
          <SearchBox value={assignedFilter} onChange={setAssignedFilter} />
          <ItemList
            listRef={assignedListRef}
            loading={catalogLoading || assignedLoading}
            emptyLabel={`Este ${ownerLabel.toLowerCase()} no tiene ${itemLabel.toLowerCase()} asignados.`}
          >
            {assigned.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => removeItem(item.id)}
                icon={<MinusIcon className="size-4" />}
                exiting={exitingAssigned.has(item.id)}
                justMoved={justMovedIds.has(item.id)}
                index={index}
                rowRef={registerRow(item.id)}
              />
            ))}
          </ItemList>
        </div>
      </div>

      <Separator />

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
    </Card>
    {flyingChips.map((chip) => (
      <FlyingChipEl key={chip.key} chip={chip} onDone={removeFlyingChip} />
    ))}
    </>
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
  listRef,
}: {
  loading: boolean
  emptyLabel: string
  children: ReactNode
  // Necesario para medir dónde "aterriza" la cajita voladora (ver FlyingChip / spawnFlight
  // en TransferListAssignment) — sin esto no hay forma de saber en qué punto de la
  // pantalla queda la lista de destino.
  listRef: React.RefObject<HTMLUListElement | null>
}) {
  const isEmpty = !loading && Array.isArray(children) && children.length === 0
  return (
    <ul ref={listRef} className={cn("flex-1 space-y-0.5 overflow-y-auto rounded-md", loading && "opacity-50")}>
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
