// El seed usa "root" como alias de la ruta raíz (convención heredada de un router con
// rutas con nombre); el resto de los "to" del menú se usan directo como path de la URL
// (mismo valor que router_to en el backend y que la clave en lib/page-routes.tsx).
export function toRoutePath(to: string | null | undefined): string | undefined {
  if (!to) return undefined
  if (to === "root") return "/"
  return to.startsWith("/") ? to : `/${to}`
}
