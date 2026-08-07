#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PA_MASTER_DIR="${PA_MASTER_DIR:-${ROOT_DIR}/../PAMASTER}"
TRADE_AGENT_DIR="${TRADE_AGENT_DIR:-${ROOT_DIR}/../TradeAgent}"
VIBE_PORT="${VIBE_PORT:-8900}"
PA_MASTER_PORT="${PA_MASTER_PORT:-8000}"
TRADE_AGENT_PORT="${TRADE_AGENT_PORT:-8002}"
FRONTEND_PORT="${FRONTEND_PORT:-5899}"
TRADE_RESEARCH_API_TOKEN="${TRADE_RESEARCH_API_TOKEN:-dev-token}"
RUN_DIR="${RUN_DIR:-$(mktemp -d -t vibe-research-local.XXXXXX)}"
PA_DB="${RUN_DIR}/pa-demo.db"
PIDS=()

usage() {
  cat <<'EOF'
Usage: scripts/start-local-stack.sh

Starts an isolated local demo stack:
  PA Master demo API     http://127.0.0.1:8000
  TradeAgent API         http://127.0.0.1:8002
  Vibe backend           http://127.0.0.1:8900
  Vibe frontend          http://127.0.0.1:5899

Environment overrides:
  PA_MASTER_DIR, TRADE_AGENT_DIR, RUN_DIR
  PA_MASTER_PORT, TRADE_AGENT_PORT, VIBE_PORT, FRONTEND_PORT
  TRADE_RESEARCH_API_TOKEN

The PA Master database is created under RUN_DIR and is seeded with demo data.
No IBKR or Notion credentials are used.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

fail() {
  echo "[local-stack] ERROR: $*" >&2
  exit 1
}

require_path() {
  [[ -d "$1" ]] || fail "directory not found: $1"
}

require_file() {
  [[ -x "$1" ]] || fail "executable not found: $1"
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local auth_header="${3:-}"
  local attempt
  for attempt in {1..40}; do
    if [[ -n "$auth_header" ]]; then
      if curl -fsS --max-time 2 -H "$auth_header" "$url" >/dev/null 2>&1; then
        echo "[local-stack] ${label} is ready: ${url}"
        return 0
      fi
    elif curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      echo "[local-stack] ${label} is ready: ${url}"
      return 0
    fi
    sleep 0.5
  done
  fail "timed out waiting for ${label}: ${url}"
}

cleanup() {
  trap - INT TERM EXIT
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "${PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
  echo "[local-stack] stopped; logs and demo database remain in ${RUN_DIR}"
}

trap cleanup INT TERM EXIT

require_path "$PA_MASTER_DIR"
require_path "$TRADE_AGENT_DIR"
require_path "$ROOT_DIR/backend"
require_path "$ROOT_DIR/frontend"
require_file "$PA_MASTER_DIR/backend/.venv/bin/alembic"
require_file "$PA_MASTER_DIR/backend/.venv/bin/python"
require_file "$TRADE_AGENT_DIR/.venv/bin/trade-research"
require_file "$ROOT_DIR/backend/.venv/bin/python"

mkdir -p "$RUN_DIR"

PA_ENV=(
  "PA_DATABASE_URL=sqlite+pysqlite:///${PA_DB}"
  "PA_NOTION_ENABLED=false"
  "PA_MARKET_DATA_PROVIDER=manual"
  "PA_ANALYTICS_AUTH_ENABLED=false"
)

echo "[local-stack] preparing isolated PA Master demo database: ${PA_DB}"
(
  cd "$PA_MASTER_DIR/backend"
  env "${PA_ENV[@]}" .venv/bin/alembic upgrade head >"${RUN_DIR}/pa-migrate.log" 2>&1
  env "${PA_ENV[@]}" .venv/bin/python -m pa_investing.scripts.seed_demo_portfolio >"${RUN_DIR}/pa-seed.log" 2>&1
)

echo "[local-stack] starting PA Master"
(
  cd "$PA_MASTER_DIR/backend"
  env "${PA_ENV[@]}" .venv/bin/uvicorn pa_investing.main:app \
    --host 127.0.0.1 --port "$PA_MASTER_PORT" \
    >"${RUN_DIR}/pa-master.log" 2>&1
) &
PIDS+=("$!")
wait_for_url "PA Master" "http://127.0.0.1:${PA_MASTER_PORT}/health"

echo "[local-stack] starting TradeAgent"
(
  cd "$TRADE_AGENT_DIR"
  TRADE_RESEARCH_API_TOKEN="$TRADE_RESEARCH_API_TOKEN" \
  TRADE_RESEARCH_PRICE_PROVIDER=yahoo \
  .venv/bin/trade-research serve --host 127.0.0.1 --port "$TRADE_AGENT_PORT" \
    >"${RUN_DIR}/trade-agent.log" 2>&1
) &
PIDS+=("$!")
wait_for_url "TradeAgent" "http://127.0.0.1:${TRADE_AGENT_PORT}/skills" \
  "Authorization: Bearer ${TRADE_RESEARCH_API_TOKEN}"

echo "[local-stack] starting Vibe backend"
(
  cd "$ROOT_DIR/backend"
  VR_TRADE_RESEARCH_ENABLED=true \
  VR_TRADE_RESEARCH_BASE_URL="http://127.0.0.1:${TRADE_AGENT_PORT}" \
  VR_TRADE_RESEARCH_API_TOKEN="$TRADE_RESEARCH_API_TOKEN" \
  VR_PA_MASTER_ENABLED=true \
  VR_PA_MASTER_BASE_URL="http://127.0.0.1:${PA_MASTER_PORT}" \
  .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port "$VIBE_PORT" \
    >"${RUN_DIR}/vibe-backend.log" 2>&1
) &
PIDS+=("$!")
wait_for_url "Vibe backend" "http://127.0.0.1:${VIBE_PORT}/api/health"
wait_for_url "Vibe skills bridge" "http://127.0.0.1:${VIBE_PORT}/api/research/skills"

echo "[local-stack] starting Vibe frontend"
(
  cd "$ROOT_DIR/frontend"
  npm run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT" >"${RUN_DIR}/vibe-frontend.log" 2>&1
) &
PIDS+=("$!")
wait_for_url "Vibe frontend" "http://127.0.0.1:${FRONTEND_PORT}/"

cat <<EOF

[local-stack] all services are ready
[local-stack] open: http://127.0.0.1:${FRONTEND_PORT}/portfolio
[local-stack] skills: http://127.0.0.1:${FRONTEND_PORT}/stock-data
[local-stack] logs:  ${RUN_DIR}

Search ASML.AS on the stock-data page, select worth-buy-stocks or markov-method,
and click Run Analysis. Press Ctrl-C here to stop all four services.
EOF

while :; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      fail "a service exited unexpectedly; inspect logs in ${RUN_DIR}"
    fi
  done
  sleep 2
done
