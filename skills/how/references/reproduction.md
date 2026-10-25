# Reproduction and reduction

Produce the smallest safe observation that distinguishes the reported defect
from the expected contract. This method works from local inputs; network, live
providers and native environments remain separate capabilities. A reproduction
request ends with evidence and gaps; an authorized repair continues to the fix.

## Pin what changes the result

Capture the target repository/revision and dirty patch, entry point, relevant
runtime/tool versions, build mode, flags, platform, fixture/seed and material
timing or concurrency. Identify expected behavior from the actual contract,
maintained test or agreed requirement. Separate the user's report, source-derived
explanation and directly observed output. Redact credentials and private payloads;
use synthetic data when it preserves the failing contract.

Locate the target's supported runner from manifests, configuration and contribution
guidance. Confirm what the command actually selects: a successful exit with zero
tests, a skipped variant or an unmatched name is not a passing regression. Record
selected test IDs/counts and mode where available. A browser reproducer does not
prove a core framework test or native renderer behaves the same way.

## Reduce without changing the defect

1. Start with the closest authorized reproducer. Record command/steps, inputs,
   expected result, actual result and exit/discovery evidence. Do not replay a
   destructive write, production incident or paid call simply to count attempts.
2. Remove unrelated dependencies, UI and data one factor at a time. After each
   meaningful reduction, confirm the symptom still occurs in a safe disposable
   scope. Preserve the last useful case if a reduction loses the failure.
3. Vary a discriminating factor suggested by source: order, identity, cancellation,
   build mode, feature flag or platform. Keep other material inputs fixed.
   A change in symptom narrows a hypothesis; it does not by itself prove causation.
4. For intermittent behavior, report attempts, failures and conditions rather than
   claiming determinism. If repetition is unsafe or excluded, say why and retain
   the observed instance. A timeout may identify an environment failure rather
   than the reported product defect; diagnose the distinction.

## Choose the oracle before the fix

State the observable assertion and owning boundary. For an authorized regression,
use [TDD evidence](../../tdd/SKILL.md): fail on the baseline for the intended
behavior, then pass on the candidate with the same meaningful inputs and runner.
An import error, missing service, skipped test or changed assertion is not the
desired baseline failure. Keep controls for a nearby valid input or relevant mode
when they distinguish the defect. Use the project's existing test style and only
the environments allowed by the task.

If the baseline cannot be run, preserve the practical reason and obtain the
closest authorized source/fixture evidence. A new test passing only after the
patch is useful but weaker than a demonstrated regression. Do not invent the
missing baseline run or broaden runtime, test or publication authority to get it.

## Return a usable result

Give the revision/environment, minimal fixture or steps, expected/actual result,
execution/discovery evidence, safe repeatability and remaining limits. Attach a
small reproducer in the existing issue/PR artifact when authorized; raw captures
stay under the target's retention policy. Hand the supported hypothesis and oracle
to [bug fixing](../../orbyn-workflow/playbooks/bug-fix.md), or stop at the requested
reproduction. The [worked examples](../../orbyn-workflow/references/contribution-examples.md)
show source-only, runner-selection and intermittent cases.
