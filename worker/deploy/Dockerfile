# CyberSentinel scan-execution worker (ASM / VS / CA). Build context = repo root.
#
#   docker build -f worker/deploy/Dockerfile -t cybersentinel-worker .
#
# The worker resolves recon tools (subfinder, dnsx, httpx, nmap, nuclei, amass,
# naabu, sslscan, …) at runtime via utils.LookPath and degrades gracefully when
# a tool is absent (that stage is SKIPPED). Install the tools your pipelines need
# in the runtime stage; nmap is included as it has no Go-install path.

FROM golang:1.24 AS build
WORKDIR /src
COPY worker/go.mod worker/go.sum ./
RUN go mod download
COPY worker/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/worker .

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates nmap \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/worker /usr/local/bin/worker
ENTRYPOINT ["worker"]
