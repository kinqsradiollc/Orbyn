import {
  WEBHOOK_EVENTS,
  webhookInput,
  type Webhook,
  type NewWebhook,
  type WebhookEvent,
} from "@orbyn/core";
import { useState } from "react";
import { client } from "../../../lib/session";
import { Button, Field, Input } from "../../../ui/kit";
import { SettingsSection, useSettingsExit, useSettingsRead } from "../shared";
import {
  ActionError,
  ReadState,
  Secret,
  checkedSecret,
  receiptId,
  useConnectionAction,
} from "./common";
export function Webhooks() {
  const read = useSettingsRead(() => client.listWebhooks()),
    action = useConnectionAction();
  const [editing, setEditing] = useState<Webhook | "new" | null>(null),
    [url, setUrl] = useState(""),
    [events, setEvents] = useState<WebhookEvent[]>([]),
    [lead, setLead] = useState(10),
    [secret, setSecret] = useState(""),
    [result, setResult] = useState(""),
    [query, setQuery] = useState("");
  useSettingsExit({ dirty: editing !== null });
  const open = (value: Webhook | "new") => {
    setEditing(value);
    setUrl(value === "new" ? "" : value.url);
    setEvents(value === "new" ? [] : value.events);
    setLead(value === "new" ? 10 : (value.lead_minutes ?? 10));
  };
  return (
    <SettingsSection
      title="Webhooks"
      description="Send selected events to your own endpoint."
    >
      <Input
        aria-label="Find webhooks"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ReadState {...read}>
        {read.data
          ?.filter((h) =>
            h.url.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          )
          .map((h) => (
            <div className="settings-row" key={h.id}>
              <div>
                <strong dir="auto">{h.url}</strong>
                <p className="small muted">
                  {h.active ? "On" : "Off"} · {h.events.join(", ")} ·{" "}
                  {h.last_status ?? "No delivery"} {h.last_error}
                </p>
              </div>
              <div className="settings-actions">
                <Button
                  disabled={
                    action.blocked ||
                    !!secret ||
                    editing !== null ||
                    !read.fresh
                  }
                  onClick={() => open(h)}
                >
                  Edit
                </Button>
                <Button
                  disabled={action.blocked || !!secret || !read.fresh}
                  onClick={() =>
                    void action.run(
                      () => client.updateWebhook(h.id, { active: !h.active }),
                      (next) =>
                        read.commit(
                          read.data!.map((x) => (x.id === next.id ? next : x)),
                        ),
                    )
                  }
                >
                  {h.active ? "Turn off" : "Turn on"}
                </Button>
                <Button
                  disabled={action.blocked || !read.fresh}
                  onClick={() =>
                    void action.run(
                      () => client.testWebhook(h.id),
                      (value) => setResult(JSON.stringify(value)),
                      {
                        title: "Send a webhook test?",
                        body: "This calls the saved endpoint now.",
                        action: "Send test",
                      },
                    )
                  }
                >
                  Test
                </Button>
                <Button
                  variant="danger"
                  disabled={action.blocked || !!secret || !read.fresh}
                  onClick={() =>
                    void action.run(
                      () => client.deleteWebhook(h.id),
                      () =>
                        read.commit(read.data!.filter((x) => x.id !== h.id)),
                      {
                        title: "Delete webhook?",
                        action: "Delete",
                        danger: true,
                      },
                    )
                  }
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
      </ReadState>
      {secret && (
        <Secret
          label="Signing secret"
          value={secret}
          onDone={() => setSecret("")}
        />
      )}
      {!editing && (
        <Button
          disabled={!read.fresh || action.blocked || !!secret}
          onClick={() => open("new")}
        >
          Add webhook
        </Button>
      )}
      {editing && (
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = webhookInput.safeParse({
              url: url.trim(),
              events,
              lead_minutes: lead,
            });
            if (!parsed.success) {
              setResult(parsed.error.issues.map((i) => i.message).join(" "));
              return;
            }
            const target = editing;
            void action.run<Webhook | NewWebhook>(
              () =>
                target === "new"
                  ? client.createWebhook(parsed.data)
                  : client.updateWebhook(target.id, parsed.data),
              (next) => {
                if (target === "new") {
                  const key = checkedSecret(
                    "secret" in next ? next.secret : undefined,
                    "whsec_",
                  );
                  if (
                    !receiptId(next.id) ||
                    next.url !== parsed.data.url ||
                    read.data?.some((old) => old.id === next.id)
                  )
                    throw Error(
                      "The webhook receipt does not match this endpoint. This attempt remains unconfirmed.",
                    );
                  setSecret(key);
                }
                setEditing(null);
                void read.reload();
              },
            );
          }}
        >
          <fieldset disabled={action.blocked}>
            <Field label="Endpoint URL">
              <Input
                required
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
            <legend>Events</legend>
            {WEBHOOK_EVENTS.map((value) => (
              <label className="check" key={value}>
                <input
                  type="checkbox"
                  checked={events.includes(value)}
                  onChange={(e) =>
                    setEvents((old) =>
                      e.target.checked
                        ? [...old, value]
                        : old.filter((x) => x !== value),
                    )
                  }
                />
                {value.replaceAll(".", " · ")}
              </label>
            ))}
            {events.includes("event.starting") && (
              <Field label="Minutes before event">
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={lead}
                  onChange={(e) => setLead(Number(e.target.value))}
                />
              </Field>
            )}
          </fieldset>
          <Button type="submit" disabled={action.blocked}>
            {editing === "new" ? "Create webhook" : "Save webhook"}
          </Button>
          <Button
            disabled={action.blocked}
            onClick={() => {
              setEditing(null);
              setUrl("");
            }}
          >
            Cancel changes
          </Button>
        </form>
      )}
      {result && (
        <p className="small" role="status">
          {result}
        </p>
      )}
      <ActionError action={action} />
    </SettingsSection>
  );
}
