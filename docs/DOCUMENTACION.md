# Documentación del proyecto — Gestión de Gastos e Ingresos

> Análisis completo del estado actual del código (backend, frontend e infraestructura), organizado paso a paso. Complementa a `README.md` (que es la guía rápida de instalación) con el detalle de **cómo está construido** cada módulo y **por qué**.

Última actualización: 2026-09-20.

---

## 1. Qué es el proyecto

Aplicación web full-stack para el control de gastos e ingresos personales:

- Autenticación con verificación de correo por código y recuperación de contraseña.
- Control de acceso por roles (RBAC): menús y permisos configurables por rol, resueltos igual en frontend (qué se muestra) y backend (qué se permite).
- Catálogos maestros (Categorías, Monedas, Cuentas) con CRUD en grilla, importación/exportación a Excel y auditoría.
- Módulo transaccional (Movimientos = gastos/ingresos) con saldo de cuenta calculado en tiempo real.
- Auditoría de cambios columna por columna (historial) para cada registro de negocio.

**Stack**: Django 6 + DRF + PostgreSQL + Celery/Redis en el backend; React 19 + TypeScript + Vite + AG Grid + TailwindCSS/shadcn en el frontend; Docker + nginx + GitHub Actions en infraestructura.

---

## 2. Arquitectura general

```
frontend/   React SPA (Vite) — consume la API vía fetch con cookies de sesión
backend/    Django + DRF — apps de dominio, una imagen que corre en 2 roles (web/worker)
nginx/      Reverse proxy — sirve el bundle de React y proxyea /api, /admin, /static
```

El backend está organizado en **apps de dominio**, cada una con su propósito:

| App | Responsabilidad |
|---|---|
| `autenticacion` | Usuario, login/registro/verificación/recuperación de contraseña, sesión. |
| `seguridad` | RBAC: Roles, Permisos, Menús, y quién tiene qué (`UserRole`, `RoleMenu`, `PermissionRole`). |
| `configuraciones` | Data maestra: `System`, `Status`/`StatusTypes` (catálogo de estados compartido), y las subcarpetas `categoria/`, `moneda/`, `cuenta/`. |
| `finanzas` | Módulo transaccional: `Movimiento` (gasto/ingreso) y cálculo de saldos. |
| `historial` | Auditoría genérica de cambios, usada por todas las apps anteriores. |

Todas las entidades de negocio heredan de `BaseModel` (`apps/configuraciones/models.py`), que agrega automáticamente:

- `id` (UUID)
- `key_status` (FK a `Status` — el mismo catálogo de estados para todo el sistema: Activo/Inactivo/Anulado/etc.)
- `key_creator_user` / `key_updater_user`
- `creation_date` / `update_date`

Esto evita repetir esos 6 campos en cada modelo y hace que **todo** en el sistema tenga trazabilidad de quién lo creó/editó y en qué estado está, sin código adicional.

**Regla de estados** (aplicada en todos los módulos CRUD, no solo en uno): un registro nunca se borra físicamente — se **anula** (`Anulado`) o se **inactiva** (`Inactivo`). Un nombre anulado libera el nombre para reutilizarse; uno inactivo lo sigue bloqueando (evita duplicados accidentales) y puede "reactivarse" solo. Esta regla se repite igual en Categorías, Monedas, Cuentas y Movimientos.

---

## 3. Módulo Autenticación (`apps/autenticacion`)

### Modelo (`models.py`)

- `User` (custom, `AUTH_USER_MODEL`): UUID como PK, `username` + `email` únicos, `nro_document` opcional. Trae bloqueo de cuenta incorporado: `failed_login_attempts`, `is_locked`, con `MAX_LOGIN_ATTEMPTS = 3` — al tercer intento fallido, `register_failed_attempt()` bloquea la cuenta (`is_locked=True`, `is_active=False`).
- `VerificationCode`: código numérico de 6 dígitos de un solo uso, reutilizado para dos propósitos (`Purpose.EMAIL_VERIFICATION` / `Purpose.PASSWORD_RESET`) en la misma tabla. `issue()` invalida cualquier código previo activo del mismo usuario+propósito antes de crear uno nuevo; `verify()` limita a `MAX_ATTEMPTS = 5` intentos y respeta expiración (`VERIFICATION_CODE_TTL_MINUTES`).

