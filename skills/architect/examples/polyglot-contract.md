# Synthetic example: Python API, Go worker and SQL storage

This original example describes a design, not an implemented Orbyn feature or an
executed cross-language qualification. Use the consuming project's actual owners.

A Python endpoint accepts a document-processing request and a Go worker performs
the job. SQL owns durable operation state. The API and worker must agree before
adding a queue adapter or UI progress event.

| Concern   | Contract decision                                                                   | Failure to prevent                                               |
| --------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Identity  | One operation key scoped to the authenticated principal and same logical payload    | A client timeout generates a second operation                    |
| State     | Accepted, claimed and terminal results have one durable owner                       | API and worker each invent a different completed state           |
| Encoding  | IDs travel as validated decimal strings; timestamps carry an explicit timezone/unit | A JavaScript consumer silently loses a large integer             |
| Version   | Envelope and stored revision have explicit compatibility rules                      | A released worker accepts a shape it cannot interpret            |
| Authority | Scope is rechecked at the effect under the actual delegation policy                 | Possession of a queue message substitutes for current permission |
| Recovery  | Expired claims can be reconciled without assuming an external effect failed         | A restarted worker repeats an unknown provider action            |

Use Python's local guide for parsing/resources, Go's for error/cancellation and
SQL's for the atomic write/claim. Their syntax differs; the operation's invariant
must not. Keep transport errors distinct from domain rejection and unknown outcome.

A useful first slice implements acceptance, one worker claim and one delivered
terminal result with disposable data when execution is authorized. Compare a
legitimate request, a repeated key, an unsupported version and an interrupted
claim. A mocked queue test alone cannot establish SQL isolation or deployed
worker compatibility. Return the owner map, representative envelope, recovery
behavior and missing evidence before a broader migration.
