import { groupAgentActivity, agentJobText, type AgentGrant } from "@orbyn/core";
import { useState } from "react";
import { client } from "../../../lib/session";
import { Button, Input } from "../../../ui/kit";
import { useSettingsRead } from "../shared";
import { ActionError, ReadState, useConnectionAction } from "./common";
export function AgentActivity({ grant }: { grant: AgentGrant }) {
  const read = useSettingsRead(
      () => client.agentActivity(grant.id),
      [grant.id],
    ),
    action = useConnectionAction();
  const [query, setQuery] = useState(""),
    [limit, setLimit] = useState(20),
    [result, setResult] = useState("");
  const jobs = groupAgentActivity(read.data ?? []).filter((j) =>
    j.rows.some((r) =>
      `${r.tool} ${r.summary} ${r.outcome}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    ),
  );
  return (
    <div className="settings-form">
      <Input
        aria-label="Find agent activity"
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(20);
        }}
      />
      <ReadState {...read}>
        {jobs.slice(0, limit).map((j) => (
          <details key={j.id}>
            <summary>
              {agentJobText(grant.client_name || grant.name, j.kinds)} ·{" "}
              {new Date(j.at).toLocaleString()}
            </summary>
            {j.job && j.undoable && (
              <Button
                disabled={!read.fresh || action.blocked}
                onClick={() =>
                  void action.run(
                    () => client.undoAgentJob(grant.id, j.job!),
                    (receipt) => {
                      setResult(`Undid ${receipt.undone} changes.`);
                      void read.reload();
                    },
                    {
                      title: "Undo this whole job?",
                      body: "If anything changed since, nothing is undone.",
                      action: "Undo job",
                      danger: true,
                    },
                  )
                }
              >
                Undo job
              </Button>
            )}
            {j.rows.map((row) => (
              <div key={row.id} className="settings-connections-activity">
                <p dir="auto">{row.summary}</p>
                <p className="small muted">
                  {row.tool} · {row.outcome} · {row.calls} calls{" "}
                  {row.undone_at && "· Undone"}{" "}
                  {row.undo_until &&
                    `· Undo until ${new Date(row.undo_until).toLocaleString()}`}
                </p>
                <div className="settings-actions">
                  {row.links?.map((link) => (
                    <a
                      key={`${link.kind}:${link.id}`}
                      href={
                        link.kind === "doc"
                          ? `/app/doc/${encodeURIComponent(link.id)}`
                          : link.kind === "project"
                            ? `/app/project/${encodeURIComponent(link.id)}`
                            : `/app/task/${encodeURIComponent(link.id)}`
                      }
                      dir="auto"
                    >
                      {link.title}
                    </a>
                  ))}
                  {row.proposal_id && (
                    <a
                      href={`/app/review/${encodeURIComponent(row.proposal_id)}`}
                    >
                      Review proposal
                    </a>
                  )}
                  {row.undoable && (
                    <Button
                      disabled={!read.fresh || action.blocked}
                      onClick={() =>
                        void action.run(
                          () => client.undoAgentChange(row.id),
                          (receipt) => {
                            setResult(receipt.summary);
                            void read.reload();
                          },
                          {
                            title: "Undo this change?",
                            body: "If the object changed since, it stays as it is.",
                            action: "Undo",
                            danger: true,
                          },
                        )
                      }
                    >
                      Undo
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </details>
        ))}
        {read.data && !jobs.length && (
          <p className="muted">No matching activity.</p>
        )}
        {jobs.length > limit && (
          <Button onClick={() => setLimit((old) => old + 20)}>Show more</Button>
        )}
      </ReadState>
      {result && <p role="status">{result}</p>}
      <ActionError action={action} />
    </div>
  );
}
