# Technology decision record

Use project-owned documentation, not a new mandatory directory or public export.
Keep company requirements and operational data in that consuming repository.

- Decision, owner, date and requested scope (research / spike / implementation).
- User outcome and current system/version/deployment baseline.
- Hard constraints with evidence; assumptions that would change the choice.
- Candidate set, including the existing/default path; disqualifications first.

| Criterion                          | Existing/default | Alternative A | Alternative B | Evidence / confidence |
| ---------------------------------- | ---------------- | ------------- | ------------- | --------------------- |
| Target/platform and integration    |                  |               |               |                       |
| Data consistency and recovery      |                  |               |               |                       |
| Team delivery and maintenance      |                  |               |               |                       |
| Measured workload / performance    |                  |               |               |                       |
| Whole operating cost / support     |                  |               |               |                       |
| License, trust and data boundaries |                  |               |               |                       |
| Migration, portability and exit    |                  |               |               |                       |

Mark unneeded rows/options inapplicable. Record unknown values instead of invented
numbers. Capture source versions/dates; vendor list price is not an observed bill
or an end-to-end benchmark. An option failing a hard constraint cannot win by score.

- Recommendation and why the evidence supports it.
- Alternative rejected, condition that would reverse the choice and fallback.
- Authorized observation/spike: acceptance criterion, fixture, version and result;
  missing provider/platform/production evidence remains unverified.
- Now: smallest delivery and owners.
- Next: operations, capacity, support/security updates and recovery.
- Later: migration cost, compatibility/exit path and measurable revisit trigger.
- Handoff and actual delivery state. Research-only ends here for human review.
