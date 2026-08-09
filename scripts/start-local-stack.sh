#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Keep secrets out of the command line while making the local launcher repeatable.
# `.env.local` is preferred; the Compose `.env` is accepted as a fallback.
# Both files are ignored by Git and may contain regular `NAME=value` lines.
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.local}"
if [[ ! -f "$ENV_FILE" && "$ENV_FILE" == "${ROOT_DIR}/.env.local" && -f "${ROOT_DIR}/.env" ]]; then
  ENV_FILE="${ROOT_DIR}/.env"
fi
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

TRADE_AGENT_DIR="${TRADE_AGENT_DIR:-${ROOT_DIR}/../TradeAgent}"
VIBE_PORT="${VIBE_PORT:-8900}"
TRADE_AGENT_PORT="${TRADE_AGENT_PORT:-8002}"
FRONTEND_PORT="${FRONTEND_PORT:-5899}"
TRADE_RESEARCH_API_TOKEN="${TRADE_RESEARCH_API_TOKEN:-dev-token}"
RUN_DIR="${RUN_DIR:-$(mktemp -d -t vibe-research-local.XXXXXX)}"
VIBE_LOCAL_DATA_DIR="${VIBE_LOCAL_DATA_DIR:-${VR_DATA_DIR:-${HOME}/.vibe-research}}"
# A root .env is commonly shared with Compose, where /data is a container-only
# mount. Never let that value redirect a host-local run to the machine's /data.
if [[ "$VIBE_LOCAL_DATA_DIR" == "/data" ]]; then
  VIBE_LOCAL_DATA_DIR="${HOME}/.vibe-research"
fi
VIBE_LOCAL_POSITION_STORE="${VIBE_LOCAL_POSITION_STORE:-${VR_IBKR_POSITION_STORE:-${VIBE_LOCAL_DATA_DIR}/ibkr-positions.json}}"
VIBE_LOCAL_ANALYTICS_STORE="${VIBE_LOCAL_ANALYTICS_STORE:-${VR_IBKR_ANALYTICS_STORE:-${VIBE_LOCAL_DATA_DIR}/ibkr-analytics.sqlite3}}"
if [[ "$VIBE_LOCAL_POSITION_STORE" == /data/* ]]; then
  VIBE_LOCAL_POSITION_STORE="${VIBE_LOCAL_DATA_DIR}/ibkr-positions.json"
fi
if [[ "$VIBE_LOCAL_ANALYTICS_STORE" == /data/* ]]; then
  VIBE_LOCAL_ANALYTICS_STORE="${VIBE_LOCAL_DATA_DIR}/ibkr-analytics.sqlite3"
fi
PIDS=()

usage() {
  cat <<'EOF'
Usage: scripts/start-local-stack.sh

Starts the local Vibe Research stack:
  TradeAgent API         http://127.0.0.1:8002
  Vibe backend           http://127.0.0.1:8900
  Vibe frontend          http://127.0.0.1:5899

Environment overrides:
  ENV_FILE (default: .env.local), TRADE_AGENT_DIR, RUN_DIR
  TRADE_AGENT_PORT, VIBE_PORT, FRONTEND_PORT
  TRADE_RESEARCH_API_TOKEN, VIBE_LOCAL_DATA_DIR

If .env.local contains VR_IBKR_FLEX_TOKEN and VR_IBKR_FLEX_QUERY_ID, the
launcher passes the credentials to Vibe's direct read-only IBKR analytics.
No orders are submitted.
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

if [[ -n "${VR_IBKR_FLEX_TOKEN:-}" || -n "${VR_IBKR_FLEX_QUERY_ID:-}" ]]; then
  [[ -n "${VR_IBKR_FLEX_TOKEN:-}" && -n "${VR_IBKR_FLEX_QUERY_ID:-}" ]] || \
    fail "set both VR_IBKR_FLEX_TOKEN and VR_IBKR_FLEX_QUERY_ID, or leave both empty"
fi
if [[ -n "${VR_IBKR_FLEX_HISTORY_QUERY_ID:-}" && -z "${VR_IBKR_FLEX_TOKEN:-}" ]]; then
  fail "VR_IBKR_FLEX_HISTORY_QUERY_ID requires VR_IBKR_FLEX_TOKEN"
fi

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
  if [[ ${#PIDS[@]} -gt 0 ]]; then
    for pid in "${PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    done
    for pid in "${PIDS[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi
  echo "[local-stack] stopped; logs remain in ${RUN_DIR}"
}

trap cleanup INT TERM EXIT

require_path "$TRADE_AGENT_DIR"
require_path "$ROOT_DIR/backend"
require_path "$ROOT_DIR/frontend"
require_file "$TRADE_AGENT_DIR/.venv/bin/trade-research"
require_file "$ROOT_DIR/backend/.venv/bin/python"

mkdir -p "$RUN_DIR" "$VIBE_LOCAL_DATA_DIR"

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
  VR_DATA_DIR="$VIBE_LOCAL_DATA_DIR" \
  VR_IBKR_POSITION_STORE="$VIBE_LOCAL_POSITION_STORE" \
  VR_IBKR_ANALYTICS_STORE="$VIBE_LOCAL_ANALYTICS_STORE" \
  VR_IBKR_FLEX_TOKEN="${VR_IBKR_FLEX_TOKEN:-}" \
  VR_IBKR_FLEX_QUERY_ID="${VR_IBKR_FLEX_QUERY_ID:-}" \
  VR_IBKR_FLEX_HISTORY_QUERY_ID="${VR_IBKR_FLEX_HISTORY_QUERY_ID:-}" \
  VR_IBKR_FLEX_BASE_URL="${VR_IBKR_FLEX_BASE_URL:-https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService}" \
  VR_IBKR_FLEX_TIMEZONE="${VR_IBKR_FLEX_TIMEZONE:-Europe/London}" \
  VR_IBKR_FLEX_COOLDOWN_SECONDS="${VR_IBKR_FLEX_COOLDOWN_SECONDS:-300}" \
  VR_IBKR_FLEX_TIMEOUT_SECONDS="${VR_IBKR_FLEX_TIMEOUT_SECONDS:-20}" \
  VR_IBKR_FLEX_REQUEST_RETRIES="${VR_IBKR_FLEX_REQUEST_RETRIES:-1}" \
  VR_IBKR_FLEX_RETRIES="${VR_IBKR_FLEX_RETRIES:-3}" \
  VR_IBKR_FLEX_RETRY_DELAY_SECONDS="${VR_IBKR_FLEX_RETRY_DELAY_SECONDS:-5}" \
  VR_IBKR_FLEX_INTER_QUERY_DELAY_SECONDS="${VR_IBKR_FLEX_INTER_QUERY_DELAY_SECONDS:-5}" \
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
[local-stack] data:  ${VIBE_LOCAL_DATA_DIR}
[local-stack] IBKR diagnostics: tail -f ${RUN_DIR}/vibe-backend.log

Search ASML.AS on the stock-data page, select worth-buy-stocks or markov-method,
and click Run Analysis. Press Ctrl-C here to stop all three services.
EOF

while :; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      fail "a service exited unexpectedly; inspect logs in ${RUN_DIR}"
    fi
  done
  sleep 2
done
