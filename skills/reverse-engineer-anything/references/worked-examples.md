# Worked investigation examples

These scenarios use synthetic names and abbreviated observations. They are
decision examples, not executable Evidence records, runtime transcripts or proof
of provider qualification. Placeholder IDs must never be submitted to a server.

## Offline package inspection without REA

**Request:** Explain whether `sample-app.asar` contains the Settings UI; no network
or execution is allowed. Local archive tools are available, but REA is absent.

Read local instructions, preserve the archive, identify its digest, and use only
supported static inventory/source inspection. An inventory entry named
`settings.js` supports the existence of that entry. A selected source range can
support what it renders. Neither proves the UI works or that the artifact's
publisher is authentic. If the available tools cannot read ASAR, report that
specific gap and continue with any supplied source or inventory; do not install
REA or claim that a filename established behavior.

**Useful answer:** “The supplied inventory contains `settings.js`; runtime
reachability is unobserved. REA is unavailable, and no runtime was installed.”

## Summary to comparison

**Request:** Compare selected functions in two supplied binaries. The connected
server returns a summary whose own ID is `summary-A` and whose
`parent_evidence_id` is `dossier-A`; the other side similarly names `dossier-B`.

Inspect the comparison schema. If it supports retained-evidence inputs on the
same session, reference `dossier-A` and `dossier-B`. If it needs complete inline
records, retrieve those through the supported complete-detail path. Do not pass
`summary-A` as a complete dossier. Preserve original records and compare identity,
scope and coverage before interpreting differences. Export what a later session
needs before closing; two IDs in prose are not a transferable bundle.

**Counterexample:** A successful summary response does not prove the next tool
accepts that record. An older server with no retained-reference input needs its
own supported complete-record path; do not add unsupported parameters.

## Dropped connection after a possible effect

**Request:** Capture one authorized UI action. The connection disappears after
the action request was sent; no receipt establishes whether the click happened.

Do not send the click again. If available and authorized, inspect current target
state or an operation receipt without repeating the effect. Report uncertain
completion and the connection failure. Reconnect through supported host controls,
or explain the human-only reconnect step if unavailable. Recovery does not grant
permission for a second action, target restart or broader capture.

## Useful result with incomplete cleanup

**Observation:** Analysis produced evidence, but closing its owned provider
reported `cleanup_incomplete` for one named session. A second resource already
closed successfully.

Retain the result and original error. Use the failed session owner's supported
cleanup retry; do not close the successful peer again or open a replacement that
needs the retained resource. If that owner later confirms release, report both
the initial failure and final cleanup state. If it does not, return the bounded
analysis answer with cleanup explicitly unresolved.

## Static routes and partial pages

**Observation:** Selected JavaScript sources yield a `/reports/:id` candidate
and a route-view page with no rows after a path filter. Capture omissions remain.

Report the candidate with its source/confidence. Inspect the page's filter and
pagination coverage before interpreting the empty selection. Do not conclude
that no routes exist or request `/reports/:id` without runtime scope. Candidate
enumeration and application-wide route coverage are different claims.
