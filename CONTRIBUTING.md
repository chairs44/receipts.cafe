# Contributing

`receipt.cafe` is a small personal art project. Contributions are welcome when
they preserve the project's narrow scope, privacy boundaries, and reliable
print path.

## Before Opening A Pull Request

```bash
npm install
npm run check
npm run dev
```

Review the local preview and keep changes focused. Do not include private
messages, archive files, environment files, Vercel metadata, poller tokens,
machine-specific paths, or home-network details.

## Design And Runtime Boundaries

- Keep the public experience text-only unless the privacy and abuse model is
  updated first.
- Keep the always-on Mac as the normal runtime printer worker.
- Treat the checked-in poller as a source copy. A poller change requires a
  deliberate, separately verified deployment to the always-on Mac.
- Keep `npm run dev` as the credential-free local preview.
- Treat queue durability, rate limits, and private worker authentication as
  production behavior, not optional demo code.
- Do not add a direct public connection to the home network or printer.

Because this repository may be public, keep examples and documentation
sanitized. Use placeholders for hosts, paths, and credentials, and never add
Redis exports, visitor archives, launch-agent files, or screenshots containing
private operational details.

Small fixes and documentation improvements can be proposed directly with a pull
request. Larger behavior changes should explain their operational, privacy, and
deployment impact.
