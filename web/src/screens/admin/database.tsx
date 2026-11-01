import { useState } from "react";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, Field, SelectBox } from "../../ui/kit";
import { Facts, ReadState, Section, useRead } from "./shared";
import { DatabaseRows } from "./database-rows";
export function Database() {
  const tables = useRead(() => client.adminDatabaseTables()),
    [name, setName] = useState("");
  return (
    <Section title="Database inspection">
      <p>
        Read-only schema and masked rows. Account and team editing stays in
        their authorized management screens.
      </p>
      <div className="admin-actions">
        <Button onClick={() => navigate("/app/admin/users")}>
          Manage account fields
        </Button>
        <Button onClick={() => navigate("/app/admin/teams")}>
          Manage team names
        </Button>
      </div>
      <ReadState read={tables}>
        <Field label="Table">
          <SelectBox value={name} onChange={(e) => setName(e.target.value)}>
            <option value="">Choose a table</option>
            {tables.data?.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} · {t.size}
              </option>
            ))}
          </SelectBox>
        </Field>
        {name && <Table key={name} name={name} />}
      </ReadState>
    </Section>
  );
}
function Table({ name }: { name: string }) {
  const [offset, setOffset] = useState(0),
    detail = useRead(() => client.adminDatabaseTable(name), [name]),
    rows = useRead(
      () => client.adminDatabaseRows(name, offset),
      [name, offset],
    );
  return (
    <>
      <ReadState read={detail}>
        <Facts value={detail.data} />
      </ReadState>
      <h3>Masked row data</h3>
      <ReadState read={rows}>
        {rows.data && (
          <DatabaseRows
            rows={rows.data.rows}
            columns={detail.data?.columns ?? []}
            offset={rows.data.offset}
          />
        )}
        <div className="admin-actions">
          <Button
            disabled={offset === 0 || rows.loading}
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            Previous rows
          </Button>
          <span>Offset {offset}</span>
          <Button
            disabled={!rows.data?.has_more || offset >= 10000 || rows.loading}
            onClick={() => setOffset(Math.min(10000, offset + 25))}
          >
            Next rows
          </Button>
        </div>
      </ReadState>
    </>
  );
}
