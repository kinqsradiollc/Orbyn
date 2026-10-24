# Worked example: a timed-out calendar write

Synthetic contract exercise. The provider supports stable idempotency keys and
lookup by key; verify those capabilities before using this design elsewhere.

**Request.** Create an external calendar event. The request times out after the
provider may have accepted it. The user retries from another client.

## Worked result

Persist one operation ID scoped to the authorized resource and logical request.
Store a fingerprint of the intended payload so reuse of a key with a different
request is rejected. Commit the pending operation before calling the provider;
do not keep a database transaction open across network I/O.

Send that same operation ID as the provider key. A timeout produces an unknown
delivery state, not a confirmed failure. Recovery looks up the existing key or
retries under the provider's documented idempotency contract. When confirmed,
persist the external ID and terminal result. A second client observes the same
operation rather than choosing a fresh identity and duplicating the event.

| Condition                         | Stored state                | API/client result                            |
| --------------------------------- | --------------------------- | -------------------------------------------- |
| Accepted locally                  | Pending                     | Operation ID and truthful pending status     |
| Provider timeout                  | Unknown                     | Keep draft/context; reconciliation available |
| Provider confirms                 | Succeeded                   | Recorded external ID                         |
| Key reused with different payload | Original operation retained | Explicit conflict                            |

The API checks present authority for new effects. Recovery ownership and policy
for revoked access must be defined; a worker is not exempt from effect policy.

**Evidence plan.** Simulate a timeout after provider acceptance, then repeat the
request and verify one external event and one terminal record. Include changed
payload/key conflicts. This example has not executed a provider call.

**Failure example.** Treat every timeout as safe to retry with a random new key.
An HTTP error does not prove that the external effect failed.

**Reuse.** Use the [task record](../../orbyn-workflow/references/task-record.md) to
name the actual provider guarantees, recovery owner and unverified conditions.
