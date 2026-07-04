#!/bin/zsh
set -euo pipefail

ENV_FILE="$HOME/Library/Application Support/receipt-drop/poller.env"
SCRIPT_DIR="${0:A:h}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

exec /usr/bin/python3 "$SCRIPT_DIR/receipt-drop-poller.py"
