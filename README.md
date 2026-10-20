<h1 align="center">receipts.cafe</h1>

<p align="center">
  <strong>Anonymous messages, physically printed as thermal receipts.</strong><br>
  A small public art project connecting a browser to a thermal printer.
</p>

<p align="center">
  <a href="https://receipts.cafe">Visit receipts.cafe</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#local-development">Local development</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

A visitor submits a short anonymous message online. An always-on local print
worker turns it into a receipt and prints it on an Epson TM-T88V thermal printer.

## At a glance

| Component | Details |
| --- | --- |
| Public interface | Text-only anonymous message submission |
| Delivery path | Vercel → Upstash Redis → local print worker → CUPS |
| Printer | Epson TM-T88V thermal printer |
| Archive | Private while the visual archive is being prepared |

> [!NOTE]
> The public website never connects directly to the home network or printer.
> Printing runs through an isolated worker on an always-on Mac.

## How it works

```text
Browser → Vercel API → Redis queue → Local worker → CUPS → Printed receipt
```

1. A visitor submits a short message through the website.
2. The Vercel API validates it and places it in the Redis queue.
3. The private poller claims the message and renders the shared receipt template
   locally.
4. CUPS prints the receipt. The job is acknowledged only after printing
   succeeds.
5. If the printer is unavailable, the message stays queued. Stale in-flight
   claims recover automatically.

## Public safeguards

| Limit | Allowance |
| --- | --- |
| Message length | 300 characters |
| Per IP, per hour | 3 messages |
| Per IP, per day | 10 messages |
| Across the site, per day | 100 messages |

Additional protections include duplicate suppression, link rejection, a honeypot
field, and same-origin JSON submission handling. A private bearer token protects
poller routes.

> [!IMPORTANT]
> These limits do not guarantee immediate printing. Do not submit passwords,
> private information, or anything that must remain confidential.

## Local development

The default preview uses a **credential-free stub**. It never writes to Redis or
prints.

```bash
npm install
npm run check
npm run dev
```

For real deployment testing, use a private `.env.local` file that is ignored
by Git. Never commit environment files, Vercel metadata, private messages,
archives, or local machine configuration.

## Operations and privacy

<details>
<summary><strong>What belongs in this repository</strong></summary>

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

</details>

<details>
<summary><strong>Website and worker deployment</strong></summary>

The `main` branch deploys to Vercel and serves
[receipts.cafe](https://receipts.cafe). Review changes locally, run
`npm run check`, then push them to GitHub.

The Vercel project owns production environment variables. `vercel.json`
provides baseline browser protections including a restrictive content security
policy, anti-framing protection, no-sniff, referrer, permissions, and HTTPS
transport headers.

A development Mac is used for source changes and deployments, but is not
required for normal printing. The always-on Mac runs the isolated print worker.

</details>

## Contributing

Small fixes and documentation improvements are welcome. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before opening
a pull request or reporting a problem.

## License

Copyright (c) 2026 David Sutrin. All rights reserved. See
[LICENSE](LICENSE).

---

Created by [David Sutrin](https://www.davidsutrin.xyz).
