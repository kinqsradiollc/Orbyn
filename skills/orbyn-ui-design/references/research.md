# UI and human–AI interaction research

Reviewed 8 October 2026. Primary sources below informed the skill before it was
written. The rules translate this guidance into Orbyn's existing architecture;
they do not import another product's visual identity or certify accessibility.

## Accessibility baselines

| Source | What it establishes | Orbyn application |
| --- | --- | --- |
| [W3C Reflow, SC1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Ordinary content reflows at 320 CSS px; meaningful two-dimensional regions have exceptions. 1280 at 400% zoom corresponds to 320 CSS px. | Collapse secondary panes; keep special scrolling inside tables/code/diagrams instead of overflowing surrounding prose. |
| [W3C Resize Text, SC1.4.4](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) | Text can enlarge to 200% without losing content/function. | Compact defaults do not justify disabling zoom or font scaling. |
| [W3C Text Spacing, SC1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) | User spacing changes must not remove content/function. | Avoid fixed-height text containers and clipping as a density fix. |
| [W3C Contrast, SC1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Normal text generally needs 4.5:1, large text 3:1, with defined exceptions. | Validate muted labels in both existing palettes; visual subtlety cannot replace readability. |
| [W3C Focus Not Obscured, SC2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | Author-created content must not completely hide a keyboard-focused component. | Keep focused controls visible under sticky chrome and overlays; Orbyn aims for the whole active control to be visible. |
| [W3C Target Size, SC2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | AA targets are at least 24×24 CSS px or meet stated exceptions, including spacing. | This is not a universal 44px WCAG rule. Preserve Orbyn's larger 44pt native touch target while keeping its visual controls compact. |
| [WAI-ARIA modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | A modal has a label, contained keyboard focus, Escape dismissal and appropriate focus restoration. | Settings and nested pickers need real keyboard checks; role/aria-modal alone is insufficient. |
| [Apple: Get started with Dynamic Type](https://developer.apple.com/videos/play/wwdc2024/10074/) | Scaled text requires layouts that adapt, including stacked content at larger sizes. | Retain React Native scaling and reflow controls instead of imposing a blanket font cap. |

The WCAG Understanding pages explain the criteria; the modal pattern is design
guidance. Our sampled preview matrix is not a full conformance assessment.

## Human–AI experience

- [Microsoft Research, Guidelines for Human-AI Interaction (CHI2019)](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)
  and its [primary paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)
  cover capability/quality expectations, relevant contextual information,
  requesting help, dismissal, correction, explanations, and user control.
  Orbyn applies these to suggestions, approval cards, run states, and recovery.
  These are interaction guidelines, not a prescribed font scale or AI dashboard.
- [Google PAIR: Mental Models](https://pair.withgoogle.com/chapter/mental-models/)
  helps users understand capabilities and boundaries. Orbyn distinguishes chat,
  Background, Overnight, provider connections, embeddings, and MCP.
- [Google PAIR: Explainability + Trust](https://pair.withgoogle.com/chapter/explainability-trust/)
  discusses proportionate explanations, known data sources, and calibrated trust.
  Orbyn shows useful context and limitations without invented confidence or
  long technical explanations on every card.
- [Google PAIR: Feedback + Control](https://pair.withgoogle.com/chapter/feedback-controls/)
  supports editing, opting out, and a manual path alongside automation.
  Orbyn keeps suggestion review/dismissal and manual task/doc editing reachable.

## UX: task flow, concise content, and recovery

Additional primary guidance reviewed 8 October 2026 before extending the skill:

| Source | Guidance applied to Orbyn |
| --- | --- |
| [Nielsen Norman Group: usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | Observable state, familiar terms, recognizable actions, efficient paths, cancellation, and relevant content. These are heuristics, not proof of usability or a mandatory aesthetic. |
| [GOV.UK: text input hints](https://design-system.service.gov.uk/components/text-input/#hint-text) | Brief, relevant field help; long explanations make repeated field interaction harder. Orbyn defaults to one short helper sentence when needed. |
| [GOV.UK: details](https://design-system.service.gov.uk/components/details/) | Disclose optional help; keep information needed by most users visible. Orbyn keeps consent and important consequences beside their action. |
| [GOV.UK: error messages](https://design-system.service.gov.uk/components/error-message/) | Distinguish correctable field validation from service/permission failures. Orbyn offers an appropriate retry or next action while retaining input. |
| [Google PAIR: errors and graceful failure](https://pair.withgoogle.com/chapter/errors-failing/) | Failures include wrong assumptions about context; give people a way forward. Orbyn preserves manual editing and review when AI is unavailable or wrong. |
| [GOV.UK: moderated usability testing](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing) | Use believable task goals without revealing the solution. Orbyn distinguishes an agent walkthrough from research with actual or likely users. |

The user's 320×740 Settings examples establish a local density/copy requirement:
containment alone is insufficient, large repeated headers waste task space, and
routine cards should not carry explanatory essays. Review CSS dimensions and
interaction outcomes; screenshot image pixels may differ from the CSS viewport.
The compact targets are Orbyn decisions, not dimensions mandated by these sources.

## Local decisions and source anchors

These are Orbyn choices, not externally mandated sizes or universal AI rules:

- Shared `TYPE_SCALE`/`typeScale` in `packages/core/src/presentation.ts`:
  11/13/15/18/24/36. Use roles rather than enlarging every section title.
- Web `desktop/src/styles/global.css`: 15px base body, existing field tokens,
  18px narrow/coarse field text; preserve tokens without inflating surrounding copy.
- Native `mobile/src/theme/index.ts`: shared type roles, light font weights,
  44pt tap target, compact control exception, radius/spacing tokens.
- `AGENT.md`: palette preservation, shared controls, more menus, web/mobile parity.
- `docs/reviews/adr-execution-order.md`: finish the current feature checkpoint;
  scope browser/native acceptance separately and use Orbyn Visual Check.
- User decisions: short copy, Settings modal, no overlapping sidebars, character
  configuration for Background/Overnight, distinct runtimes and truthful idle state.

Generic aesthetic skill recipes were not adopted as authority. A fixed theme,
oversized hero, or mandatory animation would conflict with Orbyn's own surfaces.
Refresh the relevant primary source when changing a standards-dependent rule;
reinspect local tokens when implementation has changed. Do not fetch research or
configure external tools for every small UI edit when this reference suffices.
