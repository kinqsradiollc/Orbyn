# Web typefaces

Orbyn serves DM Sans and Manrope from this directory. No font stylesheet or font
binary is requested from Google while the application runs. The existing family
names, system fallbacks and text roles remain in `src/ui/tokens.css`.

These are unmodified WOFF2 variable-font subsets distributed by Google Fonts:
DM Sans v17, weight 100–1000 and optical size 9–40; Manrope v23, weight 200–800.
The local stylesheet retains their published Unicode ranges and `font-display:
swap`. Latin faces are preloaded; additional script subsets load on demand.
Content hashes in filenames change when the font bytes change.

Both families use the SIL Open Font License 1.1. Keep the complete copyright and
licence notices with the distributed fonts:

- [DM Sans licence](dm-sans-OFL.txt), from the
  [Google Fonts DM Sans directory](https://github.com/google/fonts/tree/main/ofl/dmsans).
- [Manrope licence](manrope-OFL.txt), from the
  [Google Fonts Manrope directory](https://github.com/google/fonts/tree/main/ofl/manrope).

[sources.json](sources.json) records the exact official stylesheet request, font
URLs, byte counts and SHA-256 hashes. Licence bytes were checked against the listed
Git blob identities. No font has been renamed internally, subsetted or converted
by Orbyn. Unsupported glyphs continue to use the declared system fallback.
