# Existing security findings — remediation

Scan launches are prohibited unless explicitly requested by the user. The running scan was canceled on 2026-10-11; no replacement scan is authorized.

## Provenance

- Canceled scan: `ebfaae69-dabc-4522-bc2a-864feb6c577b`, source `bb7a046faefbc71b00bcfa44d957fc4833d2e0c9`.
- Saved evidence: `/Users/anhdang/.codex/state/plugins/codex-security/scans/Orbyn/bb7a046faefbc71b00bcfa44d957fc4833d2e0c9_20261011T044121Z_rcg1bchv/findings.json` and adjacent report/coverage files.
- Cancellation preserved 29 findings (1 high, 11 medium, 17 low), including duplicates. Coverage is partial; this is not completed security qualification.
- Earlier failed deep scan `30b1bbab-5026-4277-83f2-8be283f72aff` stopped on worker usage limits. Earlier completed diff scan `f3fa3b73-0b8f-453f-9416-4a435b708594` had zero findings for its narrower, older source range. Neither overrides these findings.
- Remediation checkout: `codex/c6-file-viewer`; starting source `81e4c812`. Other agents' frozen evidence remains scoped to that revision.

## Finding ledger

| ID                             | Severity | Finding                                                                            | Disposition                                              |
| ------------------------------ | -------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `csf_dfe2ad58545c5635d284fa59` | medium   | OAuth clients receive refresh tokens without offline_access consent                | Source patched; concurrency closure pending — evidence A |
| `csf_c6a85f0085a6d707974b12d6` | medium   | Emergency gateway switch leaves plugin agent calls enabled                         | Patched — evidence B                                     |
| `csf_70c141c047ebb69631bcc3e1` | medium   | Personal API keys can publish private document blocks                              | Patched — evidence C                                     |
| `csf_f4593471f78545cef6528bf8` | low      | Oversized provider replies can exhaust an AI worker                                | Patched — evidence D                                     |
| `csf_ef474eb2460d123df9c93669` | medium   | CIMD OAuth client allowlist omits redirect recipient hosts                         | Source patched; concurrency closure pending — evidence A |
| `csf_66e70d1a3be4d3bea980fe05` | medium   | Publishing a folder exposes private Memory pages inside it                         | Patched — evidence E                                     |
| `csf_855f85888987d9eaf7995613` | medium   | A database dump can decrypt saved provider credentials when `SECRETS_KEY` is unset | Source correction; round 1 closure pending — evidence F  |
| `csf_d7472891cdde03e7ce070392` | medium   | Gateway logs expose reusable private-file read links                               | Patched — evidence G                                     |
| `csf_b99c8c70006412851cd97b43` | low      | Compose deployment can create world-readable database backups                      | Patched — evidence G                                     |
| `csf_d2c8b160976027d320ddc96e` | low      | Kubernetes backend pods receive unrelated service secrets                          | Patched — evidence H                                     |
| `csf_0212abc5427a842fe09a1ebf` | medium   | Revoked document reader keeps receiving live edits                                 | Source patched; real-route closure pending — evidence I  |
| `csf_5c8da338d16dbbc97cbc0ffd` | high     | Public registration grants admin before email ownership is verified                | Patched — evidence J                                     |
| `csf_fc9fe31eeead1c1791737ed4` | low      | Revoked reader can reuse private file URL for one hour                             | Source patched; real-route closure pending — evidence I  |
| `csf_974cc5f3be2fa60fa5c1fd07` | low      | Team viewer can create a shared meeting note                                       | Patched — evidence K                                     |
| `csf_5100a5087641072314cf7a41` | low      | Full calendar feed tokens reach gateway access logs                                | Patched — evidence G                                     |
| `csf_7c2503272855fbf74e50c5b7` | low      | Existing OAuth tokens inherit permissions added by later consent                   | Source patched; concurrency closure pending — evidence A |
| `csf_1df6706603fc69e1f04784f4` | low      | Personal API keys can create public booking pages                                  | Patched — evidence C                                     |
| `csf_692cbc357365829cc6ea5947` | low      | A copied spent refresh token can regain account access during the retry window     | Source patched; concurrency closure pending — evidence A |
| `csf_19327ee4f66e9d9b6a70116f` | low      | Opening a password-protected publication reveals its title                         | Patched — evidence E                                     |
| `csf_d3cf20a1fbc6ec294835a764` | low      | Publishing a page exposes labels of linked password-protected pages                | Patched — evidence E                                     |
| `csf_0cdc79b487a7528da743c19e` | medium   | Provider DNS check is not bound to outbound connection                             | Patched — evidence D                                     |
| `csf_00014496639da3f24fb52f45` | medium   | Gateway logs expose reusable private-file read links                               | Patched — evidence G                                     |
| `csf_a4288595ea4fdd593f96c3e4` | low      | Private page file bearer URLs reach gateway access logs                            | Patched — evidence G                                     |
| `csf_5d7ed8904970a05ab6af0c77` | low      | Bearer URLs for private calendar feeds and page files reach gateway access logs    | Patched — evidence G                                     |
| `csf_f7d77394402a3216480b5277` | low      | Public requests from the default Docker Desktop subnet bypass gateway abuse limits | Patched — evidence B                                     |
| `csf_bd354110ac729c0af63a9dc5` | low      | Removed team members can see current page titles in kept originals                 | Patched — evidence L                                     |
| `csf_f72d6ec0f2fddd2ab09b5a01` | low      | Former team members can download page files through unexpired links                | Source patched; real-route closure pending — evidence I  |
| `csf_2d7c100558d5353a26a576cb` | medium   | Allowed CIMD host can send OAuth codes to a disallowed redirect host               | Source patched; concurrency closure pending — evidence A |
| `csf_4c0791785f8592845c3209cc` | low      | Public page reveals the title of a password-protected linking page                 | Patched — evidence E                                     |

