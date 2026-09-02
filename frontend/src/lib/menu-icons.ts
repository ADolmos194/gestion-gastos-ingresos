import * as LucideIcons from "lucide-react"
import { CircleIcon, type LucideIcon } from "lucide-react"

export const UNOCSS_ICON_PREFIX = "i-lucide-"

function toPascalCase(kebabCase: string): string {
  return kebabCase
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

// El menú viene del backend con iconos en formato clase UnoCSS ("i-lucide-layout-dashboard",
// ver seed_menu.json); acá se resuelve al componente equivalente de lucide-react
// ("LayoutDashboardIcon"). Si la clave no matchea ningún ícono conocido, cae a CircleIcon.
export function iconFromKey(icon: string | null | undefined): LucideIcon {
  if (!icon) return CircleIcon
  const key = icon.startsWith(UNOCSS_ICON_PREFIX) ? icon.slice(UNOCSS_ICON_PREFIX.length) : icon
  const componentName = `${toPascalCase(key)}Icon`
  const component = (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[componentName]
  return component ?? CircleIcon
}
