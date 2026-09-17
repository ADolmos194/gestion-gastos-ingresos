# Contexto de build: la raíz del repo (ver docker-compose.yml, "context: .") — necesita
# alcance a frontend/ para compilar el bundle, así que este Dockerfile no puede vivir
# adentro de frontend/ con un contexto acotado a esa carpeta.
FROM node:22-alpine AS frontend-build
WORKDIR /app

# pnpm-workspace.yaml incluido a propósito: ahí vive pnpm.overrides (fix de vulnerabilidades
# en subdependencias, ver auditoría de seguridad) — sin copiarlo, --frozen-lockfile ve un
# lockfile que espera esos overrides y un package.json/workspace sin ellos, y falla con
# ERR_PNPM_LOCKFILE_CONFIG_MISMATCH (pasó de verdad armando esto).
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
# Solo "corepack enable": la versión exacta de pnpm la toma del campo "packageManager" de
# package.json (recién copiado), no de un tag flotante como "pnpm@10" — un pnpm más nuevo
# (aunque sea el mismo major) puede calcular distinto el hash de "overrides" del lockfile y
# --frozen-lockfile lo rechaza por "config mismatch" (esto también pasó de verdad armando esto).
RUN corepack enable \
    && pnpm install --frozen-lockfile

COPY frontend/ ./

# Vite inlinea las VITE_* en el bundle EN BUILD TIME, no se pueden cambiar después sin
# recompilar. Default "" (relativo): así el bundle pide /api/... contra el mismo origen
# que lo sirve (este nginx), sin necesidad de CORS — ver nginx.conf, que ya proxyea /api/
# al backend. Pasar --build-arg VITE_URL_BASE=https://otra-cosa si el backend NO está
# detrás de este mismo nginx.
ARG VITE_URL_BASE=""
ENV VITE_URL_BASE=$VITE_URL_BASE
RUN pnpm run build

FROM nginx:1.27-alpine
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx/locations.conf /etc/nginx/locations.conf

# Certificado self-signed para probar TLS en local (no hay dominio real, Let's Encrypt no
# emite para "localhost") — se regenera en cada build, no hace falta persistirlo. Ver el
# comentario en nginx.conf para el paso a un certificado real de certbot.
RUN apk add --no-cache openssl \
    && mkdir -p /etc/nginx/certs \
    && openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
        -keyout /etc/nginx/certs/localhost.key \
        -out /etc/nginx/certs/localhost.crt \
        -subj "/CN=localhost"

EXPOSE 80 443
