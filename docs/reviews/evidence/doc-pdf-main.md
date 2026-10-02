# Main-based document PDF checkpoint

## Scope and behavior

- Private PDF process with its own HMAC key, signature-window replay protection, bounded concurrency/input/output/deadline and disconnect cancellation.
- Authorized primary-read snapshot; access/revision checked again before file delivery. Unavailable rendering returns503 without a partial or downgraded file; changed/inaccessible sources409/404.
- Enabled Chromium sandbox; private pipe and new profile; network resources denied; nonroot image with no database/provider credentials, dropped capabilities, read-only root and bounded temporary/shared memory.
- Production script validates the key and starts PDF before API. Kubernetes additionally requires the documented node-local seccomp profile; Kubernetes runtime is unverified.
- Existing PDF endpoint works for web, desktop and mobile. This checkpoint does not introduce an editor UI or claim native file/share interaction completion.

## Current evidence before commit

-55 current browser/renderer/client/service/deployment/shared-helper/primary-read unit checks pass: `/tmp/orbyn-pdf-main-current-unit.log`.
-38 real authorized API export/rich-page tests pass: `/tmp/orbyn-pdf-main-api-current.log`. Covers all ten actual Mermaid families and math, forbidden callers, version changes/deletion during printing, richer-page captions/tables/callouts/footnotes.
-All workspace types, production builds and formatting pass: `/tmp/orbyn-pdf-main-{types,build,format}.log`.
-Root-locked esbuild0.28.2 and Mermaid11.17.2 regenerate the backend asset. Source-digest and CSP checks pass. No app module imports or app dependency additions.
-Actual offline Mac Chrome154 fixture: `/tmp/orbyn-pdf-main-renderer-qa/doc-export-renderer-qa.pdf`,339421bytes,11 tagged A4 pages, no PDF JavaScript. All11 rendered pages inspected individually at1000px longest edge. Code/table content fits; math/Greek/CJK and diagram labels are visible; no overlap/clipping in these fixtures. Page breaks intentionally isolate each family.

[All11 fixture pages](pdf-main-contact.png)

## Qualification and remaining gates

Full exact-head local and CI qualification, including the dedicated hardened Linux
image, are required before main promotion. Prior combined candidatea039f271 passed
2,488/2,488 locally; that is separate evidence and does not qualify this main-based
checkpoint. Earlier6f43fc92 and4e8d2452 full suites failed the old richer-page test;
the actual renderer fixture and PDF-text checks correct that configuration issue.

Native download/share interactions, rendered HTML/publication parity, embedded
image-byte parity, visual/editor acceptance and complete C1–C6/M1/D1/U1 requirements
remain open. The user owns web test-server visual review for the UI increment.
Native Terms acceptance is pending; no permission denial was bypassed. No deployment,
release or cleanup performed. Preserve primary checkout mobile/app.json and unrelated files.

## Qualification correction — 3 October 2026

- Main21c6c076 full local suite is terminal:2,245/2,246, one old clipboard expectation for `<h2>Plan</h2>` after authored level1 correctly becameh1. Updated that expectation and added exact all-six-level HTML/clipboard regressions; no h7. h4–h6 print at readable body size. [Heading fixture](pdf-heading-levels.png) inspected with no overlap or clipping.
- Combineda039f271 CI37057124805 failed one all-family PDF text assertion despite local2,488/2,488. Reproduced in a hardened offline Linux renderer: “flowchart” prints correctly but pdf.js returns adjacent `fl`/`owchart` font runs. The test inserted a false space. Position-based line reconstruction and normalization now recover all ten exact headings and all six required SVG labels from the Linux file. A regression covers split font runs and ligatures; expected headings are exact line checks.
  -Current57 browser/helper/service/primary/deployment units and63 actual export/rich-page/heading/text checks pass. All workspace types/build/full formatting pass after the fix. Linux diagnostic artifact is `/tmp/orbyn-pdf-linux-api-batch.pdf`; its older image isolates printing/font behavior and is not current-head image qualification.
  -New full exact-head local and CI qualification required after committing this correction. Previous main/combined CI failures are not passing evidence. PR161 stays draft until corrected full local/all CI pass; no main merge/deploy/release/cleanup.
