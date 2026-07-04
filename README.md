# Receipt Drop

Tiny public Vercel site for sending short messages to the receipt printer.

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
| Public URL | `https://receipt-ochre.vercel.app` |
| Vercel project | `receipt` |
| Project ID | `prj_6NMgc4lea1LVK1lTvEigmrOGmrZh` |
| Team ID | `team_iZEAAYwSLBCiQH7XCdZvRL6H` |
| Latest checked deployment | `dpl_2qSwuLEg6cyT7TeE7LD6BaHqM5Jy` |
| Runtime region | `iad1` |
| Source | Vercel CLI deploy from this local folder |

## Runtime Behavior

- Public submissions are accepted by `/api/submit`.
- Valid messages are pushed into the Redis list `receipt-drop:queue`.
- The old MBP LaunchAgent polls `/api/poll` with `POLL_TOKEN`.
- `/api/poll` uses Redis `lpop`, so a message is removed once the poller requests it.
- To avoid losing messages, the MBP poller checks the local CUPS queue and USB printer presence before polling.
- If the printer is unplugged, powered off, or not visible over USB, the poller sends an offline heartbeat and leaves messages in Redis.
- `/api/status` reads the heartbeat and powers the public "Printer Online/Offline" indicator.

## Paused Future Plan: Square Rendered Messages

Future public-message printouts are planned to become rendered square images. This is not active production behavior yet.

Planned constraints:

- applies only to public messages from `https://receipt-ochre.vercel.app`
- target size is `72mm x 72mm`
- rendering happens locally in the old MBP poller
- Vercel should continue queueing plain text
- all allowed `240` character messages must fit
- design should be message-first
- timestamp info stays, with final styling TBD
- public website does not show a receipt preview for now

Wait for reference images and final template direction before implementing this.

## Safety Defaults

- `240` character maximum
- plain text only
- links rejected
- honeypot field for simple bots
- 2 messages per IP per hour
- 30 total messages per day
- duplicate messages rejected for 6 hours
- print queue is pulled by a private token

## Required Vercel Env Vars

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
POLL_TOKEN
PRINT_ENABLED=true
RATE_LIMIT_MAX=2
RATE_LIMIT_WINDOW_SECONDS=3600
DAILY_LIMIT=30
MESSAGE_MAX_CHARS=240
```

Use a long random value for `POLL_TOKEN`.

## Local Development

This project is a small static site plus Vercel serverless functions. `npm run dev` intentionally uses a local preview stub instead of `vercel dev`, because v0 and other sandboxes may not have Vercel CLI credentials.

```bash
npm install
cp .env.example .env.local
npm run dev
```

The local preview server stubs `/api/status` and `/api/submit`; it does not write to Redis or print.

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

Before production deploy, create/connect an Upstash Redis resource in Vercel Marketplace and add the env vars above.

Recommended order:

1. Create/import the `receipt-drop` project in Vercel.
2. Add an Upstash Redis marketplace resource to that project.
3. Confirm these env vars exist in Vercel: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
4. Add `POLL_TOKEN` as a secret env var.
5. Add the safety env vars from the list above.
6. Deploy.

CLI path:

```bash
cd /Users/davidsutrin/Library/Developer/receipt-drop
npx vercel link --yes --project receipt --scope davidsutrin
npx vercel env add POLL_TOKEN production
npx vercel env add PRINT_ENABLED production
npx vercel env add RATE_LIMIT_MAX production
npx vercel env add RATE_LIMIT_WINDOW_SECONDS production
npx vercel env add DAILY_LIMIT production
npx vercel env add MESSAGE_MAX_CHARS production
npx vercel --prod
```

Use these values:

```text
PRINT_ENABLED=true
RATE_LIMIT_MAX=2
RATE_LIMIT_WINDOW_SECONDS=3600
DAILY_LIMIT=30
MESSAGE_MAX_CHARS=240
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
lp -d EPSON_TM_T88V
```

Check status from the MacBook Air:

```bash
ssh ds-mbp 'launchctl print gui/$(id -u)/com.davidsutrin.receipt-drop-poller'
ssh ds-mbp 'lpstat -p EPSON_TM_T88V -a EPSON_TM_T88V -d'
ssh ds-mbp 'tail -40 ~/Library/Logs/receipt-drop/poller.out.log'
curl -s https://receipt-ochre.vercel.app/api/status
```

The poller config lives at:

```text
/Users/ddd/Library/Application Support/receipt-drop/poller.env
```

Expected values, with the token redacted:

```text
RECEIPT_DROP_URL=https://receipt-ochre.vercel.app
RECEIPT_DROP_TOKEN=[redacted POLL_TOKEN]
RECEIPT_DROP_INTERVAL=15
RECEIPT_DROP_PRINTER=EPSON_TM_T88V
RECEIPT_DROP_PRINT_MODE=local
```
