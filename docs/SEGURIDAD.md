# Qullqi — Seguridad: qué se hizo y qué falta

> Documento de Estado de seguridad del proyecto **Qullqi** (gestión de gastos/ingresos,
> Django + DRF + React + Postgres + Redis/Celery + nginx en Docker).
>
> Guarda lo realizado hasta el 24/09/2026: no repite contenidos, apunta a archivos concretos
> (con `path:linea` donde ayuda) para que se pueda auditar todo con un vistazo.

---

## 1. Resumen

El proyecto arrancó este ciclo con una auditoría de seguridad (altas/medias/bajas) ya
aplicada y **renombrada a "Qullqi"**. Se agregó además una segunda capa de seguridad:
**2FA TOTP**, gestión de **sesiones activas**, **cambio de correo con OTP**, límites de
velocidad en dos capas, **CI de seguridad** y **backups cifrados** — todo verificado contra
el stack real levantado en Docker.

Estado global:

| Área | Estado |
| --- | --- |
| Auditoría base (altas/medias/bajas) | ✅ Cerrada |
| Rename a Qullqi | ✅ Completo |
| 2FA + sesiones + cambio de email | ✅ Implementado y verificado |
| Rate-limit (nginx + DRF) | ✅ Implementado |
| CI/pre-commit de seguridad | ✅ Implementado |
| Backups cifrados Postgres | ✅ Implementado y probado end-to-end |
| TLS real (dominio + certbot) | ⏳ Único pendiente estructural |

---

## 2. Auditoría de seguridad (línea base)

### Altas (críticas/muy importantes)

| Hallazgo | Solución | Archivo |
| --- | --- | --- |
| `/admin/` de Django expuesto | Cerrado por defecto: `DJANGO_ENABLE_ADMIN` vacío/False → la ruta devuelve **410**. Solo se abre con `True` explícito. | `backend/config/settings.py` (`ENABLE_ADMIN`), `backend/config/urls.py` |
| Email casi siempre en la auditoría original | Rotación de la password de Gmail + SMTP con app password apuntando a `smtp.gmail.com:587`, verificado **SMTP LOGIN OK**, `EMAIL_BACKEND=smtp` | `backend/.env` (gitignored, no portar valores al repo), `backend/config/settings.py` |
| Cookies de sesión sin flags en HTTP | `Secure` y `TLS` parametrizados por env (`SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE`, default `not DEBUG`); `HttpOnly=True`, `SameSite=Lax`; aviso al arranque si falta TLS real | `backend/config/settings.py:199-214` |
| `server_tokens` (fuga de versión de nginx) | `server_tokens off;` en ambos server blocks | `nginx/nginx.conf:13,41` |

### Medias

| Hallazgo | Solución | Archivo |
| --- | --- | --- |
| Inyección de fórmulas al importar/exportar Excel | Sanitización: toda celda cuyo texto arranque con `= + - @ tab CR LF NUL` se le antepone `'`. Aplica a `openpyxl` (xlsx) y al armado de `DataFrame`. 3 tests en verde. | `backend/apps/configuraciones/excel_utils.py` (+ `test_excel_utils.py`) |
| `DEBUG=True` commitado | Default **`False`** (`env_bool('DJANGO_DEBUG', False)`); dev lo abre vía `backend/.env` (`True`). Verificado en ambos escenarios. | `backend/config/settings.py` |
| Redis sin contraseña | `requirepass` con password fuerte generada; healthcheck autenticado; Celery apunta a `redis://:${REDIS_PASSWORD}@redis:6379/0`; compose exige la variable (`:?`). | `docker-compose.yml:53`, `backend/.env`, `backend/.env.example` |
| Credenciales del stack | `DB_PASSWORD` y `REDIS_PASSWORD` fuertes generadas. `backend/.env` y `frontend/.env` están en `.gitignore`. | `.gitignore` |

### Bajas

| Hallazgo | Solución | Archivo |
| --- | --- | --- |
| `VITE_SYSTEM_KEY` expuesta en el front | Variable eliminada (grep global: 0 coincidencias). | `frontend/.env`, `.env.example`, `vite-env.d.ts` |
| Registro abierto (endpoint público) | Gated con `DJANGO_ALLOW_REGISTRATION` (default **False**; dev `True`; el compose raíz fuerza `False`). `RegisterView` devuelve **403** cuando está cerrado (verificado). | `backend/config/settings.py`, `backend/apps/autenticacion/views.py:159` |

### Defensa en profundidad ya presente

