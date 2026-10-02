# Security scan status — 2 October 2026

## Evidence and scope

The main dependency manifest/lock state through `23019ff` is unchanged by the
Docs and mobile export checkpoint. The workspace production dependency audit
(`npm audit --omit=dev --json`) reported 22 dependency nodes: nine high and
13 moderate, zero critical. This includes Expo/native build tooling classified
as production dependencies; it does not establish 22 exploitable backend flaws.
Evidence: `/tmp/orbyn-production-dependency-audit.json`.

The GitHub push to main separately reported 62 default-branch dependency alerts
(36 high, 25 moderate, one low). That server graph has a different scope from
this workspace audit. It is not a count of failed local tests.

A read of the repository code-scanning alerts API returned HTTP 404, “no analysis
found,” and a missing `admin:repo_hook` scope notice. This establishes no
accessible scan result, not a clean scan or absence of vulnerabilities. The token
scope was not expanded. Evidence: `/tmp/orbyn-code-scanning-error.log`.
The repository currently contains CI and deployment workflows, with no dedicated
CodeQL/security scan workflow found in the inventory.

## Required next work

1. Deduplicate advisory nodes and classify installed paths by backend runtime,
   client runtime and native/build tools before selecting upgrades.
2. Prioritize the direct backend PDF import path (`backend/src/modules/imports/pdf.ts`)
   and its `pdfjs-dist` dependency. It parses uploaded PDF data with the library's
   `getDocument`; the inspected call does not explicitly disable JavaScript
   evaluation. The audit marks the installed range against
   [GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j).
   Confirm the affected behavior, assess the supported upgrade and test PDF import
   compatibility; this source inspection is not an exploit reproduction.
3. Assess Fastify/URI parsing and transitive XML, certificate and expansion
   advisories in their actual consumers. Do not apply suggested Expo/React Native
   major-version changes or downgrades as an automatic release repair.
4. Establish authorized scan access and a supported CI scan. Preserve protected
   secrets and human review of scan-generated patches. Dependency audit, typecheck,
   full tests and Docker builds do not replace this A10 scan gate.
5. Run focused regressions, full tests and relevant web/native build and interaction
   checks for chosen upgrades. Record the final lock and image revisions.

No dependency upgrade, exploit claim or completed security scan is included in
this status checkpoint. A10 remains incomplete in the governing ADR.
