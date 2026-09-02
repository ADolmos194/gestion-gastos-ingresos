# Gestión de Gastos e Ingresos

Aplicación web full-stack para el control de gastos e ingresos personales/empresariales, con autenticación segura, control de acceso basado en roles (RBAC), auditoría completa de cambios e importación masiva de datos desde Excel.

## Características principales

- **Autenticación y seguridad**: registro con verificación de correo por código, login con JWT, recuperación de contraseña.
- **Control de acceso por roles (RBAC)**: roles, permisos y menús configurables por usuario — cada rol ve solo las secciones que le corresponden.
- **Auditoría de cambios**: historial detallado de creación/edición de cada registro, con usuario y fecha responsables.
- **Grid de datos dinámico**: tabla editable en línea (AG Grid) con filtros, edición por celda, colores/íconos configurables y exportación.
- **Importación masiva**: carga de gastos/ingresos desde archivos Excel con vista previa antes de confirmar.
- **Categorías y configuración**: catálogo de categorías y estados totalmente configurable desde la app.

## Stack tecnológico

**Backend**
- Django 6 + Django REST Framework
- PostgreSQL (vía Supabase) + psycopg2
- Autenticación JWT + verificación por email
- Pandas / OpenPyXL para importación/exportación de Excel
- Docker + Gunicorn para despliegue

**Frontend**
- React 19 + TypeScript + Vite
- AG Grid (community) para las tablas de datos
- TailwindCSS 4 + shadcn/ui
- React Router

## Arquitectura

El backend está organizado en apps de dominio (`autenticacion`, `seguridad`, `configuraciones`, `historial`), con un modelo base compartido que agrega automáticamente estado, usuario creador/editor y timestamps a cada entidad — permitiendo trazabilidad completa sin repetir código.

## Cómo correrlo localmente

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

También se incluye `compose.dev.yml` para levantar el entorno con Docker.

---

Desarrollado por [Aylton Mesias Martinez](https://github.com/ADolmos194) — Full Stack Developer.