### Flujo de login (`views.py: LoginView`)

Orden exacto de los chequeos (importante: está diseñado así a propósito, no es casual):

1. Resuelve el usuario por `username` **o** `email` (el campo se llama "usuario" pero acepta ambos).
2. Si la cuenta está bloqueada → 403, **antes** de validar la contraseña.
3. `authenticate()` (hash de Django, tiempo constante) — si falla, incrementa `failed_login_attempts` y devuelve un mensaje genérico (no dice si el usuario existe o no).
4. Si el email no está verificado → reenvía el código y devuelve 403 con `reason: "email_not_verified"`.
5. Si el usuario no tiene ningún rol activo con menú/permisos asociados (`build_user_access`, ver §4) → 403 con `reason: "no_permissions"`.
6. Solo si pasó todo lo anterior: `django_login()` (rota la session key, previene fijación de sesión) y responde con el payload de sesión.

Cada paso está **después** del anterior a propósito: nunca revela más información de la necesaria a alguien que no pasó el paso previo (protección contra enumeración de usuarios/cuentas).

### Otros endpoints (`/api/auth/`)

| Endpoint | Vista | Nota |
|---|---|---|
| `GET /csrf/` | `CsrfCookieView` | Entrega la cookie `csrftoken` (debe pedirse antes de cualquier POST). |
| `POST /login/` | `LoginView` | Ver arriba. Throttle: `5/min` por IP. |
| `POST /register/` | `RegisterView` | Crea cuenta sin verificar, no inicia sesión. Throttle: `10/hour`. |
| `POST /refresh/` | `RefreshSessionView` | Desliza la expiración de sesión (requiere sesión activa). |
| `POST /forgot-password/` | `ForgotPasswordView` | Mismo mensaje exista o no el email (anti-enumeración). Throttle: `5/hour`. |
| `POST /verify-email/` | `VerifyEmailView` | Consume el código de verificación. |
| `POST /resend-verification/` | `ResendVerificationView` | Throttle: `3/hour` (cooldown adicional por usuario en `VerificationCode.has_recent_active`). |
| `POST /reset-password/` | `ResetPasswordConfirmView` | Además desbloquea la cuenta (`is_locked=False`) y resetea intentos fallidos. |
| `POST /change-password/` | `ChangePasswordView` | Usuario ya logueado; `update_session_auth_hash` mantiene viva la sesión actual e invalida las demás. |
| `POST /logout/` | `LogoutView` | Rota el CSRF token tras cerrar sesión. |
| `GET /me/` | `MeView` | Usuario + payload de sesión actual. |

### Middleware de rutas libres (`middleware.py` + `permissions.py`)

`FreeApiMiddleware` marca `request.is_free_api = True` para los prefijos en `FREE_APIS` (csrf, login, register, forgot-password, reset-password, verify-email, resend-verification). `IsAuthenticatedOrFreeApi` (permiso default de todo el proyecto, ver `settings.py`) exige sesión activa salvo en esas rutas. Notar que `/refresh/` **no** está en la lista a propósito: no tiene sentido "refrescar" sin sesión.

---

## 4. Módulo Seguridad / RBAC (`apps/seguridad`)

Este es el módulo que resuelve **qué puede ver y hacer cada usuario**, consumido tanto por el login (para armar el payload de sesión) como por cada vista protegida del resto del sistema.

### Modelos (`models.py`)

```
Role ──< UserRole >── User
Role ──< RoleMenu >── Menu ──> Menu (self, árbol vía key_father_menu)
Role ──< PermissionRole >── Permission ──> Action
                                        └─> PermissionSystem ──> System
```

