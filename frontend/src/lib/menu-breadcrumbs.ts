import type { MenuItem } from "@/lib/api"
import { toRoutePath } from "@/lib/menu-routes"

export interface BreadcrumbEntry {
  label: string
  href?: string
  icon: string | null
}

// Busca el nodo cuyo "subject" coincide (identificador único real, ver Menu.subject en
// el backend) y arma el breadcrumb con el title de cada ancestro + el propio — así
// ninguna página tiene que declarar su breadcrumb a mano (ver AppLayout).
export function breadcrumbsForSubject(menus: MenuItem[], subject: string | undefined): BreadcrumbEntry[] {
  if (!subject) return []

  function search(nodes: MenuItem[], trail: MenuItem[]): MenuItem[] | null {
    for (const node of nodes) {
      const nextTrail = [...trail, node]
      if (node.subject === subject) return nextTrail
      const found = search(node.children, nextTrail)
      if (found) return found
    }
    return null
  }

  const trail = search(menus, [])
  if (!trail) return []

  return trail.map((node, index) => ({
    label: node.title,
    // El último ítem es la página actual: nunca se muestra como link.
    href: index < trail.length - 1 ? toRoutePath(node.to) : undefined,
    icon: node.icon,
  }))
}
