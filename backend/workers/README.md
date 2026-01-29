Overview

This repository contains the background workers system for CyberSential.

The workers are responsible for:

Consuming jobs from a queue

Coordinating job execution

Running security tools (ASM / VA / IA)

Streaming real-time job updates via WebSocket

The system is designed to be:

Asynchronous

Fault-tolerant

Scalable

Rewrite-safe

High-Level Architecture
UI
 ↓
Queue (RabbitMQ)
 ↓
Consumer (Dispatcher)
 ↓
Gin Control-Plane (API)
 ↓
Orchestration (Job Brain)
 ↓
Executor (Background Goroutines)
 ↓
Security Tools
 ↓
Result
 ↓
Orchestration
 ↓
WebSocket → UI

Project Setup
1️⃣ Initialize Go Project
mkdir workers
cd workers
go mod init workers

2️⃣ Install Dependencies
go get github.com/joho/godotenv
go get go.uber.org/zap

3️⃣ Environment Variables

Create a .env file (do NOT commit it):

cp .env.example .env

4️⃣ Run (later)
go run control-plane/main.go


(Consumer and executor will be run as separate processes later.)

Folder Structure
workers/
├── config/             # Configuration & env loading
├── utils/              # Shared utilities (logger, queue helpers)
│
├── consumer/           # Queue consumer & dispatcher
│   ├── main.go         # Consumer bootstrap
│   ├── dispatcher.go   # Decide whether to hit Gin
│   └── handlers/
│       └── job.go      # Calls Gin to start jobs
│
├── control-plane/      # Gin HTTP API + WebSocket
│   ├── main.go         # Gin server entry point
│   ├── api/            # HTTP layer
│   └── websocket/      # Real-time job updates
│
├── orchestration/      # Job lifecycle & state management
│   ├── job_manager.go  # Job start, next task, completion
│   ├── job_state.go    # Job states (PENDING/RUNNING/etc.)
│   ├── job_store.go    # Persistence abstraction
│   └── job_registry.go # ASM / VA / IA definitions
│
├── executor/           # Background task execution
│   ├── runner/         # Executes a single task
│   ├── profiles/       # Scan profiles (ASM/VA/IA)
│   └── tools/          # Security tools (subfinder, httpx, etc.)
│
├── .env.example        # Environment variable template
├── go.mod
├── go.sum
└── README.md

Responsibilities (Very Important)
Consumer

Reads messages from the queue

Decides whether to trigger Gin

Never executes tools

Control-Plane (Gin)

Exposes APIs

Controls job lifecycle

Emits WebSocket events

Never runs heavy tasks

Orchestration

Brain of the system

Breaks jobs into tasks

Starts executor in background goroutines

Executor

Runs actual security tools

Stateless and isolated

Always executed asynchronously

Non-Negotiable Rules

Executor is never called directly from Gin handlers

Executor always runs in a goroutine

Consumer never runs tools

Control-plane never blocks on execution

All long-running work is asynchronous

Why This Design?

Prevents API timeouts

Survives worker crashes

Easy to scale horizontally

Clean separation of concerns

Future-proof (executor can be separated later)



Maintainer

CyberSential
Built by CuriousDevs
