# Recovery consent fixture — 5 October 2026

The independent Background/Overnight process test previously updated a settings
row created by an earlier test. Running only this test updated zero rows and
Overnight failed before reaching the provider. Fixture diagnostics confirmed
Background reached its blocked provider while Overnight was already failed.

The test now upserts its own enabled UTC Overnight consent using the existing
default kinds and morning-review setting, and asserts that one row was returned.
No production behavior, deadline, polling interval, capacity or completion
assertion changed. Temporary request-marker diagnostics were removed.

Evidence:

- Prior isolated lane test failed: /tmp/orbyn-515e8959-lanes-only.log.
- Diagnostic consent failure: /tmp/orbyn-515e8959-lanes-diagnostic.log.
- Corrected isolated lane test passed1/1: /tmp/orbyn-lanes-owned-consent.log.
- Corrected recovery cohort passed13/13,0 failures/skips, terminal exit0:
  /tmp/orbyn-recovery-lock-diagnostic.log.

This fixture correction does not explain all earlier timing failures. The first
corrected cohort still timed out on invite review, retained in
/tmp/orbyn-recovery-owned-consent-cohort.log. The subsequent same-source cohort
passed with the unchanged deadline; query sampling did not establish a long lock
or query as its cause. Preserve the initial full result (2839 pass,2 failures)
and require fresh exact committed-head full local and CI qualification before
promotion. A green focused retry is not full qualification.
