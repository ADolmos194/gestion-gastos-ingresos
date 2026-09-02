import * as LucideIcons from "lucide-react"

function toKebabCase(pascalCase: string): string {
  return pascalCase
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
}

// Todos los nombres de ícono (kebab-case, sin el prefijo "i-lucide-") que
// src/lib/menu-icons.ts#iconFromKey puede resolver — se derivan de los mismos exports
// "*Icon" de lucide-react. El Set es necesario: lucide-react tiene exports con distinta
// capitalización (p.ej. dos variantes de "ArrowUpAZ") que el kebab-case termina igualando
// — sin dedupear, esos nombres repetidos rompían el `key` de React en IconPickerDialog.
export const LUCIDE_ICON_NAMES: string[] = [
  ...new Set(
    Object.keys(LucideIcons)
      .filter((key) => key.endsWith("Icon") && key !== "Icon" && key !== "LucideIcon")
      .map((key) => toKebabCase(key.slice(0, -"Icon".length)))
  ),
].sort()
