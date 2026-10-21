# Planning and UI research — 21 October 2026

## Planning decision

The preserved engineering source's planning reference is
`tools/pstack/skills/poteto-mode/references/plan.md` at the revision recorded in
`tools/upstream-manifest.json`. It explicitly makes planning a separate deliverable,
uses fixed phase/file limits, loads all principle leaves and prescribes particular
host agents/tools. Those are workflow choices in that source, not evidence of a
fundamental model planning limitation. Its architecture skill also uses model
panels and an opt-in human checkpoint.

Orbyn keeps evidence-led exploration, explicit contracts and a reviewable plan.
Its planner instead sizes phases by dependency/recovery risk, honors explicit
small planning requests, researches material unknowns and respects plan-only versus
plan-and-implement scope. It has no blanket phase-count or file-count limit and
loads only relevant principles. It does not impose new test or approval authority.

Google's official [planning documentation](https://www.antigravity.google/docs/plan/)
describes analysis, targeted clarification and a structured implementation artifact.
The [implementation-plan guide](https://www.antigravity.google/docs/implementation-plan/)
describes feedback and configurable review behavior. Orbyn adopts a reviewable,
maintained plan while using the user's existing execution authorization. These
pages describe another host; they do not establish Codex or Claude feature support.

## UI decision

The user supplied eight skill entrypoints under the local `openSrc/antigravity`
folder. The folder has no package license or Git metadata establishing a version
or provenance. It was inspected, not installed or republished as an official Google
package. Original local files remain unchanged; no active workflow depends on them.

Its generative UI guidance targets embedded chat widgets and assumes host-specific
write/embed tools, injected CSS tokens and a particular CDN. That is not Orbyn's
product runtime. The useful concepts are semantic theming, readable hierarchy,
container-aware sizing and choosing inline versus full artifacts. Orbyn's new
prototype reference states these in its own terms using existing React/React Native
components, first-party assets and supported host visualization tools. It does
not import the foreign CDN, embedding tags, font limits or tool API assumptions.

Google's official [skill documentation](https://www.antigravity.google/docs/skills?tab=ide)
supports focused skills and progressive loading of descriptions, bodies and
resources. Orbyn uses that separation with its own creator, catalog and host links.
A source example's visual quality is not measured evidence of Orbyn UI quality;
changed product flows still need their scoped visual evidence when authorized.

## Outcome

New Orbyn skills: planner, researcher and skill creator. Existing UI and workflow
skills now route to them and to a shared stack/ownership guide. The source skills
are references for this decision, not active instructions or permission grants.
No UI runtime, provider, model session or external integration was started by this
research. Static link/configuration checks are reported separately from behavioral
validation.
