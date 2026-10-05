# Maintained page retry clock repair — 5 October 2026

## Cause and change

PostgreSQL retry timestamps retain microseconds. A JavaScript Date supplied by the
production worker has millisecond precision, so an immediate retry can be treated
as future work even after its database timestamp is due. Production retry eligibility
now uses PostgreSQL clock_timestamp(). Explicitly injected clocks still use their
provided timestamp. Retry durations, attempt limits, budgets and polling bounds are
unchanged.

## Evidence

- Baseline ce4895a5 with only the new regression temporarily copied in: 9/10 pass;
  the native-clock assertion fails. The original test file was restored afterward.
  Log: /tmp/orbyn-ce-clock-baseline.log.
- Current repaired source, isolated marked test database: 31/31 pass, zero failures
  or skips across maintained-page-private, maintained-page-runs and the pending
  scheduled Agenda runtime suite. Log: /tmp/orbyn-agenda-scheduled-and-clock-clean-db.log.
- CI37263198527 on ce4895a5 failed the original private Overnight resume test with
  “No private page assignment arrived”; the new regression proves the clock defect,
  but exact repaired-head CI is still required to qualify the release.

This scoped repair does not complete scheduled Agenda, real provider inference,
native UI acceptance or the remaining C1–C6/M1/D1/U1 scope. No main promotion or
production deployment is claimed.
