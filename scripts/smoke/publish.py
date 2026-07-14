"""Publish a unified scan job to <type>.<priority> (smoke test).

    $PY scripts/smoke/publish.py <type> <task_id> <org_id> '<targets_json>' <MODE> '<config_json>' [asset_id]

e.g.  $PY scripts/smoke/publish.py asm $DISC_ID $ORG_ID '["example.com"]' LIGHT '{"asset_type":"domain"}' $ASSET_ID
"""
import sys, json, os, pika
from backend.api_service.utils.scan_contracts import build_job_message, job_queue

typ, task_id, org_id = sys.argv[1], sys.argv[2], sys.argv[3]
targets = json.loads(sys.argv[4]) if len(sys.argv) > 4 else []
mode = sys.argv[5] if len(sys.argv) > 5 else "LIGHT"
config = json.loads(sys.argv[6]) if len(sys.argv) > 6 else {}
asset_id = sys.argv[7] if len(sys.argv) > 7 else None

msg = build_job_message(type=typ, priority="medium", task_id=task_id, org_id=org_id,
                        asset_id=asset_id, targets=targets, mode=mode, config=config)
q = job_queue(typ, "medium")

conn = pika.BlockingConnection(pika.URLParameters(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")))
ch = conn.channel()
ch.exchange_declare(q + ".dlx", exchange_type="fanout", durable=True)
ch.queue_declare(q + ".dlq", durable=True)
ch.queue_bind(q + ".dlq", q + ".dlx")
ch.queue_declare(q, durable=True, arguments={"x-dead-letter-exchange": q + ".dlx"})
ch.basic_publish(exchange="", routing_key=q, body=json.dumps(msg).encode(),
                 properties=pika.BasicProperties(content_type="application/json", delivery_mode=2))
print(f"PUBLISHED -> {q}  task_id={task_id}")
conn.close()
