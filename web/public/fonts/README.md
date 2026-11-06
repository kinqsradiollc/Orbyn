# Web typefaces

Orbyn serves Geist and JetBrains Mono from this directory. No font stylesheet or font
binary is requested from Google while the application runs. Family names, system
fallbacks and text roles live in `src/ui/tokens.css`.

These are unmodified WOFF2 variable-font subsets distributed by Google Fonts: Geist,
weight 100–900, and JetBrains Mono, weight 100–800. The local stylesheet keeps their
published Unicode ranges and `font-display: swap`. Latin faces are preloaded;
additional script subsets load on demand. Content hashes in filenames change when the
font bytes change.

Both families use the SIL Open Font License 1.1. Keep the complete copyright and
licence notices with the distributed fonts:

- [Geist licence](geist-OFL.txt), from the
  [Google Fonts Geist directory](https://github.com/google/fonts/tree/main/ofl/geist).
- [JetBrains Mono licence](jetbrains-mono-OFL.txt), from the
  [Google Fonts JetBrains Mono directory](https://github.com/google/fonts/tree/main/ofl/jetbrainsmono).

[sources.json](sources.json) records the exact official stylesheet request, font
URLs, byte counts and SHA-256 hashes. No font has been renamed internally, subsetted
or converted by Orbyn. Unsupported glyphs continue to use the declared system fallback.
