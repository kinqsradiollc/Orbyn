# REA guidance sources and compatibility

These maintained local methods adapt REA's MIT-licensed investigation and
development guidance. Copyright (c) 2026 morluto; local adaptations by Anh Dang
and Orbyn contributors. Every affected skill retains its own portable `LICENSE`,
including the [REA and local MIT notices](../LICENSE) beside this investigation
skill. The source relationship and immutable revisions needed for an offline
skills-only import are recorded here. A full library clone additionally carries
root-level `provenance.json` and `tools/THIRD_PARTY_NOTICES.md`; those files are
optional library metadata, not dependencies of the imported method.

The links below are attribution and update pointers. They are not required
reading to execute the local method, and no remote text is fetched on install,
discovery or validation. This change does not bundle a complete upstream manual,
runtime, binary, dependency tree or new upstream skill entrypoint.

| Role | Immutable revision | Meaning |
| --- | --- | --- |
| Original five adapter sources | [`ccc7da309d7db385d5c6d73b0a3a8e093be33504`](https://github.com/morluto/rea/tree/ccc7da309d7db385d5c6d73b0a3a8e093be33504/.agents/skills) | Historical source lineage remains unchanged; the consuming Orbyn engine snapshot remains here. |
| Later guidance reviewed on 2026-10-24 | [`2250e67bc271c83f9e200ee298aa04a2457438a6`](https://github.com/morluto/rea/tree/2250e67bc271c83f9e200ee298aa04a2457438a6/.agents/skills/reverse-engineer-anything) | Selected recovery, evidence and effect guidance incorporated locally. This is a documentation review revision, not an engine pin. |

The four REA development skill entrypoints are unchanged between those revisions.
The later reverse-engineering entrypoint and six references changed. Both engine
revisions report package version 6.7.0, so that version string cannot establish
which tool contracts are installed.

In the later reviewed contract, function analysis can default to retained
summaries, some artifact formats have additional inspection operations, native
UI values can include numeric/boolean scalars, and environment serving can apply
evidence-gated writes by default. Node requirements also increased. This milestone
does not enable those behaviors, migrate callers or change the engine/runtime
requirements. Discover the installed schema and preserve existing environment
serving behavior; do not invoke a write-capable server as a presumed replay.

Primary technical references reviewed:

- [MCP evidence contracts](https://github.com/morluto/rea/blob/2250e67bc271c83f9e200ee298aa04a2457438a6/docs/mcp-contracts.md)
- [Connection and recovery](https://github.com/morluto/rea/blob/2250e67bc271c83f9e200ee298aa04a2457438a6/.agents/skills/reverse-engineer-anything/references/connection-and-recovery.md)
- [Runtime observation](https://github.com/morluto/rea/blob/2250e67bc271c83f9e200ee298aa04a2457438a6/.agents/skills/reverse-engineer-anything/references/runtime-observation.md)
- [Static JavaScript route inventory](https://github.com/morluto/rea/blob/2250e67bc271c83f9e200ee298aa04a2457438a6/docs/javascript-route-inventory.md)
- [Tool design](https://github.com/morluto/rea/blob/ccc7da309d7db385d5c6d73b0a3a8e093be33504/docs/tool-design.md)

Offline completeness means the operating method and examples are local. Actual
artifact analysis still needs suitable tools and target bytes; optimization and
CI work need source/check access; release attribution needs real REA history.
Missing inputs remain explicit limitations rather than reasons to fabricate facts
or acquire software/network access without scope.
