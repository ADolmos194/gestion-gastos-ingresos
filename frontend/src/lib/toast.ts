import { Toast } from "@base-ui/react/toast"

export const toastManager = Toast.createToastManager()

export function toastSuccess(description: string) {
  toastManager.add({ type: "success", description })
}

export function toastError(description: string) {
  toastManager.add({ type: "error", description })
}

// Un solo toast que arranca en estado "cargando" y se transforma en éxito o error cuando
// `promise` se resuelve — el mismo patrón que toast.promise() de sonner. Devuelve la promesa
// original tal cual (mismo valor/rechazo), así el caller puede seguir usando await/catch.
export function toastPromise<T>(
  promise: Promise<T>,
  options: {
    loading: string
    success: string | ((value: T) => string)
    error: string | ((error: unknown) => string)
  }
) {
  return toastManager.promise(promise, {
    loading: { type: "loading", description: options.loading, timeout: 0 },
    success: (value) => ({
      type: "success",
      description: typeof options.success === "function" ? options.success(value) : options.success,
    }),
    error: (err) => ({
      type: "error",
      description: typeof options.error === "function" ? options.error(err) : options.error,
    }),
  })
}
