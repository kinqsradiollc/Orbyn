# Publication media revocation candidate

## Reproduction and change

A published image used a signed file-store bearer URL that remained readable after
Unpublish. The real API/file-store regression returned 200 after publication was
removed (`/tmp/orbyn-publication-media-before-2.log`). The new public URL contains
only the publication slug, page ID and file ID. Every read checks current
publication, team publishing policy, page scope and current file reference, and
requires the current password cookie when the page is protected. Those checks
run again after bytes are fetched, before any file bytes reach the reader.

The existing authenticated file-store capability is used only inside the API.
Public responses are no-store, nosniff and sandboxed. No private renderer receives
file-store credentials or network access. Reads reject redirects, wrong MIME,
wrong size, partial data and disconnects. The API permits at most four outstanding
public reads and reserves at most 64 MiB of file bytes; it does not queue requests.
A public file larger than 64 MiB is refused with 413. The private upload limit
still applies when it is smaller. This limit bounds buffering independently of
private upload configuration.

## Transition and remaining scope

Previously issued bearer links retain their original expiry; they cannot be
distinguished from legitimate private preview links. This change revokes newly
issued publication-scoped URLs on subsequent requests. It does not revoke bytes
already downloaded or rotate the shared file-store key.

This candidate addresses publication media authority. Published Mermaid diagrams,
post-render page-authority fencing, complete publication acceptance and native
sharing remain open. It is not the full Docs or U1 completion checkpoint.

## Evidence

First full qualification at `edeb63a5` failed 2,297/2,298 locally and
CI37069676634: the new public media route was missing from the explicit public
inventory. Its scope/password/revocation defenses were checked before recording
it as public. The inventory ratchet remains unchanged; the corrected head needs
full qualification.

Focused checks pass 39/39 (11 actual-media integration checks, 18 existing
publication checks and 10 transport units), with no skipped/cancelled tests.
Log `/tmp/orbyn-publication-media-final-focused-2.log`. A first byte-budget
fixture incorrectly exceeded the configured per-file limit; it was corrected to
two 24 MiB reservations before testing a third request. The configured file limit
was retained, and the corrected check verifies both admission and recovery.

- Actual app and encrypted file service: unpublish, password requirement/password
  change, cross-page/file selection, removed reference, Trash, team publishing
  switch and current folder membership.
- Revocation and password changes while storage reads are in flight are refused
  before returning file bytes.
- Four-slot admission and recovery, byte-reservation admission/recovery, public
  size cap, no-store/security headers and rate-limit rejection exercised.
- Transport units cover signed first-party paths, redirect refusal, malformed
  metadata, body bounds, MIME/length mismatch, cancellation and hidden errors.
- Existing publication suite retains management 401, 403, bad-input and 429
  assertions.

Exact-head full local and CI qualification are required before promotion. No
release, deployment or cleanup is authorized by these focused results.
