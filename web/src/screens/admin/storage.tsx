import { useEffect, useState } from "react";
import { client } from "../../lib/session";
import { Button, Field, Input } from "../../ui/kit";
import {
  Facts,
  Outcome,
  ReadState,
  Section,
  useOperation,
  useRead,
} from "./shared";
export function Storage() {
  const read = useRead(() => client.adminStorage()),
    op = useOperation(),
    [live, setLive] = useState(false),
    [query, setQuery] = useState(""),
    [removed, setRemoved] = useState<number | null>(null);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !read.loading &&
        !op.blocked
      )
        void read.reload();
    }, 15000);
    return () => clearInterval(t);
  }, [live, read.loading, op.blocked]);
  return (
    <Section title="Storage and import operations">
      <label>
        <input
          type="checkbox"
          checked={live}
          onChange={(e) => setLive(e.target.checked)}
        />
        Refresh visible view every fifteen seconds
      </label>
      <Button disabled={read.loading} onClick={() => void read.reload()}>
        Refresh storage
      </Button>
      <ReadState read={read}>
        {read.data && (
          <>
            <Facts
              value={{
                database: read.data.database,
                files: read.data.files,
                originals: read.data.originals,
                reading: read.data.reading,
                queue: read.data.queue,
              }}
            />
            <h3>Stored uploads</h3>
            <Field label="Find stored upload">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            {read.data.stored
              .filter((f) =>
                `${f.file_name} ${f.owner_email}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((f) => (
                <div className="admin-row" key={f.import_id}>
                  <Facts value={f} />
                  <Button
                    variant="danger"
                    disabled={op.blocked}
                    onClick={() =>
                      void op.run(
                        () => client.adminDeleteStoredFile(f.import_id),
                        () => void read.reload(),
                        {
                          title: "Delete this stored upload?",
                          body: `Delete ${f.file_name} owned by ${f.owner_email}. Its import is cancelled.`,
                          action: "Delete upload",
                          danger: true,
                        },
                      )
                    }
                  >
                    Delete upload
                  </Button>
                </div>
              ))}
            <h3>Recent imports</h3>
            <Facts value={read.data.history} />
          </>
        )}
      </ReadState>
      <Button
        disabled={op.blocked}
        onClick={() =>
          void op.run(
            () => client.adminSweepStorage(),
            (r) => {
              if (!Number.isFinite(r.removed))
                throw new Error("Sweep receipt is incomplete.");
              setRemoved(r.removed);
              void read.reload();
            },
            {
              title: "Sweep expired stored files?",
              body: "Runs the existing storage retention sweep now.",
              action: "Run storage sweep",
              danger: true,
            },
          )
        }
      >
        Sweep storage now
      </Button>
      {removed !== null && <p role="status">Removed {removed} stored files.</p>}
      <Outcome op={op} />
    </Section>
  );
}
