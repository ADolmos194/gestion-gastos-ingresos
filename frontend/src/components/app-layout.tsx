import { Fragment, type ReactNode } from "react"
import { Link, useLocation } from "react-router"

import { AppSidebar } from "@/components/app-sidebar"
import { NavUser } from "@/components/nav-user"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { useIsMobile } from "@/hooks/use-mobile"
import { useAuth } from "@/lib/auth-context"
import { breadcrumbsForSubject } from "@/lib/menu-breadcrumbs"
import { iconFromKey } from "@/lib/menu-icons"
import { subjectForPath } from "@/lib/page-routes"

// Shell común a toda página autenticada: sidebar + navbar (con el breadcrumb de la página
// actual y el usuario/logout a la derecha) + contenido. El breadcrumb se arma solo a partir
// de la URL y del árbol de menú del usuario (ver lib/menu-breadcrumbs.ts) — ninguna página
// lo declara a mano.
//
// `headerActions` es un slot opcional para la barra de íconos (la de CrudGrid, por
// ejemplo), a la derecha en la fila de contenido. `summary` es el slot que queda en el
// lugar que dejó libre el breadcrumb en esa misma fila (a la izquierda) — pensado para los
// conteos de filas de CrudGrid, pero cualquier página puede usarlo.
export function AppLayout({
  children,
  headerActions,
  summary,
}: {
  children?: ReactNode
  headerActions?: ReactNode
  summary?: ReactNode
}) {
  const { user } = useAuth()
  const isMobile = useIsMobile()
  const location = useLocation()
  const subject = subjectForPath(location.pathname)
  const breadcrumbs = breadcrumbsForSubject(user?.menus ?? [], subject)
  // Ícono de la página actual (el último tramo del breadcrumb), tomado del mismo menú que
  // ya usa el sidebar — no hay que declararlo a mano por página.
  const currentCrumb = breadcrumbs[breadcrumbs.length - 1]
  const CurrentIcon = iconFromKey(currentCrumb?.icon)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          {/* El Separator base trae "data-vertical:self-stretch" (para llenar el alto del
              contenedor cuando no se le da un h-* explícito); acá sí le damos h-4, así que
              hay que pisar ese mismo variant (no "self-center" a secas, que pierde contra
              el que ya trae el componente) para que quede centrado en vez de pegado arriba. */}
          <Separator orientation="vertical" className="mr-2 h-4 data-vertical:self-center" />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <CurrentIcon className="size-4 shrink-0 text-muted-foreground" />
            {isMobile ? (
              // En celular no entra el trayecto completo del breadcrumb (y el usuario ya no
              // está acá, ver más abajo) — alcanza con el nombre de la página actual, como
              // título de la pantalla.
              <span className="truncate font-heading text-base font-medium text-foreground">
                {currentCrumb?.label}
              </span>
            ) : (
              <Breadcrumb>
                <BreadcrumbList>
                  {breadcrumbs.map((crumb, index) => (
                    <Fragment key={crumb.label}>
                      <BreadcrumbItem>
                        {crumb.href ? (
                          <BreadcrumbLink render={<Link to={crumb.href} />}>{crumb.label}</BreadcrumbLink>
                        ) : (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        )}
                      </BreadcrumbItem>
                      {index < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
                    </Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
            )}
          </div>
          {/* En celular el usuario/cerrar sesión se mueve al menú hamburguesa (ver
              SidebarFooter en app-sidebar.tsx) — acá solo queda en desktop. */}
          {!isMobile && (
            <div className="ml-auto">
              <NavUser
                user={{
                  name: user ? `${user.user_info.name} ${user.user_info.last_name}`.trim() : "",
                  email: user?.user_info.email ?? "",
                  avatar: "",
                }}
              />
            </div>
          )}
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">
          {/* Contadores e íconos son cada uno un bloque de una sola línea (ver `counters` y
              `toolbar` en crud-grid.tsx, ninguno de los dos wrappea puertas adentro). Van
              pegados uno al lado del otro (sin justify-between) para que el ícono de lupa
              quede cerca de "nuevas", no empujado al otro extremo de la pantalla. Acá afuera
              sí se permite wrap: si no entran los dos bloques juntos, el segundo cae entero a
              una segunda línea — nunca se corta a la mitad ni queda scroll escondido, porque
              cada bloque wrappea entero o no wrappea. */}
          <div className="flex flex-wrap items-center gap-4">
            {summary}
            {headerActions}
          </div>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
