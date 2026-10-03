# Home content and review layout

## Research and decision

Primary references, read on 3 October 2026:

- [Muse design](https://introducing.muse.ai/): activity behind the avatar,
  goals and task-shaped outputs, selective updates and explicit approvals.
- [Dots profile/task controls](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot):
  in-progress, scheduled and completed work; task review and pause controls.

Applied interpretation: Home should describe a responsibility and a review path,
then let the person inspect progress. Orbyn’s Background and Overnight stay separate.
The sources’ computer, voice, messaging and always-on capabilities are outside scope.

Public Home keeps each example request, review destination and pause condition
visible. Its procedural steps move to two ordinary disclosure elements, closed by
default. Signed-in web/desktop/mobile keep review destinations and stop conditions
visible; only examples and procedural help require opening the guide. Both clients
use the same core copy. All character presets remain intact.

## Evidence and limits

The first focused run passed 11/13: both clients still had an assertion for the
replaced “wake up to results” copy. Updated it to the actual morning distinction
between finished work and queued work, retaining all state/privacy/preset checks.
Original failure: `/tmp/orbyn-home-review-layout-focused.log`.

Current focused group: 13/13 pass, zero skips/cancellations. All workspace
typechecks, production builds and full repository formatting pass. Logs:
`/tmp/orbyn-home-review-layout-focused-2.log`,
`/tmp/orbyn-home-review-layout-types.log`,
`/tmp/orbyn-home-review-layout-build.log` and
`/tmp/orbyn-home-review-layout-format.log`. Matching-head full local/CI
qualification remains required before promotion.
Component rendering tests prove content/disclosure structure, not visual layout.
No screenshot acceptance claimed. Web review belongs to the user’s test server;
native interaction and screenshot acceptance remain open. This branch is stacked
on PR165 and cannot be promoted as though its parent/native acceptance were complete.
