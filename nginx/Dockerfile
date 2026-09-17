# Contexto de build: la raíz del repo (ver docker-compose.yml, "context: .") — necesita
# alcance a frontend/ para compilar el bundle, así que este Dockerfile no puede vivir
# adentro de frontend/ con un contexto acotado a esa carpeta.
FROM node:22-alpine AS frontend-build
WORKDIR /app

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10 --activate \
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

EXPOSE 80
