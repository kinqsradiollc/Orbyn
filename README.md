# orbyn.dev

The home of the Orbyn product line: Orbyn Planner, Notes, Studio and Engineering.
Nothing is out yet. Every app is still being built, and the site says so.

This repository used to hold the original Orbyn planner app. That app has been
removed here; its code stays in the Git history.

## What is here

| Path | What it is |
| --- | --- |
| `site/src/` | The stylesheet and the one small script every page loads |
| `site/fonts/` | Geist and JetBrains Mono, self-hosted (SIL Open Font License) |
| `site/public/` | Files copied as they are: favicon and Cloudflare `_headers` |
| `site/previews/` | Product previews from the internal designs, made CSP-safe by `scripts/import-previews.mjs` |
| `scripts/build-site.mjs` | Builds every page into `dist/` and checks links and wording |
| `scripts/serve-site.mjs` | Serves `dist/` locally the way production does |
| `scripts/deploy.sh` | Deploys on one Docker host and removes the old app's data |
| `compose.yaml`, `deploy/` | The nginx image and the Cloudflare tunnel |
| `wrangler.jsonc` | The same site on Cloudflare Workers static assets |

The pages follow the internal designs; their copy lives in `scripts/build-site.mjs`.
The product previews are early designs shown in iframes. To update them, download
the design's `previews/` folder and run `node scripts/import-previews.mjs <folder>`:
it moves styles and scripts into files and points fonts at `/fonts`, so the
previews run under the same Content-Security-Policy as the pages.
No dependencies: Node 22 builds it.

## Work on it

```sh
node scripts/build-site.mjs        # build into dist/
node scripts/serve-site.mjs 4321   # open http://localhost:4321
node scripts/build-site.mjs --check
```

## Deploy

On the Docker host, with `.env` copied from `.env.example` and filled in:

```sh
./scripts/deploy.sh --check   # lists what it will remove and start; changes nothing
./scripts/deploy.sh
```

On Windows, run it through Git Bash: `"C:\Program Files\Git\bin\bash.exe" ./scripts/deploy.sh`.

The first run also removes everything the old Orbyn app left in this Compose
project: its containers, volumes (database, uploads, page files, OCR model, mail
queue) and images. Before it deletes anything it saves one final dump of the old
database to `backups/`. If that dump fails, nothing is removed. `--keep-old`
deploys the site and leaves the old data alone.

The Cloudflare tunnel's public hostname for orbyn.dev should point at
`http://web:8080`; `http://gateway:8081`, the old app's route, keeps working too.

To use Cloudflare Workers instead: `npx wrangler deploy`.

## Licence

See [LICENSE](LICENSE). Fonts keep their own licences in `site/fonts/`.
