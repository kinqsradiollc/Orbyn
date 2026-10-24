# Select the relevant trust boundaries

Map these checks to actual source paths and actors. They are hypothesis prompts,
not a checklist whose omissions automatically count as vulnerabilities. Inspect
controls along the full reachable path and report absent source facts as unknown.

| Boundary | Questions to resolve |
| --- | --- |
| Identity and resource authority | Does the effect use the current principal and resource membership? Can a client-supplied identity, stale approval or missing object check cross another user’s boundary? |
| Parsing, protocols and browser input | Do routing, decoding, framing, canonicalization, rendering and origin checks agree? Trace the same input through every relevant interpretation. |
| Domain state and durable writes | Are version/state transitions atomic where needed? Can retries, races, cache keys or stale workers apply an unintended effect or mix tenant data? |
| Files, native clients and local IPC | Are paths, links, exported handlers, deep links and helper calls constrained to the caller’s authority? Do not infer native behavior from browser code alone. |
| AI and tool effects | Can lower-trust content alter tool authority, select another principal’s resources, expose secrets or turn model output into an unchecked effect? Distinguish untrusted data from instructions. |
| Jobs, queues and external providers | Who owns leases, retries, cancellation and terminal results? Can duplicate delivery or an unknown outcome bypass an invariant? Provider/deployment behavior needs actual evidence. |
| Build, release and deployment | Which untrusted events can reach tokens, signing, dependency resolution, release artifacts or infrastructure changes? Inspect source policy and require missing live configuration as evidence. |
| Resource and data lifecycle | Are quotas, shared work, exports, retention, deletion, restore and cache/search isolation enforced at the real owner? Bound local availability checks and never stress a shared/live service. |
| Native memory and binary boundaries | Where unsafe operations or parsers exist, trace size/lifetime/ownership and reachable attacker inputs. Missing local tooling limits execution claims; do not invent sanitizer results. |

Select checks by the target’s stack, exposed surfaces and requested scope. Record
why other classes are inapplicable, blocked or deferred. A finding needs a real
crossed boundary and consequence; recommend hardening separately when an existing
control already prevents the hypothesized effect.
