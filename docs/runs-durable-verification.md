# Assistant Runs That Survive: verification in progress

Scope: the governing Claude artifact, R1–R10. Branch `runs/durable`;
checkout `~/Documents/Github/orbyn-wt/runs-durable`. This document is a review
record, not a completion claim.

## Verified evidence

- The serial full backend suite in `/tmp/orbyn-runs-final-tests.log` passed
  1,655 tests. It predates the latest Overnight question/approval additions.
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

| Requirement                        | Current evidence or gap                                                                                | Next proof                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| R1 refresh                         | Hooks and backend integration tests exist; required 1440/390 mid-run screenshots are missing           | Reload a running chat on web and phone; verify progress, Stop, question, saved reply and Undo                    |
| R4 waiting restart and remote Stop | Child runner replacement preserves the saved question; another API process stops blocked provider work | Six process recovery tests pass, including one saved answer and refusal of answers after Stop                    |
| R7 ordering                        | Handed tasks precede goals/routines; enabled kinds follow earliest due work                            | Thirteen selection and ordering tests pass, including a case that distinguishes due order                        |
| R7 actual kinds                    | Selection tests cover calendar-only exams and meetings, new notes, Friday review and privacy           | Verify ordinary lead/specialist/checker/apply execution for each named kind and its safety limits                |
| R9 goal Book                       | Goal Book selects current linked unfinished owned work; web and native Book/Undo passed                | Focused source, action, route isolation and catalog tests pass (38 cases)                                        |
| R9 missed habit                    | Habit reminders offer Book using saved cadence, duration and scheduling windows                        | Targeted planner and guarded Undo tests pass; native Book created 45 minutes and Undo removed it                 |
| R9 source identity                 | Subscription exam keys include calendar name and start time                                            | Audit rename and simultaneous-event identity stability                                                           |
| R10 decisions                      | Partial API tests pass; rendering tests cover questions/approvals                                      | Exercise populated proposal/activity cards, per-change and bulk decisions, and direct answer/approval submission |
| Final gates                        | Passing full suite predates latest changes                                                             | Run final package build, typecheck, formatting and serial tests after edits settle                               |
| Handoff                            | Branch remains local, worktree retained                                                                | Reconcile latest main, push `runs/durable`, provide final report; no PR or merge                                 |

## Changed migrations

181 durable assistant jobs; 182 apply receipt; 183 assistant notifications;
184 night settings; 185 Tonight tasks; 186 nights and runs; 187 reminder
settings/ledger; 188 reminder sources; 189 morning notification receipt;
190 revision-to-exam link. Confirm numbering against latest main before handoff.

## Local preview

Web: `http://localhost:5188/`; API: port 8018; Expo Go: Metro port 8083.
Preview data uses a separate marked test database. Never commit `.env` or
`mobile/app.json`. Stop work if free disk space falls below 3 GB, as required
by the artifact. Last measured free space: 4.6 GiB.
