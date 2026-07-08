# receipt.cafe

Tiny public Vercel site for sending short messages to David's receipt printer.

## Architecture

```text
public Vercel page
  -> /api/submit validates and rate-limits
  -> Upstash Redis queue
  -> old MBP poller
  -> local Epson printer
```

The public site never talks directly to the home network.
The MacBook Air is not required for normal printing.

## Current Production

| Item | Value |
|---|---|
| Public URL | `https://receipts.cafe` |
| Vercel project | `receipt` |
| Project ID | `prj_6NMgc4lea1LVK1lTvEigmrOGmrZh` |
| Team ID | `team_iZEAAYwSLBCiQH7XCdZvRL6H` |
| GitHub repo | `chairs44/receipts.cafe` |
| Runtime region | `iad1` |
| Source | GitHub-connected Vercel deploys from `main` |

## Runtime Behavior

- Public submissions are accepted by `/api/submit`.
- Valid messages are pushed into the Redis list `receipt-drop:queue`.
- The old MBP LaunchAgent polls `/api/poll` with `POLL_TOKEN`.
- `/api/poll` uses Redis `lmove` to claim a message into `receipt-drop:inflight`; the poller calls `/api/ack` only after `lp` succeeds.
- Every claimed message gets `claimedAt`, `claimId`, and an incremented `attempts` count.
- Before each new claim, `/api/poll` recovers stale inflight messages older than `INFLIGHT_STALE_SECONDS` and requeues them.
- To avoid losing messages, the MBP poller checks the local CUPS queue and USB printer presence before polling.
- If the printer is unplugged, powered off, or not visible over USB, the poller sends an offline heartbeat and leaves messages in Redis.
- `/api/status` reads the heartbeat and powers the public "Printer Online/Offline" indicator.

## Print And Archive Template

Public messages use one shared raster receipt renderer in the old MBP poller.
That same render path feeds:

- raw ESC/POS bytes sent to the Epson printer
- archived `.txt` receipt text
- archived `.png` visual preview

Current template:

```text
          WWW.RECEIPTS.CAFE
        ------------------------
        Message text wraps left-
        aligned in the body.
        ------------------------
          2026-07-08 16:36
```

Vercel still only receives and queues plain text. The home network is not
exposed, and public visitors do not see a receipt preview.

The old MBP renders the receipt as a 512px-wide 1-bit image, sends that image
to the printer as raw ESC/POS raster data, and saves the same image as the
archive PNG. Existing SVG files in the archive are legacy previews only; new
archive entries should use PNG as the visual source of truth.

## Safety Defaults

- `300` character maximum
- plain text only
- links rejected
- honeypot field for simple bots
- 3 messages per IP per hour
- 30 total messages per day
- duplicate messages rejected for 6 hours
- print queue is pulled by a private token

## Required Vercel Env Vars

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
POLL_TOKEN
PRINT_ENABLED=true
RATE_LIMIT_MAX=3
RATE_LIMIT_WINDOW_SECONDS=3600
DAILY_LIMIT=30
MESSAGE_MAX_CHARS=300
INFLIGHT_STALE_SECONDS=600
```

Use a long random value for `POLL_TOKEN`.
If `INFLIGHT_STALE_SECONDS` is omitted, `/api/poll` defaults to `600`.

## Local Development

This project is a small static site plus Vercel serverless functions. `npm run dev` intentionally uses a local preview stub instead of `vercel dev`, because v0 and other sandboxes may not have Vercel CLI credentials.

```bash
npm install
npm run dev
```

The local preview server stubs the public and worker API routes; it does not write to Redis or print.

If you need real Vercel/Redis development locally, create an ignored `.env.local` file manually. Never commit `.env*` files.

## Vercel Setup

Team detected through the Vercel plugin:

```text
davidsutrin
team_iZEAAYwSLBCiQH7XCdZvRL6H
```

The current Vercel project is named:

```text
receipt
```

The existing project is connected to GitHub:

```text
https://github.com/chairs44/receipts.cafe
```

Vercel production deploys from `main`. Existing Vercel env vars should remain attached to the `receipt` project.

Manual fallback deploy path:

```bash
cd /Users/davidsutrin/Library/Developer/receipt-drop
npx vercel --prod
```

Use these values:

```text
PRINT_ENABLED=true
RATE_LIMIT_MAX=3
RATE_LIMIT_WINDOW_SECONDS=3600
DAILY_LIMIT=30
MESSAGE_MAX_CHARS=300
```

## Old MBP Printer Poller

The always-on poller now runs on the old MBP:

```text
/Users/ddd/Library/Developer/receipt-drop
/Users/ddd/Library/Application Support/receipt-drop/poller.env
/Users/ddd/Library/LaunchAgents/com.davidsutrin.receipt-drop-poller.plist
```

It prints locally via:

```text
lp -o raw -d EPSON_TM_T88V
```

Check status from the MacBook Air:

```bash
ssh ds-mbp 'launchctl print gui/$(id -u)/com.davidsutrin.receipt-drop-poller'
ssh ds-mbp 'lpstat -p EPSON_TM_T88V -a EPSON_TM_T88V -d'
ssh ds-mbp 'tail -40 ~/Library/Logs/receipt-drop/poller.out.log'
curl -s https://receipts.cafe/api/status
curl -H "Authorization: Bearer $POLL_TOKEN" https://receipts.cafe/api/admin
```

The poller config lives at:

```text
/Users/ddd/Library/Application Support/receipt-drop/poller.env
```

Expected values, with the token redacted:

```text
RECEIPT_DROP_URL=https://receipts.cafe
RECEIPT_DROP_TOKEN=[redacted POLL_TOKEN]
RECEIPT_DROP_INTERVAL=15
RECEIPT_DROP_PRINTER=EPSON_TM_T88V
RECEIPT_DROP_PRINT_MODE=local
```

## Archive

The old MBP poller keeps the authoritative private archive locally:

```text
/Users/ddd/Library/Application Support/receipt.cafe/archive
```

Archive contents:

```text
events/claimed.jsonl
events/printed.jsonl
events/failed.jsonl
receipts/YYYY/MM/DD/*.txt
images/YYYY/MM/DD/*.png
exports/receipt-cafe-log.csv
```

Redis also keeps a short recovered-job log at `receipt-drop:recovered`. This is operational state rather than a permanent archive.

The CSV and receipt previews can be mirrored to the Obsidian/iCloud project folder from the MacBook Air:

```bash
npm run sync:archive
```

On the MacBook Air, a LaunchAgent runs `scripts/daily-archive-sync-if-needed.sh` every 30 minutes. The wrapper syncs at most once per day, after 9:10 AM, so it catches up later if the Air is asleep or offline at the target time.

Default local mirror:

```text
/Users/davidsutrin/Library/Mobile Documents/iCloud~md~obsidian/Documents/hub/projects/homelab/printer/receipt-cafe/archive
```

If iCloud Drive is later enabled on the old MBP, set `RECEIPT_DROP_MIRROR_DIR` in the MBP poller env to mirror the CSV and visual previews automatically after each print. Printing does not depend on the mirror path.