- `Role.all_access` (bool): un rol con esto en `True` ve **todo** el menú activo y tiene **todos** los permisos, sin pasar por `RoleMenu`/`PermissionRole`. Es el mecanismo de "superadmin" del sistema.
- `Menu`: árbol (auto-referencia `key_father_menu`) filtrado además por `key_system` (hoy hay sistema "Web" vs "Mobile" en el seed — solo se resuelve el menú del sistema Web).
- `Permission.decorator_name`: el string que después usan `@require_permission(...)` / `HasBackendPermission.required_permission` en cada vista protegida — es el "candado" real.

### Resolución de acceso (`services.py: build_user_access`)

Función central del módulo, llamada en cada login/me/refresh y en cada chequeo de permiso:

1. Junta los roles **activos** del usuario (`UserRole.key_status = Activo` y el `Role` también activo).
2. Si ninguno → `has_access=False` (bloquea el login, ver §3).
3. Si alguno tiene `all_access=True` → devuelve todo el menú del sistema Web + comodines `ALL_PERMISSIONS_FRONT`/`ALL_PERMISSIONS_BACK`.
4. Si no, resuelve la unión de menús asignados a esos roles (`_resolve_role_menus`) — **incluyendo los ancestros** de cada menú asignado (si solo se vinculó un hijo, el padre agrupador aparece igual para que el árbol tenga sentido en el sidebar) — y la unión de permisos (`_resolve_role_permissions`), separados en formato frontend (`{action, subject}`, estilo CASL) y backend (lista de `decorator_name`).

### Los dos candados (front y back nunca son la misma garantía)

- **Frontend**: `AuthProvider.can(action, subject)` (`frontend/src/lib/auth-context.tsx`) compara contra `permisos_front`, con `"manage"`/`"all"` como comodín. Lo usa `RequireMenuAccess` para no renderizar una página que el usuario no debería ver.
- **Backend**: `HasBackendPermission` (permission class de DRF) y `@require_permission(decorator_name)` (decorador function-based) — ambos llaman a `build_user_access` de nuevo y comparan contra `permisos_back`. **Este es el que de verdad importa**: el frontend se puede inspeccionar/editar desde las devtools, el backend no.

### Estado actual: en construcción

- ✅ Hecho: `models.py`, `services.py`, `permissions.py`, `decorators.py`.
- 🚧 En progreso (sin commitear al momento de este análisis): `constants.py` (`PERM_MANAGE`), `message.py`, `serializers.py` (`RoleSerializer`, `PermissionSerializer` de solo lectura, `MenuSerializer` de solo lectura).
- ❌ Falta: `views.py` está vacío (solo el boilerplate de Django) y **no existe `urls.py`** — `config/urls.py` no incluye ninguna ruta de `seguridad`. Es decir, hoy no hay ningún endpoint HTTP para administrar Roles/Permisos/Menús/Usuarios.
- El frontend ya tiene reservadas las 4 páginas (`RolesPage`, `PermisosPage`, `MenusPage`, `UsuariosPage`, cada una con su ruta en `page-routes.tsx`), pero las 4 son stubs de 11 líneas ("Próximamente").

Front y back están consistentemente sin terminar en este módulo — es el siguiente bloque de trabajo grande del proyecto, no una inconsistencia entre ambos.

`PERM_MANAGE = "seguridad-manage"` (en el `constants.py` nuevo) va a ser, cuando se conecte, **un solo permiso para todo el módulo** (no read/create/update/delete separados como en Configuraciones/Finanzas) — administrar seguridad es todo-o-nada, y a propósito no se asigna a ningún rol por defecto en los seeds, para que un usuario común nunca pueda auto-otorgarse acceso.

---

## 5. Módulo Configuraciones (`apps/configuraciones`)

### Nivel superior (`models.py`)

- `StatusTypes` / `Status`: catálogo de estados **compartido por todo el sistema** (Activo, Inactivo, Anulado, y también los estados de los jobs de importación: Procesando/Completado/Error). No es específico de Configuraciones, vive acá porque es la app más "base".
- `BaseModel` (abstracto): el que heredan todas las entidades de negocio del proyecto (ver §2).
- `System`: catálogo de sistemas (Web/Mobile) usado por `seguridad.Menu`.

### Subcarpetas por entidad: `categoria/`, `moneda/`, `cuenta/`

Cada una es un mini-paquete autocontenido con el mismo patrón exacto:

