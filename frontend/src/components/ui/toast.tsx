import { Toast } from "@base-ui/react/toast"
import { CircleCheckBig, CircleX, Hourglass, Info, X, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { toastManager } from "@/lib/toast"

function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider toastManager={toastManager} timeout={5000}>
      {children}
      <Toaster />
    </Toast.Provider>
  )
}

const TOAST_ICONS: Record<string, LucideIcon> = {
  success: CircleCheckBig,
  error: CircleX,
  // Estático a propósito (sin animate-spin): la barra de progreso del pie ya comunica
  // movimiento/carga, un ícono girando además sería un segundo indicador redundante.
  loading: Hourglass,
}

function ToastIcon({ type }: { type?: string }) {
  const Icon = (type && TOAST_ICONS[type]) || Info

  return (
    <span
      data-slot="toast-icon"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        type === "success" &&
          "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
        type === "error" && "bg-destructive/10 text-destructive dark:bg-destructive/15",
        type !== "success" && type !== "error" && "bg-muted text-muted-foreground"
      )}
    >
      <Icon className="size-4.5" />
    </span>
  )
}

// Stack "apilado" con profundidad (peek + scale de las tarjetas de atrás, expansión al pasar
// el mouse, swipe-to-dismiss) — mismo patrón que el ejemplo oficial de Base UI, adaptado de
// bottom-center a top-right. Las variables --toast-* las inyecta la librería (medidas reales
// de cada toast); acá solo se consumen. Ver: base-ui.com/react/components/toast#stacking-and-animations
const TOAST_ROOT_CLASSES = cn(
  "[--gap:0.75rem] [--peek:0.75rem]",
  "[--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
  "[--height:var(--toast-frontmost-height,var(--toast-height))]",
  "[--offset-y:calc(var(--toast-offset-y)+(var(--toast-index)*var(--gap))+var(--toast-swipe-movement-y))]",
  "absolute top-0 right-0 left-auto z-[calc(1000-var(--toast-index))] w-full origin-top select-none",
  "[transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+(var(--toast-index)*var(--peek))+(var(--shrink)*var(--height))))_scale(var(--scale))]",
  "overflow-hidden rounded-xl border bg-popover text-sm text-popover-foreground shadow-lg shadow-black/5",
  "h-[var(--height)] data-expanded:h-[var(--toast-height)]",
  "[transition:transform_0.4s_cubic-bezier(0.22,1,0.36,1),opacity_0.4s,height_0.15s]",
  "after:absolute after:bottom-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
  "data-starting-style:[transform:translateY(-150%)]",
  "data-ending-style:opacity-0",
  "data-limited:opacity-0",
  "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(-150%)]",
  "data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
  "data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
  "data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
  "data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
  "data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
  "data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
  "data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
  "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
  "data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]"
)

function Toaster() {
  const { toasts } = Toast.useToastManager()

  return (
    <Toast.Portal>
      <Toast.Viewport
        data-slot="toast-viewport"
        className="fixed top-4 right-4 z-100 w-[min(24rem,calc(100vw-2rem))] outline-none"
      >
        {toasts.map((toast) => (
          <Toast.Root key={toast.id} toast={toast} data-slot="toast" className={TOAST_ROOT_CLASSES}>
            <Toast.Content
              data-slot="toast-content"
              className="flex items-center gap-3 p-3.5 transition-opacity duration-200 ease-out data-behind:opacity-0 data-expanded:opacity-100"
            >
              <ToastIcon type={toast.type} />
              <div className="min-w-0 flex-1">
                {toast.title && (
                  <Toast.Title className="font-medium leading-tight">{toast.title}</Toast.Title>
                )}
                <Toast.Description className="leading-snug text-muted-foreground">
                  {toast.description}
                </Toast.Description>
              </div>
              {toast.type !== "loading" && (
                <Toast.Close
                  aria-label="Cerrar"
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </Toast.Close>
              )}
            </Toast.Content>
            {toast.type === "loading" && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-muted">
                <span className="block h-full w-2/5 animate-[toast-progress-indeterminate_1.3s_ease-in-out_infinite] rounded-full bg-muted-foreground/50" />
              </span>
            )}
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  )
}

export { ToastProvider }
