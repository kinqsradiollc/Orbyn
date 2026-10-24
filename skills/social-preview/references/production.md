# Local preview production

The Python helper uses only the standard library. From the repository root:

```sh
python3 skills/social-preview/scripts/render_preview.py \
  --brief skills/social-preview/assets/example.json \
  --output /tmp/social-preview-example
```

Choose a fresh output directory; the helper refuses to overwrite an existing
path. It writes `preview.html` and `post.txt`. It does not start a server, access
an account, fetch assets, export raster/PDF files or install dependencies. Open
the HTML directly when the host supports it, or serve only its output directory
with an available local server. Keep any process owned and stop it after use.

## Brief

JSON fields (unknown fields are rejected to catch misspelled instructions):

| Field | Meaning |
| --- | --- |
| `platform` | Display label; defaults to LinkedIn. Other platforms use the same generic feed approximation. |
| `author` | Display name, supplied by the user; defaults to “Author”. |
| `subtitle` | Optional descriptive line. |
| `post` | Required nonempty caption, preserved in `post.txt`. Plain text, not HTML. |
| `background`, `foreground`, `accent` | Optional six-digit hex colors. Defaults are neutral starter colors, not Orbyn tokens. |
| `aspect` | `square` (default), `portrait` (4:5), or `landscape` (1.91:1). These are local design ratios, not verified upload specifications. |
| `slides` | Optional ordered list; omit or use an empty list for a text-only post. |

Each slide supports `eyebrow`, required `title`, `body`, `footer`, and optional
`image` plus required `alt` when an image is present. Text fields are plain strings.
`image` is a local PNG/JPEG/WebP/GIF path relative to the brief file (or absolute).
Images are embedded as data URLs so the result is portable and makes no network
requests. The helper checks image signatures and limits each to 10 MiB; this is
a helper limit, not a platform limit. Supply static captures when animation is
not relevant. Redact private data before including screenshots in a shareable brief.

The template shows the same caption/cards at 600px and 360px feed widths. Each
feed has an expandable text area with a five-line local clamp and a horizontally
scrollable carousel. Those values are preview settings, not platform rules.
The separate export section contains each card once at up to 1080px wide.

## Export and review

Use an available browser tool to capture each `.export-card` at the chosen
dimensions for PNG output; inspect the capture. Keep feed chrome out of the
export. If using browser print for a PDF, print backgrounds and turn off browser
headers/footers. The print stylesheet emits only the export cards with one card
per page. Page size follows the selected ratio at 108mm wide. Text-only briefs
print the caption instead. Inspect the resulting PDF for unexpected blank pages,
clipping and order before delivery. Do not call a helper run a completed PDF export.

Check all cards at both feed widths and in the export view. Long content is
intentionally visible rather than silently truncated in export cards; reduce or
redesign overflowing copy. System fonts vary by host, so source layout checks
cannot guarantee identical raster output on another machine.

For a richer composition, use supplied product screenshots, a real diagram or a
purpose-built layout with the same copy/evidence contract. This renderer is a
starting tool, not a substitute for design or rendered review.
