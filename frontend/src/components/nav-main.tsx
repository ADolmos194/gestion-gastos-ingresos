import type { LucideIcon } from "lucide-react"
import { ChevronRightIcon } from "lucide-react"
import { Link, useLocation } from "react-router"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

export interface NavMainItem {
  id: string
  title: string
  url?: string
  icon: LucideIcon
  items?: NavMainItem[]
}

export function NavMain({ items }: { items: NavMainItem[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Menú</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <NavMainNode key={item.id} item={item} isTopLevel />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

// Recursivo: el árbol de menú del backend puede tener más de 2 niveles (p.ej.
// Configuraciones > Maestras > Categorías), a diferencia del NavMain original que solo
// soportaba ítem raíz + un nivel de subítems.
function NavMainNode({ item, isTopLevel }: { item: NavMainItem; isTopLevel: boolean }) {
  const location = useLocation()
  const Icon = item.icon
  const children = item.items ?? []

  const ItemWrapper = isTopLevel ? SidebarMenuItem : SidebarMenuSubItem
  const Button = isTopLevel ? SidebarMenuButton : SidebarMenuSubButton

  if (children.length === 0) {
    return (
      <ItemWrapper>
        <Button
          tooltip={isTopLevel ? item.title : undefined}
          isActive={item.url ? location.pathname === item.url : false}
          render={item.url ? <Link to={item.url} /> : undefined}
        >
          <Icon />
          <span>{item.title}</span>
        </Button>
      </ItemWrapper>
    )
  }

  return (
    <Collapsible defaultOpen={false} className="group/collapsible" render={<ItemWrapper />}>
      {/* Siempre SidebarMenuButton (renderiza <button> nativo): Base UI exige que el
          trigger de un Collapsible sea un botón real, y SidebarMenuSubButton por defecto
          renderiza un <a>, aunque el grupo esté anidado dentro de un SidebarMenuSub. */}
      <CollapsibleTrigger render={<SidebarMenuButton tooltip={isTopLevel ? item.title : undefined} />}>
        <Icon />
        <span>{item.title}</span>
        <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {children.map((child) => (
            <NavMainNode key={child.id} item={child} isTopLevel={false} />
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}
