import type { ReactNode } from "react"
import { Navigate, Outlet, useLocation } from "react-router"

import { AuthLoadingScreen } from "@/components/auth-loading-screen"
import { useAuth } from "@/lib/auth-context"

// Usar como layout route: bloquea el acceso a sus rutas hijas si no hay sesión.
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === "loading") {
    return <AuthLoadingScreen />
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

// Evita que alguien ya logueado vea /login otra vez.
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { status } = useAuth()

  if (status === "loading") {
    return <AuthLoadingScreen />
  }

  if (status === "authenticated") {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
