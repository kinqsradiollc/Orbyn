# Worked example: approving a proposal

Synthetic design exercise; no application or deployment is represented.

**Request.** A member reviews a proposal, then clicks Apply. Another member may
edit the proposal or revoke that member's access before Apply arrives.

**Inputs.** Proposal identity, project identity, version, status and proposed
payload. The server owns current membership and the durable proposal state.

## Worked result

The UI sends proposal ID and expected version; the authenticated principal comes
from the server session. The apply service checks current project authority at
the effect boundary. It accepts only the reviewed version in a pending state.
Checking authority during the preview is insufficient.

Within one transaction, the service checks the version/state, applies local
domain changes and records the terminal result. Concurrent applies observe one
winning transition. A retry returns that operation's recorded result rather than
applying the payload again. If the effect is external, persist a stable operation
identity and pending delivery; reconcile an unknown outcome before retrying it.

| Event                              | Result           | Client behavior                            |
| ---------------------------------- | ---------------- | ------------------------------------------ |
| Current authorized pending version | Applied result   | Show the stored outcome                    |
| Proposal changed                   | Version conflict | Keep draft/context; request a fresh review |
| Membership revoked                 | Access denied    | Preserve local work without allowing Apply |
| Same operation retried             | Recorded result  | Do not duplicate the effect                |

The domain owns lifecycle; the API owns authority and transition; transport
preserves recognizable failures; each client renders the same durable result.
An approval badge or disabled button is presentation, not authorization.

**Evidence plan.** Exercise authorized apply, revocation, stale review and
concurrent/retried apply in disposable scope. These are planned checks, not results.

**Failure example.** A client sends `approved: true`, and the service trusts it
after checking that the user is signed in. This loses resource authority, reviewed
version and single-effect ownership.

**Reuse.** Fill the [change and recovery record](../../orbyn-workflow/references/task-record.md)
with the consuming project's actual owners and allowed verification.
