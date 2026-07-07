# Architecture Diagrams

> Full-system diagrams for CyberSentinel. Every service, store, queue, and connection. Mermaid renders in GitHub and most Markdown viewers.

**Related:** [Overview](overview.md) · [Inventory](../00_inventory.md) · [Infra](../04_infra_and_api_guide/infra.md)

---

## 1. System component diagram

```mermaid
flowchart TB
  subgraph Client
    U[User Browser]
  end
  subgraph Experience Plane
    FE[React SPA<br/>Vite · shadcn/ui]
  end
  subgraph Control Plane
    API[api_service<br/>FastAPI]
    SCH[Scheduler loop]
    NS[notificationservice<br/>in-process]
    WS[[WebSocket /ws/realtime]]
  end
  subgraph Execution Plane
    CON[consumer<br/>Go]
    CP[control-plane<br/>Go · Gin]
    TOOLS[[nmap · naabu · nuclei<br/>subfinder · gitleaks · asnmap]]
  end
  subgraph Ingestion
    REP[reporting<br/>Python consumer]
  end
  subgraph Stores
    PG[(PostgreSQL)]
    RD[(Redis)]
    MQ[(RabbitMQ)]
    CH[(ClickHouse<br/>reserved)]
  end
  subgraph External
    SB[(Supabase Auth)]
    CHAN[Slack · Teams · SMTP]
  end

  U <--> FE
  FE -->|REST /api/v1| API
  FE <-->|WS| WS
  FE -.->|login/OAuth| SB
  API --> PG
  API --> RD
  API -->|publish jobs.asm| MQ
  API -.->|verify JWT / JWKS| SB
  SCH --> PG
  SCH -->|re-enqueue| MQ
  API --- NS
  NS --> RD
  NS --> PG
  NS --> CHAN
  NS --- WS
  MQ -->|jobs.asm| CON
  CON -->|HTTP X-Internal-Token| CP
  CP --> PG
  CP --> RD
  CP --> TOOLS
  CP -->|publish report.asm| MQ
  CP -->|asm:worker:events| RD
  MQ -->|report.asm| REP
  REP --> RD
  REP --> PG
  API -.->|reserved| CH
```

---

## 2. Deployment diagram (docker-compose today)

```mermaid
flowchart LR
  subgraph host [Docker host / K8s namespace]
    fe[frontend :8080]
    api[api :8000]
    wcp[worker-control-plane]
    cons[consumer]
    rep[reporting]
    pg[(postgres :5432)]
    rd[(redis :6379)]
    mq[(rabbitmq :5672 / mgmt :15672)]
  end
  fe --> api
  api --> pg & rd & mq
  cons --> mq
  cons --> wcp
  wcp --> pg & rd & mq
  rep --> pg & mq & rd
```

Containers and their `depends_on` health-gates are detailed in the [Infra Guide](../04_infra_and_api_guide/infra.md). Note `reporting` and `worker-control-plane` publish no ports; only `frontend`, `api`, and the store management UIs are reachable.

---

## 3. Request lifecycle (authenticated REST call)

```mermaid
sequenceDiagram
  participant FE
  participant CORS as CORSMiddleware
  participant SEC as SecurityHeaders + 500 handler
  participant RL as RateLimit (Redis)
  participant OBS as Observability
  participant DEP as Deps: verify JWT → CurrentUser → require_role → get_db
  participant H as Route handler
  participant PG as Postgres

  FE->>CORS: HTTPS request + Bearer JWT
  CORS->>SEC: allow-listed origin
  SEC->>RL: attach security headers
  RL->>OBS: fixed-window check (fail-open)
  OBS->>DEP: correlation_id, logging
  DEP->>DEP: verify Supabase JWT (alg pinned)
  DEP->>PG: load member_profile → role, org_id
  DEP->>H: CurrentUser + org scope
  H->>PG: query scoped to org_id
  H-->>FE: JSON (or 401/403/500 generic)
```

---

## 4. Class/model relationships (tenancy + ASM core)

```mermaid
classDiagram
  Organization "1" --> "*" MemberProfile
  Organization "1" --> "*" OrgInvite
  Organization "1" --> "*" AuditLog
  Organization "1" --> "*" Asset
  Organization "1" --> "*" AsmDiscovery
  MemberProfile "1" --> "1" MemberSettings
  AsmDiscovery "1" --> "*" AsmDiscoveryRun
  AsmDiscovery "1" --> "*" AsmSubdomain
  AsmDiscovery "1" --> "*" AsmIP
  AsmIP "1" --> "*" AsmPort
  AsmIP "1" --> "*" AsmService
  AsmDiscovery "1" --> "*" AsmSSLCert
  AsmDiscovery "1" --> "*" AsmRepoFinding
  AsmDiscovery "1" --> "*" AsmSaasApp
  AsmDiscovery "1" --> "*" AsmUserAccount
  class Organization {
    id
    name
    plan
    owner_user_id
  }
  class MemberProfile {
    org_id FK
    supabase_user_id
    role: owner|admin|analyst|reader
    is_active
  }
  class AsmDiscovery {
    org_id FK
    asset_type
    intensity
    schedule_type
    status
  }
  class AsmIP {
    exposure_score
    exposure_level
    score_explanation
  }
```

Full ER diagram with every column is in the [Database Guide](../05_database_guide.md).

---

## 5. Two message systems (do not confuse them)

```mermaid
flowchart LR
  subgraph RabbitMQ [RabbitMQ — durable work transport]
    q1[jobs.asm]
    q2[report.asm]
  end
  subgraph Redis [Redis — coordination + realtime]
    p1[[asm:worker:events pub/sub]]
    p2[[rt:events pub/sub]]
    k1[asm:pipeline:id state]
    k2[dedup + rate-limit keys]
  end
  API -->|enqueue scan| q1
  q1 --> Consumer --> ControlPlane
  ControlPlane -->|results| q2 --> Reporting
  ControlPlane -->|lifecycle| p1 --> Notif
  Notif -->|cross-replica| p2 --> Notif
  ControlPlane --> k1 --> Reporting
```

**Rule of thumb:** RabbitMQ carries *work that must not be lost* (jobs, results). Redis carries *coordination and ephemeral realtime* (pipeline scratch state, pub/sub events, dedup, rate limits).
