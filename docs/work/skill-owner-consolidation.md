# Language owner consolidation — 24 October 2026

## Candidate and scope

Consumer base: merged main `6cdc382b`. Public candidate: PR #10,
`8d8809a145e948aa1e02af148f6aa1593687ea6e`, with 54 skills and 230 managed files.
This draft is separate from the released 55-skill pin `7876158` and does not
update the primary checkout or authorize a merge.

TypeScript guidance and its contract example now live under the language owner.
The original portable MIT notice is preserved byte-for-byte. Historical source
names remain in the provenance map; active repository links use the current owner.

The consumer discovery generator adopts only the retirement-aware delta: validate
an explicit old-name/current-owner map, preflight both hosts, remove only declared
symlinks into this same source tree, recheck them before unlinking and preserve
unmanaged/foreign content. The setup helper owns that logic. No global tools or
models are installed. The asset checker also verifies that the incorporated
TypeScript reference retains the imported upstream MIT notice.

Product stack, source, manifests, configuration and all REA adapters/engine pins
are unchanged. Generic public root guides are not copied into this application.

## Evidence

- Exact public pin and all managed hashes match.
- Actual 55-to-54 discovery update completed in the isolated consumer; both old
  owned TypeScript symlinks are absent and current host discovery checks pass.
- Source/attribution, model registry (zero changes), project context, Python AST,
  scoped documentation formatting and whitespace checks pass.
- The released 61-case archive and relocated TypeScript MIT notice have identical
  bytes to their pre-migration originals. The active 77-case suite validates;
  no model trials ran.
- The public candidate's hosted helper validation passed. Consumer disposable
  retirement/failure fixtures await the requested human test authorization;
  static checks and the actual local migration are not a claim that those
  independent negative-path fixtures ran here.

## Delivery

Prepared as a separate draft contribution from the existing approved fork.
Merge the public dependency first, then repin to its actual reviewed merged SHA
and recheck the consumer under a separate authorized merge. Preserve unrelated
local documents, output and private configuration. GitHub records the draft's
actual commit/check/merge state.
