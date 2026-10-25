# Trace forensics

Use the parent [workflow](../SKILL.md). Identify the supplied capture, producer,
source/build revision, clock, interval, sampling rate and dropped/truncated data.
Inspect aggregate phases before individual spans; keep the original capture
unchanged and derived reports in separate owned output.

For each material hotspot, distinguish inclusive time, self time, blocking,
scheduling delay and repeated work where the capture supports those distinctions.
Correlate events only with evidence of shared identity and ordering. Missing
samples are not proof that a phase never ran, and a long parent span does not
prove its own code consumed CPU.

Map a hot path to source only when symbols and revisions match. For an export,
separate queue delay, browser startup, render and serialization before proposing
an optimization. If the trace excludes startup, do not report whole-export latency.

Return the bounded diagnosis, supporting spans/summary, capture limitations and
next observation that could change the conclusion. Hand a measured improvement
to the [performance playbook](perf-issue.md). A captured profile is not a benchmark
comparison or permission to collect unrelated live telemetry.
