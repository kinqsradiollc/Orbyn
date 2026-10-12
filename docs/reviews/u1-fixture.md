# U1 disposable QA fixture

Prepared on 12 October 2026 for candidate `3b488b51332d8cf46d25de913bd89dbe71bce428` (parent `4050e321`; baseline `9d786412`) in `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch `codex/c6-file-viewer`.

## Local services

- API: `http://localhost:8008`; `/health` returned 200. It uses only the disposable `orbyn_test` database, confirmed with `orbyn.environment=test`. The current service process is PID 71469 and binds `*:8008` because the API launcher hard-codes `0.0.0.0`.
- Shared desktop/web preview: `http://localhost:5174` (Vite returned 200), loopback-bound at `127.0.0.1:5174`, PID 67198.
- Mobile web preview: `http://localhost:8083` (Expo returned 200), loopback-bound at `[::1]:8083`, PID 67238. Expo logs the existing missing `ios.appleTeamId` warning; web preview starts successfully.
- Existing signup tab: `http://localhost:8081`. Its Terms modal initially failed to load because this origin was absent from the temporary API CORS list. The QA API was restarted with `http://localhost:8081` added alongside the two loopback preview origins; preflight now returns 204 with the matching allow-origin header. No repository source or tracked environment file was changed; only the protected temporary QA env file was updated.

## Account and consent

- Synthetic admin account is registered and email-verified in `orbyn_test`; authenticated `GET /me` returned 200 with role `admin`.
- The displayed consent version is `2026-10-08-managed-features`; the explicit local QA consent is recorded for that version.
- Credentials are in the protected mode-0600 local file `/var/folders/j4/_l7jsdmj24j2vdmvyd1f9qk80000gn/T/orbyn-u1-qa-8wlwnjlc/qa-admin.json`. Do not copy credential values into reports, messages, screenshots, or logs.
- The browser signup page at port 8081 showed the expected name/email/password/age-and-consent form. Its Terms modal still displayed “Couldn't reach Orbyn” after the CORS correction, and no request from that tab appeared in the QA API log. Browser signup remains unverified; the account itself was created through the local API. The local UI connection issue is outside U1 acceptance and does not block Visual's authenticated review.

## Synthetic fixture data

All records belong to the synthetic account and were created through the authenticated local API. The protected metadata file is `/var/folders/j4/_l7jsdmj24j2vdmvyd1f9qk80000gn/T/orbyn-u1-qa-8wlwnjlc/qa-fixtures.json` (mode 0600).

| Record  | ID                                     | Title                                                                                                                                |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Project | `b65105fa-3a51-4767-9530-75cfe68d953e` | U1 QA fixture 2026-10-12                                                                                                             |
| Task    | `179403ed-2554-43ad-8bdb-660df2f516b3` | Review the semester project plan, verify every milestone, gather team feedback, and prepare a clear summary before Friday's workshop |
| Page    | `550d3d8e-6cc2-4c27-a3e5-d165e4880aaa` | U1 QA fixture page 2026-10-12                                                                                                        |

After Visual Check moved from the web pass to Expo Settings and confirmed the task was not open, Tester updated this task title through the authenticated local API. The request returned 200; version advanced from 1 to 2, and task kind/status remained unchanged. No other fixture record was modified.

Tester retains ownership of the disposable services and records. Visual Check may inspect and interact with the fixture for its bounded changed-risk pass; do not add unrelated production data or provider credentials.