## Prevention

[AGENT.md](../../AGENT.md) explicitly prohibits unsolicited scans. [Remediation skill](../../skills/orbyn-security-remediation/SKILL.md) records recurring security boundaries and evidence requirements. Preserve failed/canceled outcomes; do not restart an interrupted scan as a substitute without explicit authorization.

## Patch and evidence map

“Patched” means the reported boundary is corrected in source. It does not mean a
new scan or production deployment passed. Duplicate IDs share the same fix.

| Ref | Corrected boundary                                                                                                                                                                                                              | Focused evidence                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Offline consent gates refresh issuance; replay revokes the family. Renewed consent invalidates old tokens/codes. Consent mutation and code issuance are atomic; exchange compares generations. CIMD checks every redirect host. | OAuth suite and recipient unit controls; read-only race review closed. Migrations 265/266.                                            |
| B   | MCP emergency switch also disables plugin recipient; default Docker subnet rate exemption removed.                                                                                                                              | Gateway/Compose source and security unit assertions; shell syntax.                                                                    |
| C   | Personal keys cannot create/update scoped publication or booking pages.                                                                                                                                                         | API-key endpoint matrix plus unit route policy controls.                                                                              |
| D   | Provider response bytes bounded; validated DNS address pinned to actual socket; encoded IPv6 metadata aliases refused.                                                                                                          | Provider unit/redirect/catalog/output/Responses protocol controls, real loopback redirect checks.                                     |
| E   | Memory/agent pages excluded from public/scoped publication, folder navigation and media; protected titles/linked labels/backlinks hidden. Unprotected folder access stays valid.                                                | Publication media/scoped suites, new guessed-path/navigation/password/label/backlink controls.                                        |
| F   | Production requires external key; migration rewraps legacy encrypted columns, SMTP JSON and cached maintenance JSON before retiring DB key.                                                                                     | Upgrade fixture verifies all three stores, decryption and idempotency; backend types.                                                 |
| G   | Gateway access logs omit request URL, query and referrer; backups use umask 077 and directory mode 700 before writes.                                                                                                           | Security unit config assertions and shell syntax. Old logs/backups remain sensitive.                                                  |
| H   | Kubernetes processes receive explicit service secrets rather than whole Secret. API LISTEN and notifier signing/installation keys retained.                                                                                     | YAML parse and read-only service dependency inspection; no cluster rollout performed.                                                 |
| I   | Signed private reads bind user and recheck current visibility/disabled state; internal public media has separate service purpose. SSE notification delivery rechecks credential and resource visibility.                        | Storage success, legacy URL rejection, disabled user and removed teammate controls; live notification revocation and CRDT log suites. |
| J   | Public signup/login cannot promote admin by email or first-user order; trusted grant-admin CLI remains operator-controlled.                                                                                                     | Auth verification suite with configured admin address and explicit fixture operator promotion.                                        |
| K   | Shared event-note creation requires team write permission in transaction; existing notes stay readable.                                                                                                                         | RBAC fixture verifies viewer cannot create a note but can read an existing note; owning docs suite passed.                            |
| L   | Kept-original inventory hides current page title when current visibility is lost.                                                                                                                                               | Originals suite and source predicate inspection; bytes remain original-owner property.                                                |

