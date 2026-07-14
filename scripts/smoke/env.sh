# Source this in EACH terminal you use for the smoke test:
#   source scripts/smoke/env.sh
# Sets ROOT/PYTHONPATH/PY/PGPASSWORD and defines helpers: pg, rediscli, rabbitq

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
export ROOT
cd "$ROOT" || return 1

export PYTHONPATH="$ROOT:$ROOT/backend:$ROOT/backend/api_service"
export PY="$ROOT/backend/api_service/.venv-run/bin/python"
export RABBITMQ_URL="amqp://guest:guest@localhost:5672/"
export PGPASSWORD="$(grep -E '^DATABASE_URL=' backend/api_service/.env | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')"

pg()       { psql -h localhost -U postgres -d cybersentinel -tA "$@"; }
rediscli() { docker exec cybersentinel-redis-1 redis-cli "$@"; }
rabbitq()  { docker exec cybersentinel-rabbitmq-1 rabbitmqctl "$@"; }
taskstate(){ rediscli GET "task:$1" | python3 -m json.tool; }

echo "smoke env ready (ROOT=$ROOT). helpers: pg, rediscli, rabbitq, taskstate <task_id>"
