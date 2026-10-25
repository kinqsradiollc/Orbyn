# Contribution methods: source and ownership record

Reviewed 25 October 2026. The contribution intake, reproduction, PR iteration
and synthetic examples are independently written Orbyn guidance. No upstream
workflow body, script, provider setup or model configuration is imported.
The required method is local; URLs below are credit and update pointers.

Existing `orbyn-workflow`, `how` and `tdd` retain their pstack adaptation lineage,
Lauren Tan's MIT copyright and Orbyn's local adaptation license. Their portable
`LICENSE` files are unchanged. New wording does not remove historical attribution.

| Reviewed source and exact revision | Useful idea | Local decision |
| --- | --- | --- |
| [obra/superpowers](https://github.com/obra/superpowers/tree/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills), Jesse Vincent, MIT | Verify feedback and establish the actual failure before changing code | Keep evidence-led source/reproduction work; do not require a universal testing ritual, fixed agent panel or stop all work for one unclear comment |
| [getsentry/skills iterate-pr](https://github.com/getsentry/skills/blob/d12f250460ffd961f549dbebf7eeb0cf4afd4c2e/skills/iterate-pr/SKILL.md), Sentry, Apache-2.0 | Separate actionable CI failures, pending checks and human gates | Use exact-head gates and explicit budgets; no fixed bot ignore list, automatic replies or mandatory new runtime/helper |
| [github/awesome-copilot](https://github.com/github/awesome-copilot/tree/d85f762d6e521abf5fe16703946e9b38adc42da7/skills), GitHub contributors, MIT | Reproduction briefs and complete PR-feedback context | Own one local reproduction method and bounded PR loop; preserve reproduction-only scope and avoid per-comment approval choreography |

The reviewed `bug-reproduction-brief` in awesome-copilot credits
[skyestrela/ai-agent-skill-preview](https://github.com/skyestrela/ai-agent-skill-preview)
as its source. That transitive credit is retained as review context, not a claim
that we inspected or imported that separate repository at an exact revision.

Repository-level provenance records these reviewed revisions separately from
the original import. Review does not imply endorsement or transfer authorship.
Raw downloads, private contribution evidence and local research remain outside
Git. No REA runtime/source pin or consuming application's skills pin changes in
this public-library milestone.
