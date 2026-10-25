# Synthetic example: scoped keyset pagination

The original scenario uses three synthetic tasks with the same creation time and
stable IDs 3, 2 and 1. The chosen order is creation time descending, then ID
descending. A page of two returns 3 and 2; its continuation must return 1 rather
than skipping or repeating a tie.

For PostgreSQL, the next-page predicate compares the complete ordering tuple,
with bound parameters, a tenant predicate and a bounded limit. Another engine
or driver may require different syntax; use its actual semantics. Treat the
cursor as untrusted input and keep query/filter/version meaning explicit.

Encoding a cursor does not grant authority. If access is revoked between pages,
the next request applies current scope checks. Never trust a tenant ID supplied
inside the cursor as the authenticated tenant. Signing a cursor can protect its
integrity but still cannot replace those checks.

State whether this is a changing collection or a snapshot. New inserts before
the continuation point may appear only on refresh; deleted rows may disappear.
If product requirements demand a consistent snapshot, design that contract and
cost explicitly instead of promising it from keyset pagination alone.

Useful authorized checks cover equal sort keys, empty/end pages, malformed or
incompatible cursors, maximum page size and a legitimate versus revoked scope.
Inspect a representative plan in disposable scope before adding indexes. An
EXPLAIN estimate is not measured latency; EXPLAIN ANALYZE executes the query.
No database command or product implementation was run for this example.
