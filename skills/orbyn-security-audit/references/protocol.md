# Local audit protocol and provenance

The active [Orbyn audit method](../SKILL.md) adapts Cloudflare's source-first audit
approach to consumer ownership, host capabilities, offline use and explicit
authority. Use these local files for detailed procedure; no network fetch is
required:

- [Source workflow and setup](upstream/cloudflare-security-audit/skills/security-audit/SKILL.md).
- [Reconnaissance and coverage](upstream/cloudflare-security-audit/skills/security-audit/RECONNAISSANCE.md).
- [Hunting, deduplication and budget](upstream/cloudflare-security-audit/skills/security-audit/HUNTING.md).
- [Candidate/record validation and reports](upstream/cloudflare-security-audit/skills/security-audit/VALIDATION-AND-REPORTING.md).
- [Threat classes](upstream/cloudflare-security-audit/skills/security-audit/ATTACK-CLASSES.md),
  with companion local files for AI/tool authority, web/auth, client side,
  supply chain, cloud, messaging, resource exhaustion, data lifecycle and local IPC.
- [Findings schema](upstream/cloudflare-security-audit/skills/security-audit/report-schema.json).

The lead must preserve the source contract's structured states, source-bound
coverage, adversarial validation and sandbox requirements. Substitute equivalent
host operations only when they preserve these properties. Do not import automatic
agent creation, arbitrary model escalation, execution permissions, external probes
or upstream manual invocation requirements. If the source protocol cannot be
completed within the actual capabilities/budget, report the exact incomplete state.

Node.js is needed for the bundled zero-dependency validators. From this reference
directory, commands for **already authorized audit artifacts** are:

```sh
node upstream/cloudflare-security-audit/skills/security-audit/validate-findings.cjs /path/to/owned-audit/findings.json
node upstream/cloudflare-security-audit/skills/security-audit/validate-coverage-ledger.cjs /path/to/owned-audit/coverage-ledger.json
```

These validate record structure and consistency. They do not establish a real
vulnerability, source truth, independence or runtime exploitability. The fixture
test files exercise the validators, not a consuming application's security.

Source: Cloudflare, Inc., revision
`c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`, retrieved 24 October 2026.
The original [MIT license](upstream/cloudflare-security-audit/LICENSE) retains
Copyright (c) 2025-2026 Cloudflare, Inc. The
[snapshot](upstream/cloudflare-security-audit/snapshot.json) records every imported
file/hash. This is an adaptation with credit, not a claim of Cloudflare endorsement.
The public library's `openSrc/` archive preserves the complete source checkout
without Git history; consuming projects receive the portable reference bundle.
