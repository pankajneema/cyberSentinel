# Frontend — multi-stage build, served by non-root nginx (audit: no vite preview,
# no toolchain in the runtime image, non-root).
# Pin base images by digest in production (replace tags with @sha256:...).

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

# ---- runtime (non-root nginx, listens on 8080 as an unprivileged user) ----
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/ >/dev/null 2>&1 || exit 1
# nginxinc/nginx-unprivileged already runs as USER nginx (uid 101).
