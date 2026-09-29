# Assistant Runs That Survive: verification in progress

Scope: the governing Claude artifact, R1–R10. Branch `runs/durable`;
checkout `~/Documents/Github/orbyn-wt/runs-durable`. This document is a review
record, not a completion claim.

## Verified evidence

- The serial full backend suite in `/tmp/orbyn-runs-final-tests.log` passed
  1,668 tests in `/tmp/orbyn-runs-final-current-tests.log`. It predates the final declined-card status correction; the subsequent focused Overnight suite passed eight cases.
- The latest Overnight API tests passed all seven cases, including ownership,
  partial Keep/Undo, bulk decisions, and visibility of waiting questions and
  approvals. Log: `/tmp/orbyn-runs-approval-tests.log`.
- Full typechecking passed after the approval additions.
  Log: `/tmp/orbyn-runs-approval-typecheck.log`.
- Actual child-process tests kill a runner during a specialist and after an
  apply commit. They assert completed report reuse, one resulting task, a
  resume trace, and reuse of the committed apply receipt.
- Native task reminders exercised Done, Move, Skip and Book time, with Undo
  restoring every disposable change.
- Web and native Overnight render saved questions, choices, free-text fields,
  approval summaries and Approve/Decline controls. Rendering fixtures are
  explicitly disposable, not evidence of actual overnight AI execution.

## Remaining work and evidence

| Requirement                        | Current evidence or gap                                                                                                         | Next proof                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 refresh                         | 1440px progress/Stop and 390px question/Stop screenshots captured; web and Expo Go restored the saved question after reload     | Native answer completed one existing job; DB has one answer and one completion. Retry tests cover 429, 500, network loss, 404 and Stop during backoff                                                                             |
| R4 waiting restart and remote Stop | Child runner replacement preserves the saved question; another API process stops blocked provider work                          | Six process recovery tests pass, including one saved answer and refusal of answers after Stop                                                                                                                                     |
| R7 ordering                        | Handed tasks precede goals/routines; enabled kinds follow earliest due work                                                     | Thirteen selection and ordering tests pass, including a case that distinguishes due order                                                                                                                                         |
| R7 actual kinds                    | Selection tests cover calendar-only exams and meetings, new notes, Friday review and privacy                                    | Verify ordinary lead/specialist/checker/apply execution for each named kind and its safety limits                                                                                                                                 |
| R9 goal Book                       | Goal Book selects current linked unfinished owned work; web and native Book/Undo passed                                         | Focused source, action, route isolation and catalog tests pass (38 cases)                                                                                                                                                         |
| R9 missed habit                    | Habit reminders offer Book using saved cadence, duration and scheduling windows                                                 | Targeted planner and guarded Undo tests pass; native Book created 45 minutes and Undo removed it                                                                                                                                  |
| R9 source identity                 | Subscription exam keys include calendar name and start time                                                                     | Audit rename and simultaneous-event identity stability                                                                                                                                                                            |
| R10 decisions                      | Web and native individual Keep apply one task; individual Undo removes it; seven API tests pass                                 | Web Keep all created four tasks; native Undo all removed them and preserved waiting cards. Direct Overnight web answer and Approve passed; native Decline applied nothing. Declined-card label corrected with regression coverage |
| Final gates                        | 1,668 full-suite passes, final focused Overnight eight passes; full typecheck and format passed before declined-card correction | Backend typecheck rerun after declined-card correction; repeat final gates after remaining R7 and source-identity work settles                                                                                                    |
| Handoff                            | Branch remains local, worktree retained                                                                                         | Reconcile latest main, push `runs/durable`, provide final report; no PR or merge                                                                                                                                                  |

## Changed migrations

181 durable assistant jobs; 182 apply receipt; 183 assistant notifications;
184 night settings; 185 Tonight tasks; 186 nights and runs; 187 reminder
settings/ledger; 188 reminder sources; 189 morning notification receipt;
190 revision-to-exam link. Confirm numbering against latest main before handoff.

## Local preview

Web: `http://localhost:5188/`; API: port 8018; Expo Go: Metro port 8083.
Preview data uses a separate marked test database. Never commit `.env` or
`mobile/app.json`. Stop work if free disk space falls below 3 GB, as required
by the artifact. Last measured free space: 8.8 GiB.

## Refresh runtime evidence

Screenshots: `/tmp/orbyn-midrun-refresh-1440.png`, `/tmp/orbyn-midrun-refresh-390.png`, `/tmp/orbyn-midrun-question-1440.png`, `/tmp/orbyn-midrun-question-native.png`, `/tmp/orbyn-midrun-answer-native.png`.
The disposable provider made two calls for the original refresh test, and the database contains exactly one job, one saved person answer and one final completion. The temporary provider was stopped gracefully and the preview provider settings restored.
