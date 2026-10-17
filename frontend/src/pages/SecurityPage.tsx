import { useEffect, useState, type FormEvent } from "react"
import { Mail, MonitorSmartphone, ShieldCheck, ShieldHalf, TriangleAlert } from "lucide-react"

import { AppLayout } from "@/components/app-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  activeSessions,
  changeEmailConfirm,
  changeEmailRequest,
  logoutAllSessions,
  revokeSession,
  twoFactorConfirm,
  twoFactorDisable,
  twoFactorRegenerateRecovery,
  twoFactorSetup,
  twoFactorStatus,
  type ActiveSession,
} from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { toastError, toastPromise, toastSuccess } from "@/lib/toast"

// "Seguridad" no es una página de menú (no vive en sec_menu), así que no entra en el
// breadcrumb del AppLayout: el título se declara acá dentro, en el contenido.
export default function SecurityPage() {
  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-heading text-xl font-semibold">Seguridad</h1>
          <p className="text-sm text-muted-foreground">
            Administrá tu correo, la verificación en dos pasos y tus sesiones activas.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <EmailCard />
          <TwoFactorCard />
          <SessionsCard />
        </div>
      </div>
    </AppLayout>
  )
}

// ---- Correo electrónico -----------------------------------------------------

function EmailCard() {
  const { user } = useAuth()
  const [changing, setChanging] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [step, setStep] = useState<"idle" | "code">("idle")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [savedEmail, setSavedEmail] = useState(user?.user_info.email ?? "")

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newEmail.trim()) return
    setBusy(true)
    try {
      await toastPromise(changeEmailRequest(newEmail.trim()), {
        loading: "Enviando código al nuevo correo…",
        success: "Código enviado. Revisá la nueva dirección.",
        error: (err) => (err instanceof Error ? err.message : "No se pudo completar la operación."),
      })
      setStep("code")
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    try {
      const result = await toastPromise(changeEmailConfirm(newEmail.trim(), code.trim()), {
        loading: "Confirmando correo…",
        success: "Correo actualizado correctamente.",
        error: (err) => (err instanceof Error ? err.message : "No se pudo completar la operación."),
      })
      setSavedEmail(result.email)
      setStep("idle")
      setNewEmail("")
      setCode("")
      setChanging(false)
    } finally {
      setBusy(false)
    }
  }

  if (!changing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-4 text-muted-foreground" /> Correo electrónico
          </CardTitle>
          <CardDescription>Dirección en la que recibís los códigos de verificación.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <span className="truncate text-sm">{savedEmail}</span>
          <Button variant="outline" type="button" onClick={() => setChanging(true)}>
            Cambiar correo
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" /> Cambiar correo electrónico
        </CardTitle>
        <CardDescription>
          Te enviamos un código a la <strong>nueva</strong> dirección para confirmar que es tuya.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === "idle" ? (
          <form onSubmit={handleRequest} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="new-email">Nuevo correo</FieldLabel>
              <Input
                id="new-email"
                type="email"
                autoComplete="email"
                placeholder="nuevo@ejemplo.com"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                required
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Enviando…" : "Enviar código"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setChanging(false)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleConfirm} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="email-code">Código recibido en {newEmail.trim()}</FieldLabel>
              <Input
                id="email-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Código de 6 dígitos"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Confirmando…" : "Confirmar"}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep("idle")}>
                Volver
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

// ---- Verificación en dos pasos ---------------------------------------------

function TwoFactorCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [phase, setPhase] = useState<"idle" | "setup" | "disable" | "regen">("idle")
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)

  async function refreshStatus() {
    try {
      const status = await twoFactorStatus()
      setEnabled(status.enabled)
      if (!status.enabled) {
        setPhase("idle")
        setSetup(null)
        setRecoveryCodes(null)
      }
    } catch {
      setEnabled(null)
    }
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  async function handleStartSetup() {
    setBusy(true)
    try {
      setSetup(
        await toastPromise(twoFactorSetup(), {
          loading: "Generando secreto…",
          success: "Escaneá el código o ingresalo manualmente.",
          error: (err) => (err instanceof Error ? err.message : "No se pudo completar la operación."),
        })
      )
      setPhase("setup")
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    try {
      const result = await toastPromise(twoFactorConfirm(code.trim()), {
        loading: "Activando 2FA…",
        success: "Verificación en dos pasos activada.",
        error: (err) => (err instanceof Error ? err.message : "No se pudo completar la operación."),
      })
      setRecoveryCodes(result.recovery_codes)
      setCode("")
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    try {
      await toastPromise(twoFactorDisable(code.trim()), {
        loading: "Desactivando 2FA…",
        success: "Verificación en dos pasos desactivada.",
        error: (err) => (err instanceof Error ? err.message : "No se pudo completar la operación."),
      })
      setCode("")
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }

  async function handleRegenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!code.trim()) return
    setBusy(true)
    try {
      const result = await toastPromise(twoFactorRegenerateRecovery(code.trim()), {
        loading: "Generando códigos nuevos…",
        success: "Códigos de respaldo regenerados.",
        error: (err) => (err instanceof Error ? err.message : "No se pudo completar la operación."),
      })
      setRecoveryCodes(result.recovery_codes)
      setCode("")
      setPhase("idle")
    } finally {
      setBusy(false)
    }
  }

  function copyRecoveryCodes() {
    if (!recoveryCodes) return
    navigator.clipboard
      .writeText(recoveryCodes.join("\n"))
      .then(() => toastSuccess("Códigos copiados al portapapeles."))
      .catch(() => toastError("No se pudieron copiar los códigos."))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldHalf className="size-4 text-muted-foreground" /> Verificación en dos pasos
        </CardTitle>
        <CardDescription>
          Protegé el inicio de sesión con una app de autenticación (Google Authenticator, Authy, …).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm">
            {enabled === true && (
              <>
                <ShieldCheck className="size-4 text-emerald-500" />
                Activado
              </>
            )}
            {enabled === false && "Desactivado"}
            {enabled === null && "Cargando…"}
          </span>
          {enabled === false && phase === "idle" && (
            <Button type="button" onClick={handleStartSetup} disabled={busy}>
              Activar
            </Button>
          )}
        </div>

        {phase === "setup" && setup && !enabled && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">
                Ingresá el secreto manualmente en tu app de autenticación, o usá esta URL:
              </p>
              <code className="break-all rounded bg-background p-2 text-xs">{setup.otpauth_url}</code>
              <div className="flex items-center justify-between gap-3">
                <code className="rounded bg-background px-2 py-1 text-sm tracking-widest">
                  {setup.secret.match(/.{1,4}/g)?.join(" ") ?? setup.secret}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(setup.secret)
                      .then(() => toastSuccess("Secreto copiado."))
                      .catch(() => toastError("No se pudo copiar el secreto."))
                  }
                >
                  Copiar
                </Button>
              </div>
            </div>
            <form onSubmit={handleConfirm} className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="2fa-code">Código de la app</FieldLabel>
                <Input
                  id="2fa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Código de 6 dígitos"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
                <FieldDescription>
                  Confirmá con el primer código que genere tu app para activar el 2FA.
                </FieldDescription>
              </Field>
              <Button type="submit" disabled={busy}>
                {busy ? "Confirmando…" : "Activar 2FA"}
              </Button>
            </form>
          </div>
        )}

        {recoveryCodes && (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-muted/40 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <TriangleAlert className="size-4" /> Guardá estos códigos ahora
            </p>
            <p className="text-sm text-muted-foreground">
              Cada código funciona una sola vez y el backend no los vuelve a mostrar. Sin ellos,
              si perdés el acceso a la app de autenticación podés quedar fuera de tu cuenta.
            </p>
            <code className="block whitespace-pre-wrap rounded bg-background p-3 font-mono text-xs leading-relaxed">
              {recoveryCodes.join("\n")}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copyRecoveryCodes}>
              Copiar códigos
            </Button>
          </div>
        )}

        {enabled === true && !recoveryCodes && (
          <>
            <Separator />
            <form onSubmit={handleDisable} className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="2fa-disable-code">Código para confirmar</FieldLabel>
                <Input
                  id="2fa-disable-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Código de 6 dígitos"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setPhase("regen")} disabled={busy}>
                  Regenerar códigos de respaldo
                </Button>
                <Button type="submit" variant="destructive" disabled={busy}>
                  {busy ? "Desactivando…" : "Desactivar 2FA"}
                </Button>
              </div>
            </form>
          </>
        )}

        {phase === "regen" && enabled === true && !recoveryCodes && (
          <form onSubmit={handleRegenerate} className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="2fa-regen-code">Código de la app</FieldLabel>
              <Input
                id="2fa-regen-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Código de 6 dígitos"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
              <FieldDescription>
                Regenerar invalida todos los códigos de respaldo anteriores.
              </FieldDescription>
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Generando…" : "Regenerar"}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setPhase("idle")}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

// ---- Sesiones activas -------------------------------------------------------

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })
  } catch {
    return "—"
  }
}

