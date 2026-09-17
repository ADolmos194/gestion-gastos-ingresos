import { lazy } from "react"

export interface PageRouteEntry {
  path: string
  component: React.LazyExoticComponent<() => React.JSX.Element>
}

// Registro único de páginas autenticadas. La clave es el Menu.subject del backend — el
// identificador único real de cada ítem del menú (constraint unique en sec_menu, ver
// seed_menu.json), no la URL: el path es solo un dato más que cuelga de ese subject,
// igual que el title o el icon. App.tsx genera los <Route> iterando esto; los
// breadcrumbs (ver menu-breadcrumbs.ts) y RequireMenuAccess resuelven contra el mismo
// subject en vez de compararse por string de URL.
export const pageRoutes: Record<string, PageRouteEntry> = {
  "GI-Dashboard": {
    path: "/",
    component: lazy(() => import("@/pages/DashboardPage")),
  },
  "GI-FinMovimientos": {
    path: "/finanzas/movimientos",
    component: lazy(() => import("@/pages/finanzas/movimientos/MovimientosPage")),
  },
  "GI-ConfigCategorias": {
    path: "/config/maestras/categorias",
    component: lazy(() => import("@/pages/config/maestras/CategoriasPage")),
  },
  "GI-ConfigCuentas": {
    path: "/config/maestras/cuentas",
    component: lazy(() => import("@/pages/config/maestras/CuentasPage")),
  },
  "GI-ConfigMonedas": {
    path: "/config/maestras/monedas",
    component: lazy(() => import("@/pages/config/maestras/MonedasPage")),
  },
  "GI-SegUsuarios": {
    path: "/seguridad/maestras/usuarios",
    component: lazy(() => import("@/pages/seguridad/maestras/UsuariosPage")),
  },
  "GI-SegRoles": {
    path: "/seguridad/maestras/roles",
    component: lazy(() => import("@/pages/seguridad/maestras/RolesPage")),
  },
  "GI-SegMenus": {
    path: "/seguridad/maestras/menus",
    component: lazy(() => import("@/pages/seguridad/maestras/MenusPage")),
  },
  "GI-SegPermisos": {
    path: "/seguridad/maestras/permisos",
    component: lazy(() => import("@/pages/seguridad/maestras/PermisosPage")),
  },
}

// Reverso: URL -> subject. Sirve para ir de "en qué página estoy" (location.pathname) a
// "qué ítem del menú es" (subject) — lo usan tanto RequireMenuAccess como los breadcrumbs.
const PATH_TO_SUBJECT: Record<string, string> = Object.fromEntries(
  Object.entries(pageRoutes).map(([subject, entry]) => [entry.path, subject])
)

export function subjectForPath(pathname: string): string | undefined {
  return PATH_TO_SUBJECT[pathname]
}
