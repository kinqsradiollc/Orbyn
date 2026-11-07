# orbyn.dev agent instructions

This repository is the orbyn.dev site. Read [README.md](README.md) and
[CONTRIBUTING.md](CONTRIBUTING.md) before editing.

- Build and check: `node scripts/build-site.mjs --check`. The check fails on a
  broken link, inline style or script (the CSP blocks them), a GitHub link
  outside `orbyn-dev`, or wording that suggests something is out or for sale.
- Copy, tokens, spacing and motion come from the internal designs. Do not
  invent copy, states, dates, sign-ups or download and buy buttons.
- No product is out yet. Keep every app at Building and Teams at Planned until
  the owner says otherwise.
- Never commit `.env` or `.env.production`, and never print their values.
- `scripts/deploy.sh` deletes the old app's data. Run `--check` first, and only
  run it on a host you were asked to deploy to.
- Public files never link private plan or design documents; say "internal designs".
