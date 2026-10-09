# Product content cleanup — candidate handoff

Status: Builder candidate on `codex/content-density`, based on main
`c778c25f`. Tester qualified the first frozen candidate `00098f37` and
reported six copy/test findings in
`content-density-test-00098f37-2026-10-09.md`. Builder corrected those
findings for a focused retest. The user requested this pass after C2/M1 and
explicitly stopped Visual Check. No browser or native visual acceptance is
claimed.

## Scope and decisions

| Surface                                       | Change                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public and signed-in Home                     | Shorter feature copy; signed-in agent guide shows timing, review destination and pause conditions without repeating the full walkthrough.                                             |
| AI settings on web/desktop and mobile         | Connection and device lead; provider, scheduled summary and usage follow. Workspace usage sits inside the mobile AI section. Duplicate empty-state and disabled actions were removed. |
| Admin, planning, privacy and connections      | Shorter routine hints and empty states; keep provider fallback, usage scope, security logs, token consent, key handling and destructive consequences explicit.                        |
| Onboarding, Docs, projects, booking and tasks | Replace long task instructions with short action-focused copy across the paired clients. Preserve user-authored titles and document content.                                          |

Source audit covered static JSX text in desktop and mobile and the shared Home
guide. Thirty-two JSX text nodes of at least 100 characters remain, largely
for consent, privacy, access, data-retention, destructive actions or developer
reference. Length alone was not treated as a defect. Conditional/dynamic copy
was reviewed at the changed call sites; user-authored content was not edited.

## Builder checks

- Prettier on changed files and `git diff --check`: passed.
- Desktop and mobile TypeScript `--noEmit`: passed against the installed C2
  dependency tree. Offline `npm ci` could not complete because its npm cache
  lacks the locked mobile TypeScript tarball; temporary local `node_modules`
  links were removed after these checks. Shared packages are unchanged from
  `c778c25f`.
- Focused Home, ChatGPT settings and usage tests: **73/73 passed**.
  Output: `/tmp/orbyn-content-focused-tests.log`.
- Focused admin/provider/embedding UI tests: **91/91 passed**.
  Output: `/tmp/orbyn-content-admin-tests.log`.

Tester should retest the corrected source, especially the ChatGPT usage UI
assertion and the six content findings in its first report. Reviewer should
assess the cross-client copy, retention of material consent/consequences, test
evidence and any UI logic changes. One full review round starts after Tester
reports on the corrected candidate.
The user excluded further Visual Check, iOS/Android builds and broad repeated
testing. Production deployment remains user-owned.
