import { Navigate, Outlet, useLocation } from "react-router"

import type { MenuItem } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { subjectForPath } from "@/lib/page-routes"

function collectSubjects(menus: MenuItem[]): Set<string> {
  const subjects = new Set<string>()
  function walk(nodes: MenuItem[]) {
    for (const node of nodes) {
      subjects.add(node.subject)
      walk(node.children)
    }
  }
  walk(menus)
  return subjects
}

// Segunda capa de defensa además de que el sidebar solo muestra los ítems permitidos:
// bloquea la navegación directa por URL a una página que el usuario no tiene en su menú
// (p.ej. escribiendo /seguridad/maestras/usuarios a mano con el rol PERMISSION LIMIT).
//
// Matchea por Menu.subject (el identificador único real, no el string de la URL): se
// resuelve el path actual a un subject vía pageRoutes, y se chequea que ese subject esté
// en el árbol de menú que mandó el backend para este usuario.
//
// Esto es UX, no la seguridad real del sistema — el chequeo que de verdad importa es el
// del backend en cada endpoint (ver apps.seguridad.permissions.HasBackendPermission),
// porque el frontend siempre se puede inspeccionar/editar desde las devtools.
export function RequireMenuAccess() {
  const { user } = useAuth()
  const location = useLocation()

  // RequireAuth ya garantiza sesión activa antes de llegar acá; este chequeo es solo
  // defensivo por si el estado todavía no cargó el usuario.
  if (!user) return <Navigate to="/login" replace />

  // "/" (Dashboard) siempre queda accesible: es el destino de todo redirect/fallback
  // (ver el catch-all de App.tsx), así que bloquearlo también podría generar un loop.
  if (location.pathname === "/") return <Outlet />

  const subject = subjectForPath(location.pathname)
  const allowedSubjects = collectSubjects(user.menus)
  if (!subject || !allowedSubjects.has(subject)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
