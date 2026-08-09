#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

PYTHON="${ROOT_DIR}/backend/.venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  echo "Python environment not found: ${PYTHON}" >&2
  exit 2
fi

exec "$PYTHON" "${ROOT_DIR}/scripts/inspect_ibkr_flex.py" "${1:-current}"
