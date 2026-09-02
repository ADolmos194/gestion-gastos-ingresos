"use client"

import * as React from "react"
import { GalleryVerticalEndIcon } from "lucide-react"

import { NavMain, type NavMainItem } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail, useSidebar } from "@/components/ui/sidebar"
import { useAuth } from "@/lib/auth-context"
import type { MenuItem } from "@/lib/api"
import { iconFromKey } from "@/lib/menu-icons"
import { toRoutePath } from "@/lib/menu-routes"

const team = {
  name: "Gastos e Ingresos",
  logo: <GalleryVerticalEndIcon />,
  plan: "Personal",
}

function toNavMainItem(menu: MenuItem): NavMainItem {
  return {
    id: menu.id,
    title: menu.title,
    url: toRoutePath(menu.to),
    icon: iconFromKey(menu.icon),
    items: menu.children.length > 0 ? menu.children.map(toNavMainItem) : undefined,
  }
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user } = useAuth()
  const { isMobile } = useSidebar()
  const navItems = React.useMemo(() => (user?.menus ?? []).map(toNavMainItem), [user])

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={[team]} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} />
      </SidebarContent>
      {/* En desktop el usuario/cerrar sesión vive en el header (ver app-layout.tsx); acá
          solo aparece en celular, adentro del menú hamburguesa, para no duplicarlo. */}
      {isMobile && (
        <SidebarFooter>
          <NavUser
            user={{
              name: user ? `${user.user_info.name} ${user.user_info.last_name}`.trim() : "",
              email: user?.user_info.email ?? "",
              avatar: "",
            }}
          />
        </SidebarFooter>
      )}
      <SidebarRail />
    </Sidebar>
  )
}
