import type { AdminDatabaseColumn } from "@orbyn/core";

const MASKED = "••••";
const CREDENTIAL =
  /(?:^|_)(?:(?:password|passwd|secret|credentials?|token|api_key|private_key|session)(?:_hash|_encrypted)?|authorization|key_hash|secret_key)$/i;

/** Database row values are already authorized and masked by the server. */
function safeCell(column: string, value: unknown): string {
  if (value === MASKED) return MASKED;
  if (value === null) return "Empty (null)";
  if (CREDENTIAL.test(column)) return MASKED;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return MASKED;
}

/** Preserve every schema column and extra returned key without generic secret omission. */
export function DatabaseRows({
  rows,
  columns,
  offset,
}: {
  rows: Record<string, unknown>[];
  columns: AdminDatabaseColumn[];
  offset: number;
}) {
  return (
    <div className="admin-facts-list">
      {rows.length ? (
        rows.map((row, index) => {
          const keys = [
            ...new Set([
              ...columns.map((column) => column.name),
              ...Object.keys(row),
            ]),
          ];
          return (
            <details key={offset + index}>
              <summary>Record {offset + index + 1}</summary>
              <dl className="admin-facts">
                {keys.map((key) => (
                  <div key={key}>
                    <dt dir="auto" className="admin-prose">
                      {key}
                    </dt>
                    <dd dir="auto">
                      {Object.hasOwn(row, key) ? (
                        <span>{safeCell(key, row[key])}</span>
                      ) : (
                        <span className="muted">Not returned</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          );
        })
      ) : (
        <p className="muted">No rows on this page.</p>
      )}
    </div>
  );
}
