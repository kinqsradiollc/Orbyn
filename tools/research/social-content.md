# Social skill design — 22 October 2026

## Sources and decision

Reviewed the current primary skill sources:

- Corey Haines's [social skill](https://github.com/coreyhaines31/marketingskills/blob/main/skills/social/SKILL.md)
  (frontmatter version 2.4.0 at review time) covers platform-specific writing,
  source repurposing, voice, carousel narratives, scheduling and engagement.
  Older directory listings use the name `social-content`; the reviewed entrypoint
  is `social`. This is third-party workflow guidance, not LinkedIn documentation
  or measured evidence that its frequency/algorithm advice improves outcomes.
- Anthropic's [canvas-design skill](https://github.com/anthropics/skills/blob/main/skills/canvas-design/SKILL.md)
  focuses on original static visual composition and PNG/PDF output. Its art
  philosophy process is not necessary for every product screenshot or feed mockup.

The historical [social-content](https://github.com/kinqsradio/orbyn-fullstack-skills/blob/251cd2e9013d2cbb74a6b3c4b88243c7a4094813/skills/social-content/SKILL.md) and
[social-preview](https://github.com/kinqsradio/orbyn-fullstack-skills/blob/251cd2e9013d2cbb74a6b3c4b88243c7a4094813/skills/social-preview/SKILL.md) are independently authored
instructions, informed by that comparison and the user's requested writing/preview
workflow. No upstream text, code, fonts or assets were copied or installed. These
links identify reviewed sources, not immutable imported snapshots. Consequently
the source snapshot manifest and imported-skill adaptation map remain unchanged.
Any future direct import must preserve its license and pinned provenance under
[tooling policy](../../docs/operations.md).

## Local ownership

Writing owns the message, factual support and author voice; previews own visual
composition, rendering and exports. `unslop` supplies prose refinement. In-app
copy stays with `orbyn-content-design`, product layout with `orbyn-ui-design`.
Available PDF/presentation/image tools are conditional output paths, not new
mandatory dependencies. The Python helper only generates local HTML and text.

The neutral template palette, aspect ratios, five-line caption clamp and feed
widths are local design defaults. They do not establish platform specifications,
exact truncation, accessibility certification or upload acceptance. Live platform
requirements must be checked when a deliverable depends on them. Posting and
scheduling remain separately instructed effects, with no automatic connector,
global skill installation, account access or publication.
