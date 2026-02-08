FROM golang:1.21-alpine

RUN apk add --no-cache git

WORKDIR /app/backend/workers

COPY backend/workers/go.mod backend/workers/go.sum ./
RUN go mod download

COPY backend/workers ./

ENV CGO_ENABLED=0

# Command is overridden per-service in docker-compose
CMD ["go", "run", "./control-plane/cmd/"]
