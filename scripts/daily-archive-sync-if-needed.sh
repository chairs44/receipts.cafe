#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_DIR="/Users/davidsutrin/Library/Developer/receipt-drop"
STATE_DIR="/Users/davidsutrin/Library/Application Support/receipt-cafe"
STATE_FILE="$STATE_DIR/archive-sync-last-success"
SYNC_AFTER="0910"
NPM_BIN="/usr/local/bin/npm"

mkdir -p "$STATE_DIR"

today="$(date +%Y-%m-%d)"
now_hm="$(date +%H%M)"

if [[ -f "$STATE_FILE" ]] && [[ "$(cat "$STATE_FILE")" == "$today" ]]; then
  echo "receipt.cafe archive sync already completed for $today"
  exit 0
fi

if [[ "$now_hm" < "$SYNC_AFTER" ]]; then
  echo "receipt.cafe archive sync waiting until after 09:10"
  exit 0
fi

cd "$PROJECT_DIR"
"$NPM_BIN" run sync:archive
printf "%s" "$today" > "$STATE_FILE"
echo "receipt.cafe archive sync marked complete for $today"
