# Synthetic example: test a Python acceptance path and worker retry

This is an original test plan, not a passing-test receipt. The implementation
language does not change the durable operation invariant.

The API accepts one operation key and the worker calls an external provider.
The client times out after provider acceptance. A retry must preserve that logical
identity and reconcile the existing outcome rather than creating another effect.

| Boundary         | Arrangement and observation                                                                                     | Limit                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Parser           | Real production parser rejects malformed input and preserves a valid operation key                              | Does not prove access rights                     |
| SQL acceptance   | Disposable supported engine receives simultaneous requests for the same scoped key and payload                  | Does not prove deployed writer state             |
| Provider adapter | Controlled endpoint accepts then delays/loses its response; retry uses reconciliation or the same supported key | Does not qualify the live provider               |
| Worker cleanup   | Controlled interruption leaves a recoverable claim and releases owned local resources                           | Does not prove every process-kill interleaving   |
| User recovery    | Draft persists while the operation is unknown; a terminal result resolves the displayed state                   | Browser evidence does not qualify native clients |

Use a controlled clock/barrier where the actual contract permits it. Assert
committed state, request identity and returned meaning rather than private helper
calls. Pair rejected/conflicting cases with a legitimate control. Register cleanup
when each fixture becomes owned so partial setup does not leak resources.

For a reported regression, obtain the failing-before signal on the unchanged
candidate when authorized, then apply the correction and recheck it. Preserve
missing execution or provider evidence. Do not turn this plan into production
calls, a full security scan or a requirement to install another test framework.
