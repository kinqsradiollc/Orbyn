/**
 * Match PostgreSQL's canonical UUID text without casting an indexed UUID column
 * to text. Invalid, upper-case and noncanonical references remain unmatched,
 * exactly as they are for `id::text = value`; CASE keeps invalid casts safe.
 * `value` is an application-owned SQL expression, never an untrusted string.
 */
export function canonicalUuidSql(value: string): string {
  return `(CASE WHEN (${value}) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (${value})::uuid END)`;
}
