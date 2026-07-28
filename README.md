# receipts.cafe

> Anonymous messages, physically printed as thermal receipts.

[Live site](https://receipts.cafe) · [Security policy](SECURITY.md) · [Contributing](CONTRIBUTING.md)

receipts.cafe is a small public art project. A visitor submits a short anonymous
message online; an always-on local print worker renders it as a receipt and
prints it on an Epson TM-T88V thermal printer.

## At A Glance

| | |
| --- | --- |
| Public interface | Text-only anonymous message submission |
| Delivery path | Vercel → Upstash Redis → local print worker → CUPS |
| Runtime printer | Epson TM-T88V thermal printer |
| Website | [receipts.cafe](https://receipts.cafe) |
| Archive | Private while the visual archive is being prepared |

The public Vercel deployment never connects directly to the home network or
printer. The always-on Mac runs the isolated print worker. A development Mac is
used for source changes and deployments, but is not required for normal
printing.

## How It Works

```text
visitor
  → Vercel web app and API
  → Upstash Redis queue
  → always-on Mac poller
  → CUPS
  → Epson TM-T88V thermal printer
```

1. A visitor submits a short message through the website.
2. The Vercel API validates it and places it in the Redis queue.
3. The private poller claims the message and renders the shared receipt template
   locally.
4. CUPS prints the receipt. The job is acknowledged only after printing
   succeeds.
5. If the printer is unavailable, the message stays queued. Stale in-flight
   claims recover automatically.

## Public Safeguards

- 300 characters per message
- 3 messages per IP per hour
- 10 messages per IP per day
- 100 messages globally per day
- Duplicate suppression, link rejection, a honeypot field, and same-origin
  JSON submission handling
- A private bearer token protects poller routes

These limits are operational safeguards, not a promise that every message prints
immediately. Do not submit passwords, private information, or anything that
must remain confidential.

## Repository Boundaries

This repository contains the public site, Vercel API routes, and a portable copy
of the poller source. It intentionally does **not** include:

- production secrets, Redis credentials, or poller tokens
- visitor messages, receipt scans, or archive images
- local printer output or machine-specific configuration
- home-network details, hostnames, IP addresses, or launch-agent files

The live poller is installed separately on the always-on Mac. Changes to
`scripts/receipt-drop-poller.py` require a deliberate, separately verified
worker deployment. GitHub and Vercel deployments do not update the printer
worker automatically.

## Local Development

The normal local preview uses a credential-free stub. It never writes to Redis
or prints.

```bash
npm install
npm run check
npm run dev
```

For real deployment testing, use a private `.env.local` file that is ignored
by Git. Never commit environment files, Vercel metadata, private messages,
archives, or local machine configuration.

## Deployment

The `main` branch deploys to Vercel and serves
[receipts.cafe](https://receipts.cafe). Review changes locally, run
`npm run check`, then push them to GitHub.

The Vercel project owns production environment variables. `vercel.json`
provides baseline browser protections including a restrictive content security
policy, anti-framing protection, no-sniff, referrer, permissions, and HTTPS
transport headers.

## Contributing

Small fixes and documentation improvements are welcome. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before opening
a pull request or reporting a problem.

## License

Copyright (c) 2026 David Sutrin. All rights reserved. See
[LICENSE](LICENSE).
