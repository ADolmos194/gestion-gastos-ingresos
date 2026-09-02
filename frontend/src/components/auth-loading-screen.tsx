import { Loader2 } from "lucide-react"

export function AuthLoadingScreen() {
  return (
    <div className="flex min-h-svh w-full flex-col items-center justify-center gap-3">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Cargando…</p>
    </div>
  )
}