- **Headers**: CSP (`frame-ancestors 'none'`, `object-src 'none'`…), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` — desde Django (respuestas API) y desde nginx (SPA). `nginx/locations.conf`.
- **Auth por sesión**: cookies de sesión Django (no tokens anónimos), CSRF double-submit (`X-CSRFToken`), `IsAuthenticatedOrFreeApi`.
- **Bloqueo de cuenta**: 3 intentos fallidos → bloqueo; se resetea en login exitoso (señales). `backend/apps/autenticacion/signals.py`.
- **`check --deploy`**: solo advertencias esperadas W004/W008 (TLS no activable sin dominio).
- **Contenedores no-root**: backend/worker corren como `USER app`. `backend/Dockerfile:27`.

---

## 3. Segunda capa: 2FA, sesiones, cambio de email

### 3.1 Autenticación de dos pasos (TOTP)

| Pieza | Detalle |
| --- | --- |
| Algoritmo | TOTP (RFC 6238, `pyotp`), ventana ±1 step. |
| Modelo `User` | `otp_secret` (solo en setup), `otp_enabled`, `otp_recovery_codes` (**hash sha256**, JSONField). |
| Códigos de respaldo | 10 × 16 caracteres base32, uso **único** (se consumen al usarse), se muestran una sola vez al activar/regenerar. |
| Login en 2 pasos | `LoginView` responde `202 {reason: "otp_required"}` y guarda `pending_otp_user_id` + expiración (TTL 5 min, `TWO_FA_LOGIN_TTL_SECONDS`) en la sesión **anónima**; `LoginOtpView` valida TOTP/respaldo y recién ahí crea la sesión. |
| Protección de las acciones | Activar / desactivar / regenerar respaldos requieren TOTP válido (una sesión robada no puede apagar el 2FA). |
| Rutas | `2fa/status/`, `2fa/setup/`, `2fa/confirm/`, `2fa/disable/`, `2fa/recovery/regenerate/`, `login/2fa/` |
| Throttle | `'2fa': '5/min'` |

Archivos: `backend/apps/autenticacion/two_factor.py` (lógica), `views.py` (LoginOtpView/TwoFactor*), `models.py`, `serializers.py`, `urls.py`, `middleware.py` (ruta libre `login/2fa/`), `config/settings.py` (`TWO_FA_*`).

### 3.2 Sesiones activas

- `SessionMetaMiddleware` guarda `device_info` (IP, user-agent, última actividad) en cada request autenticado (`SESSION_SAVE_EVERY_REQUEST=True`).
- `ActiveSessionsView` lista las sesiones del usuario (la actual marcada `current`); `RevokeSessionView` cierra una puntual (nunca la actual); `LogoutAllSessionsView` cierra todas menos la actual.
- El id que expone el API es un prefijo de 16 hex del **sha256 de la session key** (la key real nunca se expone ni se loguea).

### 3.3 Cambio de correo

- `ChangeEmailRequestView`: valida que el nuevo correo no esté en uso y envía OTP a la **nueva** dirección; `ChangeEmailConfirmView` lo valida y persiste (`Purpose.CHANGE_EMAIL`).
- Throttle `'change_email': '3/hour'`. La cuenta sigue con el email actual hasta confirmar.

### 3.4 Frontend

| Pieza | Archivo |
| --- | --- |
| Paso 2FA en el login (202 → input de código → `loginOtp`) | `frontend/src/components/login-form.tsx` |
| `SecurityPage` (`/seguridad`): correo, 2FA (setup/confirm/disable/recovery) y sesiones | `frontend/src/pages/SecurityPage.tsx` |
| Acceso desde el menú de usuario + ruta protegida (`RequireAuth`, sin `RequireMenuAccess`) | `frontend/src/components/nav-user.tsx`, `frontend/src/App.tsx` |
| API client nuevo | `frontend/src/lib/api.ts` |

Build verificado: `tsc -b` OK, `oxlint` sin errores nuevos, `vite build` OK.

### 3.5 Migración y validación

- `backend/apps/autenticacion/migrations/0004_user_otp_enabled_user_otp_recovery_codes_and_more.py` **generada por Django** (incluye el `AlterField purpose` por `Purpose.CHANGE_EMAIL` — el `makemigrations` colgaba con Postgres caído; con la DB arriba se identifica el faltante).
- Validado contra la DB real: `migrate` OK, `makemigrations --check` → **No changes detected**, `manage.py test` → **exit 0**.
- Smoke test del módulo: TOTP válido/inválido, resepaldo 1° uso OK / 2° uso rechazado, `clear_2fa` resetea (todo en verde).

---

## 4. Límites de velocidad

| Capa | Alcance | Detalle |
| --- | --- | --- |
| nginx (por IP) | Toda `/api/` | `limit_req zone=api_global burst=20 nodelay`, `rate=60r/m` (`nginx/nginx.conf`, `nginx/locations.conf`) |
| nginx (por IP) | `/admin/login/` | `rate=5r/m`, `burst=3` (el admin cerrado, red de seguridad extra) |
| DRF (por usuario) | Endpoints sensibles | scopes `login`, `register`, `2fa` (`5/min`), `change_email` (`3/hour`) |

---

## 5. CI y hooks locales

- **`.github/workflows/ci.yml`**: jobs `backend` (check + tests + **check --deploy**), `frontend` (build + lint) y `security` (gitleaks sobre la history completa, **pip-audit** de `requirements.txt`, **pnpm audit --prod**).
- **`.pre-commit-config.yaml`**: gitleaks + hooks genéricos (eof, whitespace, yaml/json). Instalar local con `pre-commit install`.

---

## 6. Backups cifrados de Postgres

- `scripts/backup_db.sh`: `pg_dump` (custom) del servicio `postgres` del stack → `gzip` → **AES-256-CBC** (`openssl`, PBKDF2 100k iteraciones) → `backups/qullqi_<timestamp>.sql.gz.aes256`, con rotación de `BACKUP_KEEP` (14).
- Clave: `BACKUP_ENCRYPTION_PASSPHRASE` (en `backend/.env`; el script se **niega a correr** si no está — nunca escribe en claro).
- El script arma `--env-file backend/.env` para no fallar por interpolación, y extrae solo las variables que necesita (no hace `source` del `.env` entero: `DJANGO_SECRET_KEY` rompería bash/git-bash).
- **Verificado end-to-end (24/09/2026)**: backup real 28K cifrado → descifrado OK → TOC legible con 344 entradas.
- `backups/` en `.gitignore`.

---

## 7. Infraestructura / stack Docker

- Proyecto Compose raíz: **`qullqi`** (antes `gastos_ingresos_stack`). Red `qullqi_network`, volumen `qullqi_postgres_data` (preservado entre renames; datos intactos: 19 menús, 3 roles siembra).
- Levantar parado (sin rebuild): `docker compose --env-file backend/.env up -d`
- Rebuild solo cuando cambian Dockerfile/deps: `docker compose --env-file backend/.env up -d --build`
- Verificado: `http://localhost/` → 200, `/api/auth/csrf/` → 200; backend corriendo con `DEBUG=False`, gunicorn, migraciones + seed idempotente (`update_or_create` por UUID).
- **No tocar `backend/compose.dev.yml`** (proyecto dev `qullqi-service`, Postgres/Redis dev en `:5433`/`6380`, datos de desarrollo).

