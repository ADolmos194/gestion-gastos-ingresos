import { Infinity as InfinityIcon } from "lucide-react"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Link, useLocation, useNavigate } from "react-router"

import { ApiError, login } from "@/lib/api"
import { AUTH_TRANSITION_DELAY_MS, useAuth } from "@/lib/auth-context"
import { toastPromise, toastSuccess } from "@/lib/toast"
import { cn, withMinDuration } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// Tiempo que se deja ver el toast de "sesión iniciada" (ya en verde, con el ícono de éxito)
// antes de navegar al dashboard. Sin esto, el toast pasa a éxito justo cuando se navega y
// nunca se llega a percibir — se ve como si entrara al sistema sin terminar de validar.
const SUCCESS_TOAST_SETTLE_MS = 700

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { completeLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as
    | { from?: { pathname?: string }; successMessage?: string }
    | null

  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Ref, no state: evita que StrictMode (doble-invocación de efectos en dev) muestre
  // el mismo toast dos veces al montar.
  const shownSuccessMessage = useRef(false)
  useEffect(() => {
    if (shownSuccessMessage.current) return
    if (locationState?.successMessage) {
      shownSuccessMessage.current = true
      toastSuccess(locationState.successMessage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      // withMinDuration: aunque el backend responda casi al instante (localhost), el toast
      // de "validando…" queda visible un mínimo perceptible antes de pasar a éxito/error.
      // Importante: acá NO se toca el estado global de auth (completeLogin se llama recién
      // al final) — si se llamara antes, RedirectIfAuthenticated navegaría solo apenas el
      // backend responde, sin esperar nada de lo que pasa acá abajo.
      const user = await toastPromise(withMinDuration(login(identifier, password), AUTH_TRANSITION_DELAY_MS), {
        loading: "Validando credenciales…",
        success: "Sesión iniciada correctamente.",
        error: (err) =>
          err instanceof ApiError ? err.message : "No se pudo conectar con el servidor.",
      })
      await new Promise((resolve) => setTimeout(resolve, SUCCESS_TOAST_SETTLE_MS))
      completeLogin(user)
      navigate(locationState?.from?.pathname ?? "/", { replace: true })
    } catch (err) {
      // El toast de error ya lo muestra toastPromise; acá solo falta el caso especial de
      // cuenta no verificada, que además de avisar redirige a la pantalla de verificación.
      if (
        err instanceof ApiError &&
        err.status === 403 &&
        (err.data as { reason?: string })?.reason === "email_not_verified"
      ) {
        const email = (err.data as { email?: string }).email ?? identifier
        navigate("/verify-email", { state: { email } })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form className="p-6 md:p-8" onSubmit={handleSubmit}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Bienvenido de nuevo</h1>
                <p className="text-balance text-muted-foreground">
                  Ingresa a tu cuenta de Gastos e Ingresos
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="email">Correo</FieldLabel>
                <Input
                  id="email"
                  type="text"
                  autoComplete="username"
                  placeholder="tucorreo@ejemplo.com"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                  <Link
                    to="/forgot-password"
                    className="ml-auto text-sm underline-offset-4 hover:underline"
                  >
                    ¿Olvidaste tu contraseña?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Ingresando…" : "Ingresar"}
                </Button>
              </Field>
              <FieldSeparator>O continúa con</FieldSeparator>
              <Field className="grid grid-cols-3 gap-4">
                <Button variant="outline" type="button" disabled>
                  <AppleIcon />
                  <span className="sr-only">Ingresar con Apple</span>
                </Button>
                <Button variant="outline" type="button" disabled>
                  <GoogleIcon />
                  <span className="sr-only">Ingresar con Google</span>
                </Button>
                <Button variant="outline" type="button" disabled>
                  <InfinityIcon />
                  <span className="sr-only">Ingresar con Meta</span>
                </Button>
              </Field>
              <FieldDescription className="text-center">
                ¿No tienes una cuenta? <Link to="/register">Regístrate</Link>
              </FieldDescription>
            </FieldGroup>
          </form>
          <div className="relative hidden bg-muted md:block">
            <img
              src="/placeholder.svg"
              alt="Image"
              className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
            />
          </div>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        Al continuar, aceptas nuestros <a href="#">Términos de servicio</a> y{" "}
        <a href="#">Política de privacidad</a>.
      </FieldDescription>
    </div>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.09l.01-.01ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48Z" />
    </svg>
  )
}
