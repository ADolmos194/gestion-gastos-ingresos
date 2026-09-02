import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router"

import { parseApiError, register } from "@/lib/api"
import { toastError, toastSuccess } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function RegisterForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const navigate = useNavigate()

  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldErrors({})

    if (password !== confirmPassword) {
      setFieldErrors({ confirm_password: ["Las contraseñas no coinciden."] })
      return
    }

    setIsSubmitting(true)
    try {
      await register({
        username,
        email,
        first_name: firstName,
        last_name: lastName,
        password,
      })
      toastSuccess("Cuenta creada. Te enviamos un código de verificación por correo.")
      navigate("/verify-email", { state: { email } })
    } catch (err) {
      const parsed = parseApiError(err)
      if (parsed.general) toastError(parsed.general)
      setFieldErrors(parsed.fields)
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
                <h1 className="text-2xl font-bold">Crea tu cuenta</h1>
                <p className="text-balance text-muted-foreground">
                  Regístrate para empezar a usar Gastos e Ingresos
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="username">Usuario</FieldLabel>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
                <FieldError errors={fieldErrors.username?.map((message) => ({ message }))} />
              </Field>
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
                <FieldError errors={fieldErrors.email?.map((message) => ({ message }))} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="first_name">Nombre</FieldLabel>
                  <Input
                    id="first_name"
                    type="text"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                  />
                  <FieldError errors={fieldErrors.first_name?.map((message) => ({ message }))} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="last_name">Apellido</FieldLabel>
                  <Input
                    id="last_name"
                    type="text"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                  />
                  <FieldError errors={fieldErrors.last_name?.map((message) => ({ message }))} />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <FieldError errors={fieldErrors.password?.map((message) => ({ message }))} />
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
                  {isSubmitting ? "Creando cuenta…" : "Crear cuenta"}
                </Button>
              </Field>
              <FieldDescription className="text-center">
                ¿Ya tienes una cuenta? <Link to="/login">Inicia sesión</Link>
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
    </div>
  )
}