---

## 8. Secretos (dónde viven, SIN valores)

| Secreto | Ubicación | Git |
| --- | --- | --- |
| `DJANGO_SECRET_KEY`, `EMAIL_HOST_PASSWORD` (app password Gmail, sin espacios) | `backend/.env` | ❌ ignorado |
| `DATABASE_URL` dev, `SUPABASE_URL/KEY` | `backend/.env` | ❌ ignorado |
| `DB_PASSWORD`, `REDIS_PASSWORD` (stack) | `backend/.env` | ❌ ignorado |
| `BACKUP_ENCRYPTION_PASSPHRASE` | `backend/.env` | ❌ ignorado |
| `VITE_*` del front | `frontend/.env` | ❌ ignorado |

`backend/.env.example` documenta TODAS las variables con instrucciones de generación (token_urlsafe).

---

## 9. Operación diaria

| Acción | Comando |
| --- | --- |
| Levantar stack | `docker compose --env-file backend/.env up -d` |
| Parar stack | `docker compose --env-file backend/.env down` |
| Logs backend | `docker compose --env-file backend/.env logs -f backend` |
| Backup ahora | `scripts/backup_db.sh` |
| Migrar (dev) | `python manage.py migrate` (en `backend/`, DB dev `:5433`) |
| Tests (dev) | `python manage.py test` |
| Check front | `pnpm run build` / `pnpm run lint` (en `frontend/`) |
| Hooks locales | `pre-commit install` (una vez) |

---

## 10. Pendientes (recomendado)

1. **TLS real** — el único pendiente estructural. Cuando exista dominio (+certbot):
   - certbot en nginx, `return 301 https://…` en el server :80;
   - activar en env: `SESSION_COOKIE_SECURE=True`, `CSRF_COOKIE_SECURE=True`, `DJANGO_SECURE_SSL_REDIRECT=True`, `DJANGO_SECURE_HSTS_SECONDS=31536000` (+ subdomains/preload), `DJANGO_TRUST_PROXY_SSL_HEADER=True`.
2. **Tests automatizados de los endpoints nuevos** — cubrir `LoginOtpView`, `TwoFactor*`, `ChangeEmail*` y `ActiveSessions/Revoke/LogoutAll` (hoy hay smoke del módulo, no tests de las vistas).
3. **Instalar pre-commit local** (`pre-commit install`) para que gitleaks corra en cada commit.
4. **Test e2e del login 2FA en vivo** con curl + TOTP contra el stack real (puede pedir un usuario de prueba en la DB del stack).