# D1 heading and fence parity review

Status: local implementation; not merged. Governing acceptance remains
[ADR 001](../adr/001-devday-agent-platform.md) and its D1 matrix.

## Changes

Heading levels 1–6 now share one contract across request validation, Markdown
parsing, HTML paste, outlines, heading links, editor controls and web/mobile
rendering. HTML exports use the exact heading level and cannot emit h7. Word
exports include all six heading styles; PDF exports have defined font sizes
for each level.

The parser accepts ATX closing hashes and single-line Setext headings. Literal
trailing hashes in structured headings are encoded as portable numeric entities
when serialized, preserving content through a Markdown round trip. Tilde and
indented fenced code preserve their contents, including embedded shorter fences.

## Evidence

- Focused integration and unit checks: 74 passed, zero failed. These cover
  versioned saves, heading-link metadata, Markdown/HTML exports, schema rejection,
  paste, outline navigation, Word/PDF output and actual web heading tags.
- The randomized anchored round-trip check still compares exact contents for
  400 generated pages, now including all six heading levels. It exposed a real
  trailing-hash regression that was corrected before the passing run.
- Workspace typechecks and production build passed after the final changes.
- A subsequent entity-collision regression added literal `&#35;` and `&#38;`
  heading cases. Encoding ampersands before hash transport preserves those
  exact source strings; all 15 focused heading/parser tests passed afterward.
- The fresh full run after that correction passed all 1,955 tests, zero failed
  or skipped. Later settings redesign changes have separate validation; this
  count does not validate the newer settings layout.

Tests use disposable local data. The web renderer check exercises the actual
component as static markup; it does not establish visual or native interaction
correctness.

## Remaining acceptance

Visual inspection on web and mobile, including narrow layouts, heading menus and
outline indentation, is pending. The browser tool continues to reject the saved
local preview permission despite the user's approval; no alternate route was
used to circumvent that restriction.

This is a bounded part of D1. Multiline Setext headings, arbitrary code-fence
information strings, reference links, frontmatter, source/preview synchronization,
code coloring, math and the ten-family Mermaid matrix still require their own
acceptance evidence. The settings controls and session-retry refinement in the
same worktree are separate, unmerged changes.
