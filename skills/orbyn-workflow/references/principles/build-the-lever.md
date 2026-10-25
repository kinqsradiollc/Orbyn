# Build the lever

Inspect one representative unit, then use an existing tool or a small deterministic helper when it improves repeatability or evidence. Make mutation scripts scoped and safe to rerun. Do not create a framework for a few obvious edits. A tool is useful only if its outputs can be checked against the real contract.

## Decision in practice

Will the helper make the next edit safer?

For a contract rename across API, web and mobile, first inspect a real caller. Give the codemod an explicit path set and a dry-run diff; refuse ambiguous matches. A second execution should produce no further changes. Keep the small direct edit when a tool adds more review work than it removes.

## Apply and hand off

State the repeatable transformation, its explicit input paths and a refusal case before automating. Inspect a representative output and make a second run converge.

Concrete check: A rename helper must refuse ambiguous text rather than rewrite every matching substring. Compare the dry-run allowlist with the actual diff.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [figure-it-out](../../../figure-it-out/SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [build the lever](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-build-the-lever/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).