## Builder verification receipts

All database commands used the separate disposable
`orbyn_security_remediation_test` at local PostgreSQL port 55434, marked
`orbyn.environment='test'`. No production database, live vendor or security scan
was exercised. Logs are local `/tmp/orbyn-security-*.log` files; suite receipts
overlap and must not be summed as independent coverage.

- Backend `npm run typecheck -w backend`: exit 0 after corrections.
- Auth verification, OAuth, API keys and providers serial suite: **50/50**.
- OAuth, publication media, scoped publication, originals and upgrade suite:
  **59/59** before the additional privacy fixtures.
- Transport/public-media/upgrade focused batch: **99/99**, exit 0.
- New privacy/media fixture suite: **18/18**, exit 0, including password labels,
  Memory guessed paths and revoked-member signed reads.
- Final focused batch (media/upgrade/live revocation/embedding catalog): **46/46**,
  exit 0 before the last two media assertions, which passed in the 18/18 receipt.
- Final controls batch: **68/69**; the sole failure used a non-resolving `.invalid` URL for a dormant provider update. Replaced with an inert loopback URL; affected controls rerun **7/7**. Other docs, RBAC, catalog authority and multipart controls passed in that batch.
- RBAC including new viewer note creation/read control: **9/9** on corrected fixture ordering.
- `sh -n gateway/entrypoint.sh scripts/deploy.sh`: passed.
- Kubernetes YAML and skill YAML frontmatter parsed successfully with repository
  `yaml`. Skill Creator's Python quick validator was unavailable (`yaml` module
  missing); do not count that failed tool as passed.

Earlier failed attempts are retained: OAuth 49/50 used a token superseded by later
consent; 26/50 was the local already-applied migration-column mismatch, corrected
by new migration 266. Publication 17/27 and 16/28 exposed internal-media token and
upload-argument regressions, now corrected. Access batch 20/21 had an incorrect
expected 200 for the correctly locked 401 page, corrected in the passing rerun.
A first viewer-note fixture ran after the owning account had been deleted by an earlier test (8/9); its isolated team was moved before account deletion, then 9/9 passed. An attempted Prettier invocation on `.env.example` had no inferred parser; source/docs formatting was rerun on supported file types.

## Read-only review

One remediation review round. Independent investigation grouped duplicates and
identified current authority boundaries. Patch reviewer then found five correction
issues: issuance race, upload query args, recording identity, cached-maintenance
key upgrade, notifier signing secret. Builder fixed them as a batch; same-round
closure found no remaining concrete blockers within that scope. Reviewer did not
edit source, run tests/builds or scan. Broader C6 formal acceptance remains separate.

## Upgrade and delivery limits

- Configure a stable 32-byte base64 `SECRETS_KEY` before production migration;
  securely retain it outside database backups. Rewrap is transactional and stops
  on bad ciphertext. Restart services after migration to discard legacy key caches.
- Legacy refresh credentials without recorded offline consent are removed by 265;
  users reconnect. Spent-refresh retries now fail and revoke their token family.
  Older identity-free private file URLs require reopening the page.
- Existing admin accounts are preserved; public signup cannot bootstrap a new one.
  Operators use `npm run admin:grant -w backend -- <email>` after verifying ownership.
- Existing logs/backups cannot be made confidential by changing future writes.
  Restrict or retire those through the operator's retention process.
