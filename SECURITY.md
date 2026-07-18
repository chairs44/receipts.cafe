# Security Policy

## Scope

This repository contains the public-facing source for `receipt.cafe`, a small
thermal-printer art project. Production secrets, Redis credentials, private
poller configuration, visitor message archives, and home-network details are
kept outside the repository.

## Reporting A Problem

Please do not open a public issue containing credentials, private messages,
personal data, or an exploitable production detail. Report security concerns
privately through the repository owner's GitHub contact options. Include the
affected file or endpoint, the impact, and reproducible steps when safe to do
so.

## Secret Handling

- Never commit `.env` files, Vercel metadata, poller environment files, or
  archive directories.
- Never paste Redis tokens or the poll token into issues, pull requests, or
  screenshots.
- If a credential is exposed, rotate it immediately in Vercel, Upstash, or the
  Mac poller configuration before investigating further.
- Keep the poll token limited to the poller and protected worker routes.
- Do not expose the home network or printer directly to the public internet.

## Public Message Privacy

Messages submitted through the site are intended to be anonymous to ordinary
visitors, but they are processed by the service and retained in private
operational/archive systems. Do not submit passwords, financial information,
private personal details, or anything that must remain confidential.

## Supported Versions

Only the current `main` branch and the live Vercel deployment are maintained.
