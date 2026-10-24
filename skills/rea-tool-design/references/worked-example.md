# Worked example: add an inspection without hidden execution

Synthetic design task; no implementation or provider run is implied.

**Request:** Design a tool that returns selected import-table facts for one local
binary. Existing artifact inspection identifies the file but does not expose those
facts. The task is design-only and must not launch the binary.

Propose a distinct static inspection boundary if the nearest operation cannot
express this result coherently. Inputs identify the target and supported selection;
output includes target digest, import identities, source ranges, parse coverage,
limitations and Evidence identity. Unsupported format and malformed bytes have
different typed failures. A missing or truncated table remains unknown unless the
reader established complete coverage for that format.

The file reader owns its handle and closes it on success, rejection and cancellation.
If closing fails after facts were collected, preserve both facts and the unresolved
handle owner. Do not open replacement readers to conceal retained ownership.

A summary view may help a large table, but its result must identify the complete
parent observation. Consumers requiring full facts must have a supported retrieval
path. Retained session IDs must not be presented as portable exported evidence.

**Verification plan:** Known bytes establish expected imports independently;
malformed/truncated input must reject or retain explicit partial coverage. Exercise
cancellation and close failure where the reader changes. Inspect CLI/MCP projection
and generated catalog ownership. None of this authorizes tests or code writes in
a design-only task.
