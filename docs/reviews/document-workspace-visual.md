# ADR005 document workspace visual review

## Provenance and boundary

Initial product: `f39aad8ee2d6a6eea555c8017c92bb5c77c55cab`.
Checkout `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch
`codex/docs-writing-redesign`. This is ADR005's new batch; ADR004 acceptance is
historical and does not qualify the workspace. Web `http://localhost:5174/app`,
Expo web `http://127.0.0.1:8083/`, existing UI Preview disposable fixture. No
credentials printed, no production/provider/native/security operations.

Initial phase: findings handed back for one correction batch. Parent explicitly
capped execution after representative Expo observations because desktop source
layout was unusable. Unrun acceptance cases below remain untested, not passed.

## Runtime setup interruption

The first single document open hit backend429. API health also429. No browser
retry loop: waited, checked health once200, used actual Try again and opened the
fixture. Parent restarted private QA API with local-only general limiter disabled;
no product/env template change. The stale banner was dismissed. Expo initially
showed the prior bundle's PDF renderer; explicitly reloaded the same assigned8083
URL to load this candidate before making any new mobile observation.

## Prioritized actual findings

| ID | Priority | Finding and reproduction | Evidence |
| --- | --- | --- | --- |
| W-V1 | P1 | Web1440×900 LaTeX initially shows blank left pane except LaTeX source label. Controls at y900 and textarea y1022/h654 are below viewport. Source becomes visible only by focusing its offscreen field; ordinary pointer pane scrolling moves outer page instead. A supposed writing workspace must show its editor immediately. | `/private/tmp/orbyn-adr005-source-below-viewport.jpg` |
| W-V2 | P2 | Web Note selection leaks a Markdown source pane label beside prose, plus hidden/offscreen source controls in AX. Note should not expose optional source chrome. Parent source audit confirmed missing pane hide. | Actual Note screenshot in tool receipt; source pane AX exists while Note selected. |
| W-V3 | P2 | Outer web page scrolls app topbar out of view; persistent doc toolbar shifts to y0 and footer becomes visible while source/root heights overflow. The design is not yet fully viewport-owned with independent pane scrolling. | Source focus/scroll receipt and realistic content screenshot. |
| W-V4 | P2 | Expo390 Source uses only around200px source field under roughly350px of header/tool controls; Page comments/composer/History always occupy bottom roughly266px. Preview also leaves those secondary sections visible. Writing space is not prioritized; comments should be a contextual surface rather than a permanent bottom section of this source task. | `/private/tmp/orbyn-adr005-expo-source-390.jpg`, `/private/tmp/orbyn-adr005-expo-preview-390.jpg` |
| W-V5 | P2 | Expo Source shows two Ask assistant actions: one beside Source/Preview, another inside source controls. Hide source, source choices, Web preview and Export PDF wrap into multiple equal-weight rows. Consolidate secondary actions in the persistent toolbar and shorten chrome before reducing text. | Same source390 screenshot. |

Parent separately identified source-only issues for batched correction: stale
undo rendering, Docker asset wiring, invalid secondary source inheriting another
source's last-good output, and legacy narrow `.doc-layout` hide conflict. These
were not repeatedly reproduced by this worker or promoted to actual UI findings.

## Valid observed behavior and design assessment

- Library Hide action removes the second sidebar and materially frees task width.
  Reopen/narrow dismissal are not yet tested.
- Despite W-V1, focusing the real offscreen textarea brought it into view. Entered
  a realistic synthetic full article with section/subsection, paragraph, two-item
  list and inline fraction/exponent math. HTML output was immediately readable,
  properly spaced and did not resemble a tiny full-page PDF. This is a meaningful
  improvement to the preview architecture, but does not qualify the broken editor
  placement. Proof `/private/tmp/orbyn-adr005-realistic-html-light-wide.jpg`.
- Changed one sentence from one to two examples; output updated in the same
  iframe host (`srcdoc` unchanged). No loading/PDF flash was observed during this
  representative edit. Broader continuous typing/last-good/error repair remains
  untested, not inferred from formal tests.
- Restored the exact primary source captured before the test; actual Saved was
  observed afterward. Existing block IDs, title, ordinary prose, secondary source
  and other content were untouched. No unsent owned test draft remains.
- Expo390 Source and Preview buttons switch the current LaTeX mode, source and
  correct HTML sentence visible. No source mutation was made on mobile. It is
  usable at this representative width, but W-V4/W-V5 make task space too cramped.

## Unperformed cases retained for corrected final candidate

Ordinary Note title/long typing/toolbar persistence; Markdown source/result;
complete primary/secondary LaTeX selection; pointer/keyboard divider; long source
and result independent scroll; wide dark/short height/narrow app split; library
reopen/phone close; Expo320 and wide source split; draft/format retention through
phone Source/Preview; incomplete/unsupported source last-good/error repair;
explicit PDF export and failure return; comments/assistant approval entry without
provider execution. Parent asked not to exhaust unreachable paths before fixing
the known blockers. These remain required within the assigned finite scope.

Device metrics/viewports reset, tabs online and preserved. Fixture ownership
returned to parent before source corrections. Report edits only; no source edits.
