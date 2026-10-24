# Runtime forensics

Use the parent [workflow](../SKILL.md) for ownership and scope. Pin the observed
symptom, timestamp, build/candidate, process identity and environment. Resolve the
actual service, port, configuration and data owner before probing. A process
name or reused PID alone does not establish identity.

Capture the smallest authorized signal that distinguishes hypotheses: request
correlation, relevant phase timing, queue state, resource ownership or a bounded
log slice. Redact credentials and user payloads. Separate “the request was
accepted” from “the durable effect completed” and “the client received its result.”

For a stream that stops after reconnect, compare persisted operation state,
subscription identity and delivered sequence. Change one material factor at a
time. Preserve the original failure and reject explanations contradicted by the
observations. Do not restart a shared service or delete data as an automatic probe.

Use [how](../../how/SKILL.md) to map observations back to source. Return the
supported cause, candidate and signal, competing explanation, correction scope
and smallest missing observation. Remove only owned instrumentation and report
unresolved resource cleanup. Runtime evidence from one build does not qualify a
different candidate or production deployment.