```
categoria/
├── models.py        # Categoria, TipoCategoria, CategoriaImportJob
├── constants.py      # PERM_READ/CREATE/UPDATE/DELETE/IMPORT/EXPORT, TEMPLATE_COLUMNS
├── message.py         # strings de error, centralizados
├── serializers.py
├── views.py           # toda la lógica: CRUD, import/export Excel
└── urls.py
```

`moneda/` y `cuenta/` repiten esta misma estructura para sus propias entidades. Son subpaquetes de la app `configuraciones` (comparten `app_label` y carpeta `migrations/`), no apps Django separadas — por eso `models.py` de nivel superior los reexporta al final del archivo (import diferido para evitar un ciclo con `BaseModel`).

### El patrón CRUD (idéntico en Categoría/Moneda/Cuenta/Movimiento)

Cada `views.py` de entidad sigue el mismo contrato, ejemplificado con `categoria/views.py`:

1. **Un único endpoint `bulk_save_*`** (`POST`) recibe `{created, updated, voided, restored, inactivated}` en un solo request — la grilla (AG Grid) acumula los cambios del usuario y los manda todos juntos.
2. Cada "bolsa" del payload se valida contra **su propio permiso** (`PERM_CREATE`, `PERM_UPDATE`, `PERM_DELETE`) con `build_user_access` a mano — no hay un permiso fijo por vista porque un mismo request puede mezclar create+update+delete.
3. Todo corre dentro de una `transaction.atomic()`: todo o nada.
4. Cada creación/edición/anulación queda registrada en `apps.historial` (`registrar_creacion`/`registrar_actualizacion`, ver §7) — con el detalle columna por columna de qué cambió.
5. Reglas de duplicados: un nombre usado por un registro Activo o Inactivo bloquea crear/renombrar a ese nombre; uno Anulado no (libera el nombre). `lock_duplicate_guard` (en `configuraciones/services.py`) cierra la ventana de carrera entre el `SELECT` de verificación y el `INSERT`, para que dos requests concurrentes con el mismo nombre no pasen ambos la validación.

### Importación desde Excel (asíncrona, vía Celery)

Flujo de 3 pasos, igual en Categorías/Monedas/Cuentas:

1. `start_*_import_validate` — recibe el `.xlsx`, lo valida (`excel_utils.validate_import_upload`: tamaño comprimido Y descomprimido, protección contra zip-bomb), crea un `*ImportJob` en estado "Procesando" y encola `run_*_import_validation_job.delay(...)` en Celery (el archivo viaja codificado en base64 dentro del mensaje).
2. El worker de Celery corre `_parse_*_file` (parseo con pandas, sin tocar la base de datos) y va actualizando `processed_rows`/`total_rows` en el job — el frontend hace polling a `*_import_validate_status` para mostrar un % real de avance.
3. `import_*` confirma: vuelve a parsear (todo o nada — si hay un solo error, no se crea nada) y hace `bulk_create`/`bulk_update` real, registrando cada fila en el historial con `evento="import"`.

Casos especiales del parseo (ejemplo de Categorías, mismo criterio en Monedas/Cuentas): una fila cuyo nombre coincide con un registro **Anulado** no bloquea (se crea uno nuevo, el anulado queda intacto); una fila que coincide con uno **Inactivo** lo **reactiva** en vez de crear un duplicado.

### Exportación (`excel_utils.py`)

`dataframe_to_xlsx_response` + `style_worksheet`: genera el `.xlsx` con pandas/openpyxl y le aplica estilo (encabezado oscuro, filas cebra, columna Estado coloreada igual que en la grilla en pantalla) para que el archivo descargado se vea consistente con la UI.

---

## 6. Módulo Finanzas (`apps/finanzas`)

### Modelo (`models.py`)

`Movimiento` — un gasto o ingreso puntual. Decisiones de diseño explícitas (documentadas en el propio código):

