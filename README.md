# Gestión de Gastos e Ingresos

Aplicación web full-stack para el control de gastos e ingresos personales, con autenticación segura, control de acceso basado en roles (RBAC), auditoría completa de cambios, importación masiva de datos desde Excel, y una infraestructura pensada para producción (Docker, nginx, workers en segundo plano, CI/CD).

## Características principales

- **Autenticación y seguridad**: registro con verificación de correo por código, login por sesión (cookie httponly + CSRF), bloqueo de cuenta tras intentos fallidos, recuperación de contraseña.
- **Control de acceso por roles (RBAC)**: roles, permisos y menús configurables por usuario — cada rol ve solo las secciones que le corresponden, resuelto igual en el frontend (qué se muestra) y el backend (qué se permite).
- **Configuraciones**: catálogos de Categorías, Monedas, Cuentas y sus Tipos, totalmente administrables desde la app — cada uno con CRUD en grilla, importación/exportación a Excel e historial de auditoría.
- **Finanzas**: registro de Movimientos (gastos e ingresos) contra una Categoría y una Cuenta, con el saldo de cada cuenta calculado en tiempo real a partir de sus movimientos (nunca un número guardado que se pueda desincronizar).
- **Auditoría de cambios**: historial detallado (qué columna cambió, de qué valor a cuál) de creación/edición/anulación de cada registro, con usuario y fecha responsables.
- **Grid de datos dinámico**: tabla editable en línea (AG Grid) con filtros, edición por celda, colores/íconos configurables, guardado en lote y exportación.
- **Importación masiva asíncrona**: carga de catálogos desde archivos Excel con vista previa antes de confirmar — el análisis corre en un worker de Celery aparte, no bloquea el servidor web.

## Stack tecnológico

**Backend**
- Django 6 + Django REST Framework
- PostgreSQL + psycopg2
- Celery + Redis para tareas en segundo plano (validación/importación de Excel)
- Autenticación por sesión (cookie) + verificación por email
- Pandas / OpenPyXL para importación/exportación de Excel
- Whitenoise para estáticos, Gunicorn como servidor de aplicación

**Frontend**
- React 19 + TypeScript + Vite
- AG Grid (community) para las tablas de datos
- TailwindCSS 4 + shadcn/ui
- React Router

**Infraestructura**
- Docker + Docker Compose (stack de desarrollo liviano, y un stack completo con nginx como reverse proxy — TLS incluido, self-signed en local, listo para certbot con un dominio real)
- GitHub Actions: backend (tests contra Postgres real), frontend (build + lint) y build de las imágenes en cada push/PR

## Arquitectura

El backend está organizado en apps de dominio (`autenticacion`, `seguridad`, `configuraciones`, `finanzas`, `historial`), con un modelo base compartido que agrega automáticamente estado, usuario creador/editor y timestamps a cada entidad — permitiendo trazabilidad completa sin repetir código. `configuraciones` provee la data maestra (Categorías/Monedas/Cuentas); `finanzas` es el módulo transaccional que la consume.

En producción, el mismo backend corre en dos roles separados a partir de la misma imagen: `backend` (gunicorn, atiende HTTP) y `worker` (Celery, procesa la cola de importaciones) — sigue siendo un único sistema, no microservicios de dominio.

## Cómo correrlo localmente

### Opción rápida (sin Docker)

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate       # Windows
pip install -r requirements.txt
cp .env.example .env         # completar variables de entorno
python manage.py migrate
python manage.py runserver

# Frontend
cd frontend
pnpm install
cp .env.example .env         # completar variables de entorno
pnpm dev
```

### Con Docker (recomendado)

```bash
cd backend
cp .env.example .env         # completar variables de entorno
docker compose -f compose.dev.yml up --build
```

Levanta Postgres, Redis, el backend (con hot-reload) y el worker de Celery. El frontend se sigue corriendo aparte con `pnpm dev` para tener hot-reload también ahí.

### Stack completo (nginx + TLS, para probar la topología de producción)

```bash
# usa backend/.env (completado en el paso anterior) — no hace falta otro .env en la raíz
docker compose --env-file backend/.env up --build
```

Levanta todo detrás de nginx (`https://localhost`, certificado self-signed hasta tener un dominio real) — ver los comentarios en `docker-compose.yml` y `nginx/nginx.conf` para el paso a un certificado real con certbot.

---

Desarrollado por [Aylton Mesias Martinez](https://github.com/ADolmos194) — Full Stack Developer.
