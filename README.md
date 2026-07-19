# receipts.cafe

receipts.cafe allows users to submit anonymous messages that are physically
printed in real time as thermal receipts and digitally archived for anyone to
view.

Live site: [receipts.cafe](https://receipts.cafe)

## How It Works

```text
visitor
  -> Vercel web app and API
  -> Upstash Redis queue
  -> always-on Mac poller
  -> CUPS
  -> Epson TM-T88V thermal printer
```

The public Vercel deployment never connects directly to the home network. The
always-on Mac is the print worker. A development Mac is used for source changes
and deployments, but is not required for normal printing.

The repository contains the public site, Vercel API routes, and a portable copy
of the poller source. The live poller is installed separately on the always-on
Mac and is not updated automatically by GitHub or Vercel. Private runtime
configuration, message archives, printer output, and machine-specific
launch-agent files stay outside the repository.

## Production Behavior

- `/api/submit` validates and rate-limits visitor messages.
- Accepted messages are added to the Redis queue.
- The Mac poller authenticates to `/api/poll` with a private bearer token.
- The poller claims a message, renders the shared receipt template locally,
  prints it through CUPS, and acknowledges it only after printing succeeds.
- If the printer is unavailable, the poller leaves queued messages in Redis.
- Stale in-flight claims are recovered automatically after the configured
  timeout.
- `/api/status` powers the public printer status indicator.

The current public limits are 300 characters per message, 3 messages per IP
per hour, 30 messages per day, duplicate suppression, link rejection, and a
honeypot field for simple bots. These limits are operational safeguards, not a
promise that every submitted message will be printed immediately.

## Local Development

This is a small static site with Vercel serverless functions. The normal local
preview intentionally uses a credential-free stub instead of `vercel dev`.

```bash
npm install
npm run check
npm run dev
```

The preview server does not write to Redis or print. For real deployment
testing, use a private `.env.local` file that is ignored by Git.

Never place tokens, private messages, printer archives, home-network details,
or machine-specific configuration in the repository.

## Configuration

Vercel production configuration is stored in Vercel Environment Variables.
The names currently used by the API are:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
POLL_TOKEN
PRINT_ENABLED
RATE_LIMIT_MAX
RATE_LIMIT_WINDOW_SECONDS
DAILY_LIMIT
MESSAGE_MAX_CHARS
INFLIGHT_STALE_SECONDS
```

The poller reads its private environment file from a machine-local path. A
typical setup uses:

```text
~/Library/Application Support/receipt.cafe/poller.env
```

The file should contain the production URL, private poll token, printer name,
poll interval, and local print mode. It must remain outside Git and have
restrictive permissions.

### Runtime Worker Deployment

Changes to `scripts/receipt-drop-poller.py` do not reach the live printer worker
automatically. Deploy poller changes deliberately to the always-on Mac, verify
the local printer queue and worker state, and keep its environment file and
launch-agent configuration machine-local. Website deployments can continue
independently through Vercel.

## Archive And Privacy

The authoritative receipt archive is kept on the always-on Mac outside this
repository. It may contain message text, timestamps, rendered receipt images,
and operational event logs. A private iCloud/Obsidian mirror can be maintained
separately for personal access.

The public repository does not contain visitor messages or archive images.
Public submissions should not be used for passwords, confidential information,
or anything that must remain private. See [SECURITY.md](SECURITY.md) for the
project's security and reporting policy.

## Deployment

The `main` branch is connected to the Vercel project that serves
`receipts.cafe`. Changes should be reviewed locally, checked with
`npm run check`, and then pushed to GitHub. Vercel creates the production
deployment from `main`.

The Vercel project and its environment variables are managed in Vercel, not in
this repository. Do not commit `.env` files or `.vercel/` metadata.

The repository may be viewed publicly. Keep operational documentation generic:
do not add real hostnames, IP addresses, usernames, absolute local paths,
credentials, Redis exports, poller environment files, launch-agent plists, or
visitor archives to commits, issues, pull requests, or screenshots.

## Scope And Status

This repository is intentionally small. It is the public text submission and
printing system, not a general-purpose messaging service. Future ideas such as
a public scanned archive, richer receipt rendering, image submission, and
additional galleries should be designed separately and added only with clear
privacy and operational boundaries.

## License

Copyright (c) 2026 David Sutrin. All rights reserved. See [LICENSE](LICENSE).
