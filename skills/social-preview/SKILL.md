---
name: social-preview
description: "Create and inspect local social post previews, announcement graphics and carousels for LinkedIn and other platforms. Use for feed mockups and exportable social visuals, not product UI changes or publishing."
---

# Social visuals and previews

Create reviewable visuals from a post or brief. Support personal work as well as
Orbyn announcements. Keep the editable source alongside requested exports.
Use the [local pinned design reference](references/source-record.md) for optional
background offline. Prefer installed fonts/tools and supplied captures; report
missing export tools or current platform verification without inventing results.

## Choose the artifact

Distinguish a feed approximation, an attached visual, a product demonstration and
a website link-preview card. If unspecified, use the supplied material to choose
a useful local preview and state the choice. Drafting or materially rewriting the
post belongs to [social-content](../social-content/SKILL.md); polishing prose
belongs to [unslop](../unslop/SKILL.md).

Use approved copy, supplied screenshots and brand assets. For Orbyn visuals, read
the relevant [stack/token owners](../../docs/agents/stack.md) and reference assets;
do not invent a logo or treat the helper's default colors as official branding.
Label conceptual UI and synthetic data as mockups. Keep actual product screenshots
faithful; annotations must not imply behavior the captured product lacks.

## Produce and render

Choose hierarchy, spacing and a visual explanation before adding decoration.
Make each card legible at feed size. Show the product, diagram or concrete result
when it explains more than a text card. For original illustration or image edits,
use the available image-generation tool; typeset final exact copy separately.
Never assume Codex-only tool names exist in Claude or install a provider implicitly.

For a quick text/card/carousel layout, use the dependency-free
[renderer and brief guide](references/production.md). It creates editable HTML
with approximate wide/narrow feed views, full post text and ordered cards. Its
[example brief](assets/example.json) is a reusable input example, not a brand or
personal voice profile. Extend or replace the layout for the actual brief rather
than forcing every graphic into its starter template.

For product screenshot compositions, use available browser/layout tools and
supplied captures. For requested video demos, define the actual demonstrated flow,
use an available capture/export tool, and inspect playback. A storyboard is not
a video. For a LinkedIn document carousel, export a PDF when requested using an
available PDF/presentation tool or browser print path. Read the relevant host skill
when available. The bundled helper itself exports HTML and text only.

Open the rendered result with an available browser or artifact viewer. Inspect
the wide and narrow feed, every card, long words, line breaks, image crops and
contrast. Check that sources and limitations survived the visual edit. Revise
overflow and cramped copy rather than shrinking everything. Use useful alt text;
keep decorative context out of it. Inspect exported PNG/PDF files separately at
their actual dimensions, including every PDF page and its order.

## Deliver honestly

Return the editable source, requested exports, copyable caption and alt text.
Say which outputs were actually rendered and inspected. If the host lacks a
renderer or exporter, deliver the source with the missing step explicitly marked;
do not claim source inspection proves visual quality or upload readiness.

Feed chrome, line clamps, fonts and viewports are local approximations. Exact
LinkedIn truncation, upload behavior and engagement are unverified until checked
in the relevant platform. Layout dimensions are design choices; confirm current
platform requirements when necessary. Website Open Graph changes belong to the
owning website task, and product flow/layout changes to
[orbyn-ui-design](../orbyn-ui-design/SKILL.md). Do not create a site, publish,
schedule or modify account settings as a side effect of preview generation.