- **No tiene campo "tipo" propio**: la clasificación Gasto/Ingreso se hereda de `key_categoria.key_tipo` — evita el caso contradictorio de un movimiento "Ingreso" con una categoría de gasto.
- **No tiene campo "moneda" propio**: usa la de `key_cuenta.key_moneda` (una cuenta ya tiene moneda fija) — evita tener que resolver conversión de moneda en esta versión.
- **No tiene campo "saldo"**, y `Cuenta` tampoco: el saldo se calcula al vuelo, nunca se persiste (para que no se pueda desincronizar de los movimientos reales).

### Cálculo de saldos (`services.py: compute_saldos`)

Por cada cuenta activa del usuario: `Sum(amount)` de movimientos **activos** filtrados por `key_categoria.key_tipo.name == "Ingreso"` menos los de `"Gasto"`. Solo cuentan movimientos en estado Activo — uno Anulado nunca pasó de verdad, uno Inactivo se trata como "no confirmado" para este cálculo.

### Vistas (`views.py`)

Mismo patrón CRUD bulk-save de §5 (`bulk_save_movimientos`), más `list_saldos` (expone `compute_saldos`) y el historial por movimiento (`movimiento_historial`, `movimiento_historial_detalle`). A diferencia de Categoría/Moneda/Cuenta, no hay `lock_duplicate_guard` — un Movimiento no tiene un campo "nombre" único que proteger (dos gastos de "Almuerzo" el mismo día son válidos).

---

## 7. Módulo Historial / Auditoría (`apps/historial`)

Genérico: lo usa cualquier vista de escritura de cualquier módulo (Configuraciones, Finanzas), no está atado a una entidad puntual.

- `Historial`: un evento (`evento`: create/update/delete/import) + qué tabla/registro (`nom_tabla`, `key_record`) + quién y cuándo. **No** hereda de `BaseModel` (un registro de auditoría es inmutable, no tiene sentido que tenga su propio estado).
- `HistorialDetalle`: una fila por columna que cambió, con el valor antes/después en texto.

`services.py`:
- `snapshot(instance)`: "foto" de los campos de negocio de una instancia (excluye `id`/timestamps/creator/updater — bookkeeping que no aporta al diff).
- `registrar_creacion`: registra todos los campos como `(None, valor)`.
- `registrar_actualizacion(antes, despues_instance)`: compara dos snapshots y solo registra las columnas que **realmente** cambiaron; si no cambió nada, no crea un registro de historial vacío.

Se llama **a mano** desde cada vista que modifica datos (no es un decorador automático) — así el detalle de qué cambió sale del lugar que sabe qué cambió. `log_data_access` (en `apps.seguridad.decorators`) es solo un marcador en las vistas, hoy no dispara nada por sí mismo.

---

## 8. Frontend (`frontend/`)

### Estructura de carpetas relevantes

```
src/
├── components/       # UI compartida: app-layout, crud-grid (AG Grid genérico), forms de auth, ui/ (shadcn)
├── lib/
│   ├── api.ts               # fetch wrapper (CSRF, cookies, parseo de errores DRF)
│   ├── auth-context.tsx     # sesión global (React Context) + sliding expiration
│   ├── page-routes.tsx      # registro único de páginas autenticadas (subject -> path -> componente lazy)
│   ├── menu-routes.ts / menu-breadcrumbs.ts / menu-icons.ts
│   └── *-api.ts              # un archivo por entidad (categorias-api, cuentas-api, monedas-api, movimientos-api)
└── pages/            # una carpeta por módulo, refleja la estructura del backend
```

### Enrutamiento (`App.tsx`)

- Rutas públicas (`/login`, `/register`, `/forgot-password`, `/verify-email`) envueltas en `RedirectIfAuthenticated` (si ya hay sesión, redirige).
- Rutas autenticadas: envueltas en `RequireAuth` (¿hay sesión?) y luego `RequireMenuAccess` (¿el usuario tiene ese `subject` en su menú?) — generadas dinámicamente iterando `pageRoutes`, cada página cargada con `lazy()` (code-splitting real, no todo el bundle de una vez).
- La clave de `pageRoutes` es el `Menu.subject` del backend (el identificador único real, `unique` en `sec_menu`), no la URL — así breadcrumbs y control de acceso se resuelven contra el mismo identificador que usa el backend, en vez de comparar strings de ruta.

