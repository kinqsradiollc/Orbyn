# Synthetic decision: offline tool versus shared service

**Scope:** research and recommendation only. No code, account, deployment or
production data changes. This example supplies hypothetical constraints, not a
claim about an existing Orbyn runtime.

The team maintains a single-user command-line tool in Python. It must work
without network access, store a small local job history and recover after a crash.
There is no current requirement for multiple machines to write the same state.

| Option                                | Fit with the stated constraints                                 | Remaining evidence                                                              |
| ------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Existing Python tool + local SQLite   | Retains team/tooling knowledge and an embedded storage boundary | Verify installed driver/version, transaction/recovery behavior and packaging    |
| New network service + server database | Adds operations and requires an offline strategy                | No shared-writer requirement currently justifies this boundary                  |
| Rewrite in another language           | Could satisfy local execution                                   | No measured bottleneck or distribution constraint currently justifies migration |

**Recommendation:** retain Python and investigate SQLite at the local storage
owner, conditional on compatibility and disposable recovery checks. This follows
the supplied requirements; it is not a universal preference for Python or SQLite.

**Three horizons:**

1. Now: define job identity, atomic result persistence and an explicit local file
   owner; use the Python and SQL guides and architect for the contract.
2. Next: verify interrupted-write recovery, bounded storage and a restorable backup
   under the authorized fixture. Do not equate an ordinary copy during writes
   with a proven consistent backup.
3. Later: revisit if multiple hosts must submit concurrent writes or a measured
   local bottleneck exceeds the budget. Keep a storage interface only at the real
   persistence boundary, plus a documented export format; do not build sync now.

**Evidence limit:** SQLite's documentation informs the embedded/network boundary.
No local driver, crash-recovery experiment or performance result was obtained in
this written example. Those checks precede a production implementation claim.
