# Workers — multi-stage. Build COMPILED binaries (no more `go run` at startup,
# audit C2/H5) and run as non-root. The runtime keeps the security tools the
# executor shells out to (nmap, masscan, the go-installed recon tools).
#
# NOTE: a fully distroless runtime is blocked by the scanner tool dependency.
# Tool versions should be pinned (supply-chain TODO H4); verify availability in
# CI. Pin base images by digest in production.

# ---- build: compile app binaries + recon tools ----
FROM golang:1.24-alpine AS build
RUN apk add --no-cache git
WORKDIR /src
COPY backend/workers/go.mod backend/workers/go.sum ./
RUN go mod download
COPY backend/workers ./
ENV CGO_ENABLED=0
RUN go build -trimpath -o /out/control-plane ./control-plane/cmd/ \
 && go build -trimpath -o /out/asm-consumer  ./consumer/cmd/asm/

# ---- runtime: alpine + tools, non-root, compiled binaries only ----
FROM alpine:3.20 AS runtime
RUN apk add --no-cache ca-certificates nmap nmap-scripts masscan bind-tools openssl curl
COPY --from=build /out/control-plane /usr/local/bin/control-plane
COPY --from=build /out/asm-consumer  /usr/local/bin/asm-consumer
# The go-installed recon tools (subfinder, naabu, httpx, nuclei, …) should be
# built in the build stage and copied here; see install-tools.sh. Pin versions.
RUN adduser -D -u 10003 worker
USER worker
# Compose overrides the command per service (control-plane vs asm-consumer).
CMD ["control-plane"]