- No production deployment, Kubernetes rollout, live OAuth or whole-repository
  security qualification is claimed. No replacement scan is authorized.
- Source candidate freeze and formal Tester/Reviewer outcome will be recorded in
  the C6 delivery record. This ledger does not silently waive its external-host gates.

## Frozen candidate and formal qualification

Source changes committed as `4da327dc05f93dc8aa4d8aa35225767e175bcf73`;
docs freeze `462ac8db`. Independent
[Tester report](security-remediation-tester-2026-10-11.md) confirms 218/218 across
29 serial processes, workspace package/backend builds, backend typecheck,
Compose/deploy preflight, shell syntax and YAML checks. Formal Reviewer round 1/3
is underway. Main merge, push and production deployment are not claimed.

## Round 1 correction batch — 11 October 2026

Formal Reviewer identified SR-R1 (unsafe rolling legacy-key conversion) and
SR-E1 (real revocation/concurrent consent evidence). Corrections now enforce
Compose stop/remove of every backend writer before legacy conversion, a
production migration attestation for quiesced cutover, valid external key length,
and explicit Kubernetes shutdown/failure/retry instructions. Ordinary deployments
without a legacy key retain rolling replacement. Operator attestation cannot
independently prove an external Kubernetes writer is stopped.

Builder checks on this batch:

- `security-secret-upgrade.test.ts`: 1 pass, covering three-store conversion,
  missing cutover attestation, malformed SMTP rollback, retained legacy key,
  corrected retry, decryption and idempotency.
- `security-live-revocation.test.ts`: 2 passes; the new real HTTP/SSE route
  verifies initial CRDT delivery, committed session removal, later parcel
  rejection/connection closure and an authorized reader control.
- Two focused OAuth interleaving tests: 2 passes; actual PostgreSQL lock blocks
  replacement consent during issuance, and consumed obsolete code fails after
  replacement consent while the new code succeeds. An initial 1/2 run exposed
  a test barrier mistake (pool callback bypassed the client promise wrapper);
  corrected with a pool-level barrier, not a product behavior change.
- `security-deploy-cutover.test.ts`: 2 passes; executes the real deploy script
  with a fake Docker CLI, models cached writer late-write attempts, checks all
  backend writers stop/remove before attested migration, and verifies migration
  failure cannot restart replicas. Initial 0/2 fixture run omitted the gateway
  fingerprint inputs; corrected fixture then passed. This is not a real Docker
  production deployment.
- Backend types and Bash syntax pass. Unaffected Tester 218-pass evidence
  remains source-scoped to `4da327dc`; counts are not combined.

Tester retest and same-round Reviewer closure are pending. No new security scan,
main merge, production migration or full C6 external-host acceptance is claimed.

### Same-round fresh-fixture and retired-key correction

Tester’s `dc094b4b` retest retained 37 passes and one fresh-database SSE
fixture failure: `since=1` excluded the first update when its sequence was 1.
The corrected fixture seeds a baseline and uses its returned sequence. The
failure and invalid retry remain in the Tester report; they are not erased.

Legacy decryption now reads an existing wrapping key without creating one.
Missing retired keys fail with recovery guidance; legitimate local encryption
can still create its initial key. This prevents orphan legacy ciphertext from
recreating a retired database key after cutover.

Builder ran secret retirement, secrets-db, secret upgrade and live revocation
serially on the marked disposable test database: **6 passed, 0 failed/skipped**,
exit 0. Log: `/tmp/orbyn-c6-final-builder-check.log`. Independent fresh-database
Tester qualification and same-round Reviewer closure remain pending (round 1/3).

### Round 1 closure

Independent fresh Tester report `security-remediation-tester-r1-937cb16f-2026-10-11.md`
confirms 6/6 and backend types on `937cb16f`, with unchanged OAuth33/deploy2 receipts
retained separately. Reviewer accepted runtime937cb16f plus docs/templates
through `b607e1dc` and closed SR-R1/SR-E1 within round 1/3. The 29 saved findings are
source-remediated under the bounded reviewed scope; no clean scan is claimed.
Real-host and production transition acceptance remain unverified.
