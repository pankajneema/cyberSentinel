#!/usr/bin/env python3
"""Generate the CyberSentinel backend-redesign PDF."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    Preformatted, HRFlowable, KeepTogether, PageBreak,
)

OUT = "/sessions/cool-wizardly-fermi/mnt/cyberSentinel/docs/CyberSentinel-Backend-Redesign.pdf"

INDIGO = colors.HexColor("#4F46E5")
CYAN   = colors.HexColor("#0891B2")
INK    = colors.HexColor("#0F172A")
SUB    = colors.HexColor("#475569")
MUTED  = colors.HexColor("#64748B")
LINE   = colors.HexColor("#E2E8F0")
CODEBG = colors.HexColor("#F1F5F9")
CHIPBG = colors.HexColor("#EEF2FF")

styles = getSampleStyleSheet()

def S(name, **kw):
    return ParagraphStyle(name, parent=styles["Normal"], **kw)

body = S("body", fontName="Helvetica", fontSize=10, leading=15, textColor=INK, spaceAfter=6)
h1   = S("h1", fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=INDIGO, spaceBefore=14, spaceAfter=6)
h2   = S("h2", fontName="Helvetica-Bold", fontSize=12, leading=16, textColor=INK, spaceBefore=10, spaceAfter=4)
small= S("small", fontName="Helvetica", fontSize=8.5, leading=12, textColor=MUTED)
code = S("code", fontName="Courier", fontSize=8.2, leading=11.5, textColor=INK)
lead = S("lead", fontName="Helvetica", fontSize=10.5, leading=16, textColor=SUB, spaceAfter=8)

def codeblock(text):
    p = Preformatted(text, code)
    t = Table([[p]], colWidths=[168*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), CODEBG),
        ("BOX", (0,0), (-1,-1), 0.5, LINE),
        ("LEFTPADDING", (0,0), (-1,-1), 8),
        ("RIGHTPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ]))
    return t

def kv_table(rows, c0=42, c1=126):
    data = [[Paragraph(f"<b>{a}</b>", body), Paragraph(b, body)] for a, b in rows]
    t = Table(data, colWidths=[c0*mm, c1*mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LINEBELOW", (0,0), (-1,-2), 0.4, LINE),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
    ]))
    return t

def step_table(rows):
    data = [[Paragraph(f"<b><font color='#4F46E5'>{n}</font></b>", body),
             Paragraph(f"<b>{a}</b>", body),
             Paragraph(b, body)] for n, a, b in rows]
    t = Table(data, colWidths=[10*mm, 42*mm, 116*mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LINEBELOW", (0,0), (-1,-2), 0.4, LINE),
        ("TOPPADDING", (0,0), (-1,-1), 6),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
    ]))
    return t

story = []

# ---------- Title ----------
story.append(Spacer(1, 6))
story.append(Paragraph("CyberSentinel", S("brand", fontName="Helvetica-Bold", fontSize=26, textColor=INDIGO, leading=28)))
story.append(Paragraph("Backend Redesign — Task Execution for ASM / VS / CA", S("subtitle", fontName="Helvetica-Bold", fontSize=13, textColor=INK, leading=18, spaceBefore=2)))
story.append(Spacer(1, 4))
story.append(HRFlowable(width="100%", thickness=2, color=CYAN, spaceAfter=10))
story.append(Paragraph(
    "A queue-driven design where <b>Python (FastAPI)</b> owns everything the user touches, "
    "the <b>Go worker</b> does execution only, <b>Redis</b> is the nervous system "
    "(concurrency slots + live state + events), and <b>Postgres</b> is durable memory "
    "(run state + findings). The three services — ASM, VS, CA — share one identical flow; "
    "only their stage list and tools differ.", lead))
story.append(Paragraph("Reference kept from the current system: the ASM pipeline (stage design) and the tool wrappers. Everything else is redesigned.", small))
story.append(Spacer(1, 8))

# ---------- 1. Responsibilities ----------
story.append(Paragraph("1 · Component responsibilities", h1))
story.append(kv_table([
    ("Python / FastAPI", "User-facing surface: trigger scans, scheduler/cron, task command &amp; query API, live progress stream (SSE/WebSocket), reporting consumer, notifications."),
    ("Go worker", "Execution only. Consume job, admit via Redis slot, build pipeline, run tools concurrently, write findings + progress, push to reporting queue. Stateless, horizontally scalable."),
    ("RabbitMQ", "Transport. Per-service, per-priority job queues (asm/vs/ca . high/medium/low) with a dead-letter queue each, plus a reporting queue."),
    ("Redis", "Concurrency slots (global limit), live task/pipeline state, progress pub/sub, cancel flag, worker lease/heartbeat."),
    ("Postgres", "Durable run/task state and all findings, written incrementally during the run."),
]))
story.append(Spacer(1, 4))
story.append(Paragraph("Key decision: no separate Go &lsquo;Gin&rsquo; control-plane. Admission is an atomic Redis operation; task state and the command API live in FastAPI + Postgres. One source of truth, no synchronous hop in the hot path.", small))

# ---------- 2. Task lifecycle ----------
story.append(Paragraph("2 · Task lifecycle (one task, end to end)", h1))
story.append(step_table([
    ("1", "Trigger", "User clicks Run (or a scheduled/auto run fires). FastAPI writes the task row as PENDING and publishes one message to the matching queue. The cron does the same on time-match."),
    ("2", "Enqueue", "Message lands in asm.high / vs.low / etc., carrying task_id, org_id, target/asset, mode and config."),
    ("3", "Consume", "The Go worker for that service picks the message from its queue."),
    ("4", "Admit", "Worker acquires a slot in Redis (atomic, global max per service). Got a slot &rarr; ADMITTED; none free &rarr; backpressure (message waits)."),
    ("5", "Build", "Worker loads asset data, selects the stage list (the ASM pipeline reference), and writes the task JSON (stages + result slots) to Redis. State &rarr; RUNNING."),
    ("6", "Run stages", "In a goroutine, for each stage: resolve tool from registry &rarr; run &rarr; save findings to Postgres immediately &rarr; update progress in Redis &rarr; publish a progress event &rarr; check cancel flag &rarr; refresh lease."),
    ("7", "Live UI", "FastAPI subscribes to Redis pub/sub and streams events to the browser (SSE/WebSocket, org-scoped). User sees looking &rarr; finding &rarr; done per stage."),
    ("8", "Finish", "Last stage done &rarr; task COMPLETED, Redis slot released, message pushed to the reporting queue, goroutine ends."),
    ("9", "Report", "Python reporting consumer builds the report and fires a notification. Findings are already visible (from step 6)."),
]))
story.append(Spacer(1, 4))
story.append(Paragraph("<b>Safety paths:</b> Cancel &mdash; FastAPI sets task:{id}:cancel; the worker stops cleanly between stages &rarr; CANCELLED. Crash &mdash; the Redis lease expires; a reaper marks the task FAILED or requeues it and frees the slot.", small))

story.append(PageBreak())

# ---------- 3. Contracts ----------
story.append(Paragraph("3 · Contracts (lock these before code)", h1))

story.append(Paragraph("Queue topology (RabbitMQ)", h2))
story.append(codeblock(
"Job queues:  asm.high  asm.medium  asm.low\n"
"             vs.high   vs.medium   vs.low\n"
"             ca.high   ca.medium   ca.low\n"
"Each queue:  x-dead-letter-exchange -> <name>.dlq\n"
"Reporting:   reporting  (+ reporting.dlq)"))

story.append(Paragraph("Job message (Python publishes &rarr; Go consumes)", h2))
story.append(codeblock(
'{\n'
'  "type":     "asm|vs|ca",\n'
'  "priority": "high|medium|low",\n'
'  "task_id":  "uuid",\n'
'  "org_id":   "uuid",\n'
'  "asset_id": "uuid|null",\n'
'  "targets":  ["..."],\n'
'  "mode":     "LIGHT|NORMAL|DEEP",   // asm intensity / vs|ca scan mode\n'
'  "config":   { }\n'
'}'))

story.append(Paragraph("Task lifecycle states (Postgres + Redis agree)", h2))
story.append(codeblock("PENDING -> ADMITTED -> RUNNING -> COMPLETED | FAILED | CANCELLED"))

story.append(Paragraph("Redis keys", h2))
story.append(codeblock(
"slots:{service}          integer, atomic acquire/release vs configured max (global concurrency)\n"
"task:{task_id}           JSON: {status, current_stage, stages:[{name,tool,status,result}], started_at}\n"
"task:{task_id}:cancel    set to request cancellation\n"
"task:{task_id}:lease     TTL heartbeat; reaper requeues if it expires while RUNNING\n"
"task_events:{org_id}     pub/sub channel; worker publishes, FastAPI SSE subscribes"))

story.append(Paragraph("Postgres", h2))
story.append(Paragraph(
    "Reuse asm_discoveries + asm_discovery_runs for durable run/task state (add generic columns if VS/CA need them). "
    "ASM finding tables already exist (subdomains, ips, ports, services, ssl, endpoints&hellip;); add equivalent finding tables for VS and CA when those services are built.", body))

# ---------- 4. Structure ----------
story.append(Paragraph("4 · Worker folder structure (lean)", h1))
story.append(Paragraph("One shared engine; each service is essentially its stage list + how it saves. Tool wrappers are one thin file each (they shell out to real binaries).", body))
story.append(codeblock(
"worker/\n"
"|- main.go              boot, register asm/vs/ca, start consuming\n"
"|- config.go            env + pg + redis + rabbit connections\n"
"|- queue.go             consume/ack/nack(DLX) + publish + worker pool + drain\n"
"|- pipeline.go          THE engine: run stages -> redis state -> emit events -> cancel -> save hook\n"
"|- tools/\n"
"|    |- registry.go     name -> run func (self-registering)\n"
"|    |- exec.go         shared LookPath + Run (one place; no getToolPath copies)\n"
"|    \\- subfinder.go httpx.go nmap.go ...   one thin file per tool\n"
"\\- services/\n"
"     |- asm.go          stage lists (per mode / asset-type) + SaveFindings\n"
"     |- vs.go           same shape, different stages + tools\n"
"     \\- ca.go           same shape"))
story.append(Paragraph("A service answers only two questions: <b>what stages, in what order?</b> and <b>how do I save findings?</b> The engine (consume, admit, run loop, Redis state, events, cancel, reporting hand-off) is written once and shared by all three.", small))

story.append(Paragraph("Service files are structurally identical", h2))
story.append(Paragraph(
    "asm.go, vs.go and ca.go implement the same Service interface &mdash; the same members, "
    "in the same order, with the same signatures. Only the bodies differ. A reviewer diffing "
    "asm.go against vs.go must see the exact same skeleton, different logic inside.", body))
story.append(codeblock(
"type Service interface {\n"
'    Name() string                 // "asm" | "vs" | "ca"\n'
"    Queues() []string             // asm.high, asm.medium, asm.low\n"
"    Stages(job Job) []Stage       // pick stage list by mode / asset-type\n"
"    SaveFindings(ctx, task, stage, out) error\n"
"}\n\n"
"// each file, same order:\n"
"//  1 type   2 init()->RegisterService   3 Name   4 Queues\n"
"//  5 Stages (the only place the pipeline differs)   6 SaveFindings   7 private helpers"))
story.append(Paragraph(
    "Invariant: no service adds a public method the others lack, and no service-specific logic "
    "leaks into pipeline.go &mdash; the engine only ever calls the four interface methods.", small))

# ---------- 5. Phases ----------
story.append(Paragraph("5 · Phased build plan", h1))
story.append(Paragraph("Every phase compiles (go build ./... &amp; go vet ./...) and is independently testable. No big-bang rewrite.", body))
story.append(step_table([
    ("0", "Contracts", "Lock queue names, message schema, task states, and the Redis key schema (Section 3). Everything else depends on these."),
    ("1", "Skeleton", "main.go + config.go + queue.go + pipeline.go engine + tools/{registry,exec}; services/asm.go with a no-op pipeline. Builds green."),
    ("2", "Concurrency", "Redis slot acquire/release (atomic), task state in Redis, durable run-state writes to Postgres, lease + cancel plumbing."),
    ("3", "ASM pipeline", "Port the existing ASM stage config (reference). Engine runs stages via the tool registry; findings saved to Postgres incrementally."),
    ("4", "Live events", "Worker publishes stage events to Redis pub/sub; FastAPI SSE/WebSocket streams to the UI (org-scoped)."),
    ("5", "Reporting", "On completion push to the reporting queue; Python reporting consumer builds report + notification."),
    ("6", "Schedule / auto", "Python scheduler publishes to queues on cron match; auto = fixed-cadence rescan."),
    ("7", "Resilience", "Stale-task reaper (lease expiry), end-to-end cancellation, DLQ handling + bounded retries."),
    ("8", "VS then CA", "Copy the ASM service template; swap the stage config + tools/adapters. Same engine, same lifecycle."),
]))

story.append(Spacer(1, 6))
story.append(Paragraph("Definition of done", h2))
story.append(Paragraph(
    "One real ASM job flows end to end: <b>enqueue &rarr; admit &rarr; pipeline &rarr; live events &rarr; "
    "findings in Postgres &rarr; reporting &rarr; notification</b> &mdash; with working cancel and crash recovery. "
    "Then VS and CA are added by cloning the ASM service with different stages and tools.", body))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE); canvas.setLineWidth(0.5)
    canvas.line(20*mm, 14*mm, 190*mm, 14*mm)
    canvas.setFont("Helvetica", 8); canvas.setFillColor(MUTED)
    canvas.drawString(20*mm, 9*mm, "CyberSentinel — Backend Redesign (ASM / VS / CA)")
    canvas.drawRightString(190*mm, 9*mm, "Page %d" % doc.page)
    canvas.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=A4,
                        leftMargin=20*mm, rightMargin=20*mm,
                        topMargin=18*mm, bottomMargin=20*mm,
                        title="CyberSentinel Backend Redesign")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("WROTE", OUT)
