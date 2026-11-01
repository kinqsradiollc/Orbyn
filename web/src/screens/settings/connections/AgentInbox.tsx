import {
  AGENT_INBOX_KINDS,
  AGENT_INBOX_KIND_LABELS,
  agentWakeInput,
  type AgentInboxKind,
} from "@orbyn/core";
import { useState } from "react";
import { client } from "../../../lib/session";
import { Button, Field, Input } from "../../../ui/kit";
import { useSettingsExit, useSettingsRead } from "../shared";
import {
  ActionError,
  ReadState,
  Secret,
  checkedSecret,
  useConnectionAction,
} from "./common";
export function AgentInbox({ id }: { id: string }) {
  const read = useSettingsRead(() => client.agentInbox(id), [id]),
    action = useConnectionAction();
  const [url, setUrl] = useState(""),
    [secret, setSecret] = useState(""),
    [result, setResult] = useState("");
  useSettingsExit({ dirty: !!url });
  return (
    <div className="settings-form">
      <ReadState {...read}>
        {read.data && (
          <>
            <p>
              {read.data.unread} unread · last wake{" "}
              {read.data.wake_last_sent_at
                ? new Date(read.data.wake_last_sent_at).toLocaleString()
                : "Never"}{" "}
              · {read.data.wake_last_status} {read.data.wake_last_error}
            </p>
            <fieldset disabled={!read.fresh || action.blocked || !!secret}>
              <legend>Send to this agent</legend>
              {AGENT_INBOX_KINDS.map((kind) => (
                <label className="check" key={kind}>
                  <input
                    type="checkbox"
                    checked={!read.data!.muted.includes(kind)}
                    onChange={(e) => {
                      const muted: AgentInboxKind[] = e.target.checked
                        ? read.data!.muted.filter((x) => x !== kind)
                        : [...read.data!.muted, kind];
                      void action.run(
                        () => client.setAgentInboxMutes(id, muted),
                        (next) => read.commit(next),
                      );
                    }}
                  />
                  {AGENT_INBOX_KIND_LABELS[kind].name}
                </label>
              ))}
            </fieldset>
            <p className="small">
              Wake address: {read.data.wake_url ?? "None"}
            </p>
            {read.data.wake_url && (
              <div className="settings-actions">
                <Button
                  disabled={!read.fresh || action.blocked || !!secret}
                  onClick={() =>
                    void action.run(
                      () => client.testAgentWake(id),
                      (next) => {
                        setResult(JSON.stringify(next));
                        void read.reload();
                      },
                      {
                        title: "Test wake-up address?",
                        body: "This calls the saved external address now.",
                        action: "Send test",
                      },
                    )
                  }
                >
                  Test wake-up
                </Button>
                <Button
                  disabled={!read.fresh || action.blocked || !!secret}
                  onClick={() =>
                    void action.run(
                      () => client.clearAgentWake(id),
                      (next) => read.commit(next),
                      {
                        title: "Remove wake-up address?",
                        action: "Remove",
                        danger: true,
                      },
                    )
                  }
                >
                  Remove address
                </Button>
              </div>
            )}
          </>
        )}
      </ReadState>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = agentWakeInput.safeParse({ url: url.trim() });
          if (!input.success) {
            setResult(input.error.issues.map((i) => i.message).join(" "));
            return;
          }
          void action.run(
            () => client.setAgentWake(id, input.data.url),
            (next) => {
              const key = checkedSecret(next.secret, "whsec_");
              if (next.settings?.wake_url !== input.data.url)
                throw Error(
                  "The wake-up receipt does not match this address. This attempt remains unconfirmed.",
                );
              read.commit(next.settings);
              setSecret(key);
              setUrl("");
            },
          );
        }}
      >
        <Field label="New wake-up URL">
          <Input
            type="url"
            required
            value={url}
            disabled={action.blocked || !!secret}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          disabled={!read.fresh || action.blocked || !!secret || !url.trim()}
        >
          Save wake-up address
        </Button>
      </form>
      {secret && (
        <Secret
          value={secret}
          label="Wake signing secret"
          onDone={() => setSecret("")}
        />
      )}
      {result && <p role="status">{result}</p>}
      <ActionError action={action} />
    </div>
  );
}
