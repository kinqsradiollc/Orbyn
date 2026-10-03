# Docs code and metadata controls

Scoped follow-up on Mermaid PR173 (`2de8f72d`). Both clients now expose exact
code copying and a source/highlighting toggle for supported languages. Unknown
languages remain selectable literal text. Preserved YAML frontmatter is labeled
Page metadata and has a source disclosure, initially closed. No YAML evaluation,
new source draft or save path is introduced. The internal metadata language
remains a serialization detail.

Web code uses contained horizontal/vertical overflow and keyboard focus. Native
code scrolls horizontally; toolbar rows wrap, text follows system scaling and
controls have enlarged hit targets. The native font token uses Menlo on iOS and
monospace elsewhere, also used for Mermaid source. A missing mobile-web clipboard
now reports failure instead of a false Copied result.

## Executed qualification

- 17/17 initial focused checks, then64/64 parser, controls, richer-page,
  headings, references and style regressions passed, no failures/skips/cancels.
- Controls tests execute the actual desktop/mobile CodeView functions; they
  verify metadata disclosure, literal script-looking text, unknown languages,
  known-language toggle, exact copying and missing/denied clipboard recovery.
  The clipboard test executes the actual mobile-web utility.
- All workspace typechecks, production build and full formatting passed after
  the native font correction and final enlarged targets; final checkpoint typechecks
  and full formatting also passed.
- CUA inspected actual CodeView in an isolated iOS Expo fixture. Metadata source
  disclosure, known-language source/highlighting and native Code copied feedback
  were observed. Screenshots: `code-metadata/`. Existing generic monospace did
  not render monospace on iOS; Menlo correction is visible in python-highlight
  and python-source. Unknown-language `<script>` stays literal.
- Native fixture dependency duplication caused a readonly-property startup
  error. A single dependency tree and clean reload fixed the temporary preview.
  Expo fast-refresh also required a clean reload. Logs retained at
  `/tmp/orbyn-native-code-qa-metro{,-2}.log`. No product dependency contents were
  modified to resolve this fixture issue.

## Remaining acceptance

Full frozen-head local suite/CI, signed-in editor controls, Android, light
palette and web visual interaction remain required. Native horizontal scroll
interaction was attempted but Computer Use returned noWindowsAvailable; its
structure and containment were observed, not the complete scroll interaction.
The synthetic fixture does not establish whole-editor/source-typing acceptance.
Source inspector editing, complete CommonMark/GFM parity and all C1–C6/M1/D1/U1
remain open. Main remains1100ca98; no deployment/release/cleanup.

The user-requested web preview runs on5174 against a dedicated marked test DB
and a test-only admin login; credentials are private and excluded from Git.
