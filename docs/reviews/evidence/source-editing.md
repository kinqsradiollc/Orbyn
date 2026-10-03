# Source editing candidate

Both Source / preview panes now allow edits only in Editing mode and delegate
them to the owning editor's existing update/save queue. They issue no separate
save requests or revisions. Reading and Suggesting modes remain inspection only.
Retained block anchors preserve comment/task identity. Duplicate anchors reject
that edit and offer restoration to the current accepted document. A stale source
base also rejects before it can overwrite a newer editor state.

Source buffers keep typed whitespace while parsed blocks drive preview. Weak
identity tracking recognizes delayed echoes of local edits without retaining old
document snapshots. Genuine external reconciliations replace the displayed source;
if the source is invalid, restoration is required first. Original parser line
ranges keep source/preview navigation aligned across blank lines, CRLF and
alternate fences. Native return-to-source caret positioning is imperative and
one-time, rather than continuously controlled while typing.

## Executed evidence

- 100/100 focused/parser/navigation/reference/code/Markdown regressions pass,
  with zero failures/skips/cancellations. Actual component functions execute in
  the source-view tests; the reconciliation effect and delayed local echoes are
  exercised. Core tests cover original ranges, duplicate anchors, preserved
  identities, final-line clearing and stale-base rejection.
- Initial final-line clearing test caught anchor loss; repaired. A later
  stale-base assertion caught a missing implementation argument; repaired with
  the assertion retained. Intermediate types/build failed on that mismatch;
  these runs are excluded from qualification.
- CUA inspected the actual native component in a synthetic iOS Expo fixture.
  Typed Markdown remained exact, rendered preview showed the changed heading,
  and toggling back retained extra blank lines. Duplicate anchors showed the
  explicit error and Restore returned to the last accepted source.
- Rapid typing initially scrambled text. Delayed-echo tracking and one-time
  native caret positioning were changed, then exact rapid text entry and
  validation recovery were observed. Screenshots are in `source-editing/`.
- A clipboard paste was interrupted by manual input and inserted unrelated
  text. It was not used as qualification. Subsequent native text entry used
  typing, with selection observed separately. Some other CUA actions were
  interrupted; no successful software-keyboard check is claimed.
- Final corrected workspace typechecks, production build and full formatting
  passed. Logs use `/tmp/orbyn-source-edit-qualification-{types,build,format}.log`.
- The fixture uses no product account/API data and makes no server saves.
  Its edit counter verifies owning callback delivery only.

## Open qualification

Frozen full suite/CI, actual signed-in editor
save/revision/conflict behavior, software keyboard/swipe/Android interaction and
full D1/U1 acceptance remain required. Web presentation is delegated to the
user's manual checks; denied browser access is not bypassed. This candidate is
not merged or deployed and does not complete C1–C6/M1/D1/U1.
