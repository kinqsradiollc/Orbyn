# Source-page reference context for embeds — 3 October 2026

Dependent candidate on Markdown parity89c3e2f9. Does not promote the broad source draft.

The section API projects the complete authorized source page through link privacy before selecting its section. It returns source-page reference definitions and filters inaccessible object destinations. Web and native embedded bodies each supply their own reference and footnote context, replacing the containing page's context. Older API responses use local section definitions.

Focused API/privacy/richer-page tests passed41/41, zero skips/cancellations. The first new test caught inaccessible destinations still present in the context map; filtering now uses the same link-privacy authorization result, retaining the original assertion. All workspace types/build/format passed; current backend typecheck also passed after the final destination filter.

The focused checks cover a private definition outside the selected heading, owner access, authorized object and external links, no hidden titles/destinations, source section boundaries and anonymous/foreign/invalid requests. Existing richer-page shield checks remain intact. Native/editor visual and interaction acceptance, full local/CI and dependency qualification remain required.
