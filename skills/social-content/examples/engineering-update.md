# Worked example: implementation to public explanation

Synthetic facts: a failed-save draft is retained in a local implementation; one
disposable fixture check passed; the PR is open. No release, deployment,
performance measurement or customer result exists.

## Worked caption

I opened a PR to make a failed save less frustrating.

When a request fails, the editor now keeps the draft in my local implementation.
The person can retry without typing everything again. I checked that behavior
with a disposable fixture; review and broader verification are still ahead.

The useful design decision was to keep the editable draft separate from the last
saved value. A finished request does not always mean a successful save.

## Three-card brief

| Card     | Copy and visual intent                                                                             | Alt text                                                                          |
| -------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Problem  | “The request failed. The draft should stay.” Show a labelled synthetic editor state.               | Mock editor retaining a title after an offline save failure.                      |
| Decision | “Draft and saved value have different owners.” Diagram the local draft and versioned server value. | Diagram separating unsaved client text from the server's saved title and version. |
| Status   | “Local implementation. Open PR.” State the fixture result and remaining review.                    | Status card showing one fixture check, an open PR and no release yet.             |

## Claim notes outside the caption

| Claim                  | Available support            | Limit                           |
| ---------------------- | ---------------------------- | ------------------------------- |
| Draft retained locally | Supplied implementation fact | Not a release claim             |
| Fixture check passed   | Supplied disposable check    | No live/native coverage implied |
| PR open                | Supplied delivery fact       | Unmerged and undeployed         |

No screenshot, testimonial, engagement result or speedup is invented. This is
copy and a visual brief; the cards have not been rendered. Hand approved text,
project brand assets and these limits to [social-preview](../../social-preview/SKILL.md).

**Failure example.** “We launched a game-changing editor that never loses work.”
This invents release status and an absolute reliability claim.

**Reuse.** Keep a compact claim/support/limit table, then adapt the voice from
approved project or author examples through
[project context](../../orbyn-setup/references/project-context.md).
