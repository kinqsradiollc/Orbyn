# SQL: contracts to preserve

## Resolve the target

Identify the engine, exact supported version, driver, schema owner and transaction configuration. SQL dialects and isolation implementations are not interchangeable.

## Apply at the affected boundary

- Bind values through the driver; allowlist dynamic identifiers separately. Keep tenant predicates and authorization with the effect and database policy owner.
- Encode durable invariants in appropriate constraints and atomic writes. A read-then-write transaction at a weak isolation level can still race; inspect locks, compare-and-set or serializable retry needs.
- Inspect NULL's three-valued logic, duplicate rows, deterministic ordering and stable pagination ties. Do not assume NOT IN behaves like NOT EXISTS when NULL is possible.
- Choose indexes from actual access paths and representative plans. EXPLAIN ANALYZE executes the statement; use authorized disposable scope for effects. Stored schema/writer transitions belong to the existing migration skill.

## Worked failure and correction

For PostgreSQL, a revision-checked update can express the conflict boundary:

```sql
UPDATE tasks SET title = $1, revision = revision + 1
WHERE id = $2 AND owner_id = $3 AND revision = $4
RETURNING revision;
```

The caller must distinguish no matched row from success under its authorization
policy. This is not a portable placeholder syntax or a full retry protocol.

## Evidence to report

Use the actual engine in a guarded disposable database when tests are authorized. A SQLite fixture does not prove PostgreSQL locking, migration or query-plan behavior.

## Maintainability and checks

Keep schema/query ownership and tenant scope explicit. Choose indexes from actual access patterns, cardinality and representative plans; every added index also affects writes and maintenance. Preserve stable pagination ties, NULL semantics and transaction retry meaning. Inspect estimates separately from executed measurements in disposable authorized scope.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[PostgreSQL 18 isolation](https://www.postgresql.org/docs/18/transaction-iso.html), [PostgreSQL 18 comparison/NULL](https://www.postgresql.org/docs/18/functions-comparisons.html), [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/18/sql-explain.html).