### Sesión (`auth-context.tsx`)

- Al montar, llama a `/api/auth/me/` para saber si ya hay sesión activa (cookie httponly) — con un delay mínimo configurable (`VITE_AUTH_TRANSITION_DELAY_MS`) para que la pantalla de carga no "flashee" en redes rápidas.
- Mientras `status === "authenticated"`, hace polling a `/api/auth/refresh/` cada 5 minutos (y al volver a la pestaña) para mantener viva la sesión mientras el usuario la deja abierta sin interactuar (sliding expiration del lado de Django ya cubre cualquier otro request).
- `can(action, subject)`: mismo chequeo de permisos que el backend, pero contra `permisos_front` — con `"manage"`/`"all"` como comodín (estilo CASL).

### Capa de API (`lib/api.ts`)

- `ensureCsrfCookie()`: pide `csrftoken` una vez si el navegador no lo tiene, antes de cualquier método no seguro (`POST`/`PATCH`/`DELETE`).
- `apiFetch`: wrapper único sobre `fetch` — agrega `X-CSRFToken`, `credentials: "include"` (cookies cross-origin), y parsea las 3 formas en que DRF puede devolver un error (`{"detail": ...}`, `{"campo": [...]}`, `["msg"]` suelto) para que los toasts del frontend siempre muestren el mensaje real del backend en vez de un genérico.

### Grilla genérica (`components/crud-grid.tsx`)

Componente compartido detrás de todas las páginas de catálogo (Categorías, Monedas, Cuentas, Movimientos): edición en línea vía AG Grid, acumula cambios (created/updated/voided/restored/inactivated) y los manda en un solo `bulk_save_*`, con exportación a Excel respetando el filtro de estado actual de la grilla.

---

## 9. Infraestructura

### Dos stacks de Docker Compose, dos propósitos distintos

| | `backend/compose.dev.yml` | `docker-compose.yml` (raíz) |
|---|---|---|
| Uso | Desarrollo día a día | Probar la topología de producción |
| Servicios | postgres, redis, backend (hot-reload), worker | + nginx (reverse proxy, TLS) |
| Frontend | Aparte, con `pnpm dev` (hot-reload propio) | Compilado dentro de la imagen de nginx |
| `.env` que usa | `backend/.env` (mismo directorio) | `backend/.env` vía `--env-file` (ver más abajo) |
| Comando | `cd backend && docker compose -f compose.dev.yml up --build` | `docker compose --env-file backend/.env up --build` |

Ambos leen **el mismo** `backend/.env` — no hay un `.env` separado para infraestructura. Ese único archivo trae tanto la config de Django/Celery como las variables que solo usa el compose de la raíz (`DB_NAME`, `DB_USER`, `DB_PASSWORD`, `HTTP_PORT`, `HTTPS_PORT`, `PUBLIC_ORIGIN`) para armar Postgres y los puertos de nginx. El otro `.env` real del proyecto es `frontend/.env` (variables `VITE_*`, inlineadas en el bundle en build-time).

### `nginx/` — reverse proxy

- `Dockerfile`: build multi-stage — compila el bundle de React (contexto de build: la raíz, porque necesita alcanzar `frontend/`) y lo sirve con nginx, que además hace de proxy hacia `backend:8000` para `/api/`, `/admin/` y `/static/`.
- `nginx.conf` / `locations.conf`: HTTP (80) y HTTPS (443, certificado self-signed generado en el build) comparten las mismas `location` vía `include`. Rate-limit específico en `/admin/login/` (5 req/min) porque el login del admin de Django no pasa por el throttle de DRF. Headers de seguridad (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) agregados en la location del SPA, porque esos archivos los sirve nginx directo, sin pasar por Django.

### Backend — dos roles, una sola imagen

`backend/Dockerfile` construye una imagen que corre en dos roles distintos según el `command` que le pase cada servicio del compose:

- `backend`: `gunicorn config.wsgi:application` — atiende HTTP.
- `worker`: `celery -A config worker` — consume la cola de Celery (validación de imports Excel).

