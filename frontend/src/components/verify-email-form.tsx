import { useState, type FormEvent } from "react"
import { Link, useLocation, useNavigate, useSearchParams } from "react-router"

import { parseApiError, resendVerification, verifyEmail } from "@/lib/api"
import { toastError, toastSuccess } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function VerifyEmailForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialEmail =
    (location.state as { email?: string } | null)?.email ?? searchParams.get("email") ?? ""

  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      await verifyEmail(email, code)
      navigate("/login", {
        state: { successMessage: "Cuenta verificada correctamente. Ya puedes iniciar sesión." },
      })
    } catch (err) {
      toastError(parseApiError(err).general ?? "El código es inválido o ha expirado.")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResend() {
    setIsResending(true)
    try {
      const result = await resendVerification(email)
      toastSuccess(result.detail)
    } catch (err) {
      toastError(parseApiError(err).general ?? "No se pudo reenviar el código.")
    } finally {
      setIsResending(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-0">
          <form className="p-6 md:p-8" onSubmit={handleSubmit}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">Verifica tu cuenta</h1>
                <p className="text-balance text-muted-foreground">
                  Ingresa el código de 6 dígitos que te enviamos por correo
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="email">Correo</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  readOnly={Boolean(initialEmail)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="code">Código de verificación</FieldLabel>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  required
                />
              </Field>
              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Verificando…" : "Verificar cuenta"}
                </Button>
              </Field>
              <FieldDescription className="text-center">
                ¿No te llegó el código?{" "}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={isResending || !email}
                  className="underline underline-offset-4 disabled:opacity-50"
                >
                  {isResending ? "Reenviando…" : "Reenviar código"}
                </button>
              </FieldDescription>
              <FieldDescription className="text-center">
                <Link to="/login">Volver a iniciar sesión</Link>
              </FieldDescription>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
