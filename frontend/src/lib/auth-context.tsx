import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

import { ApiError, me as apiMe, refresh as apiRefresh, type SessionUser } from "@/lib/api"

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

// Sesión de Django dura 8h (SESSION_COOKIE_AGE) y se desliza con cualquier request autenticado
// (SESSION_SAVE_EVERY_REQUEST=True). Este intervalo solo cubre al usuario inactivo en la UI que
// no dispara ningún otro request, para que la sesión no expire mientras sigue con la pestaña abierta.
const SESSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000

// Duración mínima de las pantallas de carga (chequeo de sesión al abrir la app, envío del
// login, transición post-login). Sin esto, en una red rápida el loading dura unos milisegundos
// y no se percibe. Configurable por env (VITE_AUTH_TRANSITION_DELAY_MS) para no tener que tocar
// código si se quiere ajustar el tiempo.
const parsedDelay = Number(import.meta.env.VITE_AUTH_TRANSITION_DELAY_MS)
export const AUTH_TRANSITION_DELAY_MS = Number.isFinite(parsedDelay) && parsedDelay >= 0 ? parsedDelay : 1500

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated"

interface AuthContextValue {
  user: SessionUser | null
  status: AuthStatus
  sessionExpiresIn: number | null
  // No hace el request de red (eso lo maneja cada form, para poder mostrar su propia UI de
  // carga/toast): solo confirma la sesión en el estado global una vez que el form considera
  // terminado su propio flujo. Separar esto de "login" evita que RedirectIfAuthenticated
  // navegue apenas el backend responde, antes de que el form termine de mostrar su feedback.
  completeLogin: (user: SessionUser) => void
  // Igual que completeLogin: no hace el request de red (eso lo maneja el componente que
  // dispara el logout, para mostrar su propio toast sin la pantalla completa de carga).
  completeLogout: () => void
  // Chequeo de permisos estilo CASL sobre permisos_front: "manage"/"all" actúan como
  // comodín (ver apps.seguridad.services.ALL_PERMISSIONS_FRONT en el backend).
  can: (action: string, subject: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [sessionExpiresIn, setSessionExpiresIn] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    const startedAt = Date.now()

    // Mantiene la pantalla de carga al menos AUTH_TRANSITION_DELAY_MS, aunque /me/ responda
    // antes. "cancelled" evita aplicar el resultado si el componente ya se desmontó (StrictMode
    // en dev monta/desmonta/vuelve a montar este efecto una vez).
    async function applyAfterMinDelay(apply: () => void) {
      const remaining = AUTH_TRANSITION_DELAY_MS - (Date.now() - startedAt)
      if (remaining > 0) await wait(remaining)
      if (!cancelled) apply()
    }

    apiMe(controller.signal)
      .then((current) => {
        applyAfterMinDelay(() => {
          setUser(current)
          setStatus("authenticated")
        })
      })
      .catch((error) => {
        if (isAbortError(error)) return
        applyAfterMinDelay(() => {
          setUser(null)
          setStatus("unauthenticated")
        })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  // Mantiene viva la sesión (sliding expiration) mientras el usuario la deja abierta sin
  // interactuar. Se detiene solo (cleanup) si deja de estar autenticado o se desmonta el provider.
  useEffect(() => {
    if (status !== "authenticated") return

    async function refreshSession() {
      try {
        const result = await apiRefresh()
        setSessionExpiresIn(result.expires_in)
      } catch (error) {
        // DRF con SessionAuthentication devuelve 403 (no 401) cuando no hay sesión válida,
        // porque no hay un esquema de auth que "desafiar" con WWW-Authenticate (confirmado
        // contra el backend real: /api/auth/refresh/ y /api/auth/me/ sin sesión → 403).
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setUser(null)
          setStatus("unauthenticated")
        }
      }
    }

    const intervalId = window.setInterval(refreshSession, SESSION_REFRESH_INTERVAL_MS)

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshSession()
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [status])

  function completeLogin(current: SessionUser) {
    setUser(current)
    setStatus("authenticated")
  }

  function completeLogout() {
    setUser(null)
    setStatus("unauthenticated")
    setSessionExpiresIn(null)
  }

  function can(action: string, subject: string) {
    if (!user) return false
    return user.permisos_front.some(
      (rule) =>
        (rule.action === action || rule.action === "manage") &&
        (rule.subject === subject || rule.subject === "all")
    )
  }

  return (
    <AuthContext.Provider
      value={{ user, status, sessionExpiresIn, completeLogin, completeLogout, can }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>")
  }
  return ctx
}