No son microservicios de dominio distintos, es el mismo sistema desplegado dos veces con distinto rol.

### CI/CD (`.github/workflows/ci.yml`)

Tres jobs en cada push/PR a `main`:

1. **backend**: contra un Postgres real (no sqlite, para no probar contra un motor distinto del que corre en producción) — `manage.py check` + `manage.py test`.
2. **frontend**: `pnpm run build` (type-check + build de Vite) + `pnpm run lint` (oxlint).
3. **docker-build** (solo si los dos anteriores pasan): construye las 2 imágenes reales (`backend/Dockerfile` y `nginx/Dockerfile`, con el mismo contexto que usaría un deploy real) para agarrar roturas de Dockerfile antes de que lleguen a un deploy.

---

## 10. Seguridad — resumen transversal

Medidas ya implementadas (no son un plan, están en el código hoy):

- **Sesión por cookie httponly + CSRF** (double-submit cookie), no JWT en `localStorage` — no hay token que un XSS pueda robar leyendo el storage.
- **Rate limiting por endpoint sensible** (`DEFAULT_THROTTLE_RATES` en `settings.py`): login, registro, forgot-password, reset-password, change-password, verificación de email — cada uno con su propio límite por IP.
- **Bloqueo de cuenta** tras 3 intentos fallidos de login, independiente del throttle por IP (segunda capa).
- **Anti-enumeración**: mismos mensajes/tiempos de respuesta exista o no la cuenta/email en login, forgot-password, resend-verification.
- **RBAC de dos capas**: el chequeo del frontend es solo UX, el del backend (`HasBackendPermission`/`require_permission`) es el que realmente protege cada endpoint.
- **Protección contra zip-bomb** en imports de Excel: valida tamaño comprimido y descomprimido antes de que pandas toque el archivo.
- **`DEFAULT_RENDERER_CLASSES` limitado a JSON**: sin `BrowsableAPIRenderer`/`AdminRenderer` de DRF expuestos en producción.
- **Aislamiento por usuario**: casi todo query de negocio filtra por `key_user=request.user` — nadie puede leer/editar el registro de otro adivinando su UUID.
- **Hardening HTTPS listo pero apagado** (`SECURE_SSL_REDIRECT`, HSTS, `SECURE_PROXY_SSL_HEADER`) hasta que haya un dominio real con certificado válido — todo controlado por variables de entorno, sin tocar código para activarlo.

---

## 11. Cómo correr el proyecto

### Opción rápida (sin Docker)

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # completar variables
python manage.py migrate
python manage.py runserver

cd frontend
pnpm install
cp .env.example .env
pnpm dev
```

### Con Docker — desarrollo (recomendado día a día)

```bash
cd backend
cp .env.example .env
docker compose -f compose.dev.yml up --build
```

Levanta Postgres + Redis + backend (hot-reload) + worker. El frontend sigue corriendo aparte con `pnpm dev`.

### Con Docker — stack completo (para probar la topología de producción)

```bash
docker compose --env-file backend/.env up --build
```

Levanta todo detrás de nginx en `https://localhost` (certificado self-signed).

---

## 12. Estado actual y pendientes

**Terminado y funcionando**: Autenticación completa, Configuraciones (Categorías/Monedas/Cuentas con CRUD + import/export Excel + auditoría), Finanzas (Movimientos + saldos), Historial, infraestructura (Docker dev + stack completo + CI).

**En construcción**: módulo Seguridad (administración de Roles/Permisos/Menús/Usuarios) — modelos y lógica de resolución de acceso ya funcionan (se usan en cada login), pero no hay todavía endpoints ni UI para gestionarlos desde la app; hoy se administran por el admin de Django o directamente por seed/fixtures.

**Notas de mantenimiento**:
- `backend/pyrefly.toml` apunta al intérprete en `../.venv/Scripts/python.exe` (corregido — antes decía `../venv/...`, una carpeta que no existe).
- Quedan exactamente 2 archivos `.env` en el proyecto (`backend/.env`, `frontend/.env`) y 2 archivos de compose (`docker-compose.yml` en la raíz, `backend/compose.dev.yml`) — ver §9.