function SessionsCard() {
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const result = await activeSessions()
      setSessions(result.sessions)
    } catch {
      toastError("No se pudieron cargar las sesiones.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleRevoke(id: string) {
    setBusy(true)
    try {
      await toastPromise(revokeSession(id), {
        loading: "Cerrando sesión…",
        success: "Sesión cerrada.",
        error: (err) => (err instanceof Error ? err.message : "No se pudo completar la operación."),
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function handleLogoutAll() {
    setBusy(true)
    try {
      await toastPromise(logoutAllSessions(), {
        loading: "Cerrando sesiones…",
        success: (result) => result.detail,
        error: (err) => (err instanceof Error ? err.message : "No se pudo completar la operación."),
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="size-4 text-muted-foreground" /> Sesiones activas
        </CardTitle>
        <CardDescription>
          Dispositivos y pestañas donde tu cuenta está iniciada. Cerrá cualquiera excepto la actual.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando sesiones…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay sesiones activas.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {session.user_agent ? session.user_agent.slice(0, 80) : "Navegador"}
                    </span>
                    {session.current && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        Esta sesión
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {session.ip ? `IP ${session.ip} · ` : ""}
                    último uso {formatDateTime(session.last_seen)} · expira{" "}
                    {formatDateTime(session.expires_at)}
                  </p>
                </div>
                {!session.current && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => handleRevoke(session.id)}
                  >
                    Cerrar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="destructive" disabled={busy || sessions.length === 0} onClick={handleLogoutAll}>
            Cerrar sesión en los demás dispositivos
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setLoading(true)
              await load()
            }}
          >
            Recargar
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}