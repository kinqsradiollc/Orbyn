# Bug fix

The lead owns the diagnosis and corrected contract. Delegate substantial
investigation and implementation under the parent [workflow](../SKILL.md).

1. Capture expected and observed behavior and the closest authorized reproduction.
   Trace the producing boundary with `how`, using `why` for relevant history.
2. Write the throughput checkpoint. Delegate bounded hypotheses or source paths
   to Investigators; keep observations, inference and missing evidence distinct.
3. Select the supported root cause and design the correction. Assign the fix to
   an Engineer with owned files and allowed checks. Use `tdd` only when authorized.
4. Review the diff, affected consumers and recovery behavior. Return concrete
   fixes to the same child and inspect its changes.
5. Perform authorized verification of the corrected contract, using the original
   reproduction when available. Unavailable reproduction remains a limitation.

Small clear fixes stay direct; children implement their assigned fix directly.
Do not broaden runtime access, testing or delivery authority to obtain evidence.
