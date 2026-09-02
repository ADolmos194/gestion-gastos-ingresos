import { useState, type FormEvent } from "react"
import { Link } from "react-router"

import { forgotPassword, parseApiError, resetPassword } from "@/lib/api"
import { toastError, toastSuccess } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type Step = "email" | "code" | "done"

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      await forgotPassword(email)
      setStep("code")
    } catch (err) {
      toastError(parseApiError(err).general ?? "No se pudo procesar la solicitud.")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleConfirmReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldErrors({})

    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirm_password: ["Las contraseñas no coinciden."] })
      return
    }

    setIsSubmitting(true)
    try {
      await resetPassword(email, code, newPassword)
      toastSuccess("Contraseña actualizada correctamente.")
      setStep("done")
    } catch (err) {
      const parsed = parseApiError(err)
      if (parsed.general) toastError(parsed.general)
      setFieldErrors(parsed.fields)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (step === "done") {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card className="overflow-hidden p-0">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center md:p-8">
            <h1 className="text-2xl font-bold">Contraseña actualizada</h1>
            <p className="text-muted-foreground">
              Ya puedes iniciar sesión con tu nueva contraseña.
            </p>
            <Link to="/login" className={cn(buttonVariants(), "w-full")}>
              Ir a iniciar sesión
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (step === "code") {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <form className="p-6 md:p-8" onSubmit={handleConfirmReset}>
              <FieldGroup>
                <div className="flex flex-col items-center gap-2 text-center">
                  <h1 className="text-2xl font-bold">Revisa tu correo</h1>
                  <p className="text-balance text-muted-foreground">
                    Ingresa el código que enviamos a {email} y tu nueva contraseña
                  </p>
                </div>
                <Field>
                  <FieldLabel htmlFor="code">Código</FieldLabel>
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
                  <FieldLabel htmlFor="new_password">Nueva contraseña</FieldLabel>
                  <Input
                    id="new_password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                  />
                  <FieldError errors={fieldErrors.new_password?.map((message) => ({ message }))} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirm_password">Confirmar contraseña</FieldLabel>
                  <Input
                    id="confirm_password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                  />
                  <FieldError errors={fieldErrors.confirm_password?.map((message) => ({ message }))} />
                </Field>
                <Field>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Guardando…" : "Guardar nueva contraseña"}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-0">
          <form className="p-6 md:p-8" onSubmit={handleRequestCode}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">¿Olvidaste tu contraseña?</h1>
                <p className="text-balance text-muted-foreground">
                  Ingresa tu correo y te enviaremos un código para restablecerla
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="email">Correo</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="tucorreo@ejemplo.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Enviando…" : "Enviar código"}
                </Button>
              </Field>
              <FieldDescription className="text-center">
                ¿Recordaste tu contraseña? <Link to="/login">Inicia sesión</Link>
              </FieldDescription>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
