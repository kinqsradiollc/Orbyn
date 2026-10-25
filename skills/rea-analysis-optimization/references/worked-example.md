# Worked example: smaller output is not faster analysis

Synthetic observations; these numbers illustrate a decision, not a benchmark.

**Request:** Reduce the cost of listing selected native exports in REA. Changes
are allowed, but do not change evidence coverage. A representative artifact and
an empty fixture are supplied; execution needs the project's normal authorization.

A completed baseline takes 4.0 seconds and emits 2 MiB. A projection emits 20 KiB
but still takes 4.0 seconds with the same measured peak memory. It improved delivery
size; it did not demonstrate lower analysis latency or memory. No model-token
measurement was captured, so a token saving remains unmeasured.

The source trace finds that each selected page rescans an already validated export
table. Reusing an index in the retained snapshot owner could remove that work.
Its key must include snapshot identity, with no assumption that a live binary is
unchanged. Check aliases and empty selections against independent fixture facts;
exercise expiry and independently cancelled callers if sharing changes.

A fair comparison includes all pages needed to answer the analyst's question,
setup/discovery calls and cleanup. A candidate that silently omits aliases or
returns a partial prefix has failed the correctness boundary even if faster.

**Offline limit:** With only source and old timing logs, report the suspected
owning cost and a proposed comparison. Do not present those old logs as a fresh
candidate run or install an engine to manufacture measurements.
