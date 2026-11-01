import {
  AGENT_INBOX_KINDS,
  AGENT_INBOX_KIND_LABELS,
  MAX_AGENT_RULES,
  agentRuleInput,
  type AgentInboxKind,
  type AgentRule,
} from "@orbyn/core";
import { useState } from "react";
import { client } from "../../../lib/session";
import { Button, Field, SelectBox, TextArea } from "../../../ui/kit";
import { SettingsSection, useSettingsExit, useSettingsRead } from "../shared";
import { ActionError, ReadState, useConnectionAction } from "./common";
export function AgentRules() {
  const read = useSettingsRead(() => client.agentRules()),
    action = useConnectionAction();
  const [editing, setEditing] = useState<AgentRule | "new" | null>(null),
    [text, setText] = useState(""),
    [kind, setKind] = useState<AgentInboxKind | "">(""),
    [error, setError] = useState("");
  useSettingsExit({ dirty: !!editing });
  return (
    <SettingsSection
      title="Standing rules"
      description="Rules sent to connected agents with their inbox items."
    >
      <ReadState {...read}>
        {read.data?.map((rule) => (
          <div className="settings-row" key={rule.id}>
            <div>
              <p dir="auto">{rule.text}</p>
              <span className="small muted">
                {rule.kind
                  ? AGENT_INBOX_KIND_LABELS[rule.kind].name
                  : "Everything"}
              </span>
            </div>
            <Button
              disabled={action.blocked || !!editing || !read.fresh}
              onClick={() => {
                setEditing(rule);
                setText(rule.text);
                setKind(rule.kind ?? "");
              }}
            >
              Edit
            </Button>
            <Button
              disabled={action.blocked || !read.fresh}
              onClick={() =>
                void action.run(
                  () => client.deleteAgentRule(rule.id),
                  () => read.commit(read.data!.filter((r) => r.id !== rule.id)),
                  {
                    title: "Remove rule?",
                    body: rule.text,
                    action: "Remove",
                    danger: true,
                  },
                )
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </ReadState>
      {!editing ? (
        <Button
          disabled={
            !read.fresh ||
            action.blocked ||
            (read.data?.length ?? 0) >= MAX_AGENT_RULES
          }
          onClick={() => {
            setEditing("new");
            setText("");
            setKind("");
          }}
        >
          Add rule
        </Button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const input = agentRuleInput.safeParse({
              kind: kind || null,
              text,
            });
            if (!input.success) {
              setError(input.error.issues.map((i) => i.message).join(" "));
              return;
            }
            const target = editing;
            void action.run(
              () =>
                target === "new"
                  ? client.addAgentRule(input.data)
                  : client.updateAgentRule(target.id, input.data),
              () => {
                setEditing(null);
                setText("");
                void read.reload();
              },
            );
          }}
        >
          <Field label="Applies to">
            <SelectBox
              value={kind}
              disabled={action.blocked}
              onChange={(e) => setKind(e.target.value as AgentInboxKind | "")}
            >
              <option value="">Everything</option>
              {AGENT_INBOX_KINDS.map((k) => (
                <option key={k} value={k}>
                  {AGENT_INBOX_KIND_LABELS[k].name}
                </option>
              ))}
            </SelectBox>
          </Field>
          <Field label="Rule">
            <TextArea
              required
              value={text}
              maxLength={500}
              disabled={action.blocked}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <div className="settings-actions">
            <Button type="submit" disabled={action.blocked}>
              Save rule
            </Button>
            <Button
              disabled={action.blocked}
              onClick={() => {
                setEditing(null);
                setText("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <ActionError action={action} />
    </SettingsSection>
  );
}
