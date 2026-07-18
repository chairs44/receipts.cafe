#!/usr/bin/env bash
set -euo pipefail

REMOTE="${RECEIPT_CAFE_REMOTE:-ds-mbp}"
REMOTE_ARCHIVE="${RECEIPT_CAFE_REMOTE_ARCHIVE:-~/Library/Application Support/receipt.cafe/archive}"
LOCAL_ARCHIVE="${RECEIPT_CAFE_LOCAL_ARCHIVE:-$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/hub/projects/homelab/printer/receipt-cafe/archive}"

mkdir -p "$LOCAL_ARCHIVE/images"

quote_remote_path() {
  printf "%q" "$1"
}

REMOTE_CSV="$(quote_remote_path "$REMOTE_ARCHIVE/exports/receipt-cafe-log.csv")"
REMOTE_IMAGES="$(quote_remote_path "$REMOTE_ARCHIVE/images/")"

scp "$REMOTE:$REMOTE_CSV" "$LOCAL_ARCHIVE/receipt-cafe-log.csv" 2>/dev/null || true
rsync -az "$REMOTE:$REMOTE_IMAGES" "$LOCAL_ARCHIVE/images/"

echo "receipt.cafe archive synced to:"
echo "$LOCAL_ARCHIVE"
