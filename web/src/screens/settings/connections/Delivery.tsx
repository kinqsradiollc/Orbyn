import { useState } from "react";
import { client } from "../../../lib/session";
import { Button, Field, Input, SelectBox } from "../../../ui/kit";
import { SettingsSection, useSettingsExit, useSettingsRead } from "../shared";
import { ActionError, ReadState, Secret, useConnectionAction } from "./common";
export function EmailDelivery() {
  const read = useSettingsRead(() => client.getInbox()),
    action = useConnectionAction();
  const [fresh, setFresh] = useState("");
  return (
    <SettingsSection
      title="Email to task"
      description="Forward email to your private address to create Inbox tasks."
    >
      <ReadState {...read}>
        {read.data && (
          <>
            <p>
              {read.data.configured
                ? (read.data.address ?? "Off")
                : "Email delivery is not configured on this server."}
            </p>
            <div className="settings-actions">
              <Button
                disabled={
                  !read.fresh ||
                  !read.data.configured ||
                  action.blocked ||
                  !!fresh
                }
                onClick={() =>
                  void action.run(
                    () => client.rotateInbox(),
                    (next) => {
                      read.commit(next);
                      setFresh(next.address ?? "");
                    },
                    read.data?.address
                      ? {
                          title: "Replace email address?",
                          body: "The old address stops accepting tasks.",
                          action: "Replace address",
                        }
                      : undefined,
                  )
                }
              >
                {read.data.address ? "Replace address" : "Create address"}
              </Button>
              {read.data.address && (
                <Button
                  disabled={!read.fresh || action.blocked || !!fresh}
                  onClick={() =>
                    void action.run(
                      () => client.disableInbox(),
                      () => read.commit({ ...read.data!, address: null }),
                      {
                        title: "Disable email to task?",
                        action: "Disable",
                        danger: true,
                      },
                    )
                  }
                >
                  Disable
                </Button>
              )}
            </div>
          </>
        )}
      </ReadState>
      {fresh && (
        <Secret
          value={fresh}
          label="Private email address"
          onDone={() => setFresh("")}
        />
      )}
      <ActionError action={action} />
    </SettingsSection>
  );
}
export function ChatDelivery() {
  const read = useSettingsRead(() => client.getChat()),
    action = useConnectionAction();
  const [kind, setKind] = useState<"slack" | "discord">("slack"),
    [url, setUrl] = useState(""),
    [result, setResult] = useState("");
  useSettingsExit({ dirty: !!url });
  return (
    <SettingsSection
      title="Chat delivery"
      description="Daily digest delivery through a Slack or Discord webhook."
    >
      <ReadState {...read}>
        {read.data && (
          <p>
            {read.data.kind
              ? `Connected to ${read.data.kind}`
              : "Not connected"}
          </p>
        )}
      </ReadState>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(
            () => client.setChat(kind, url.trim()),
            (next) => {
              read.commit(next);
              setUrl("");
            },
          );
        }}
      >
        <Field label="Chat app">
          <SelectBox
            value={kind}
            disabled={action.blocked}
            onChange={(e) => setKind(e.target.value as "slack" | "discord")}
          >
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
          </SelectBox>
        </Field>
        <Field label="Webhook URL">
          <Input
            required
            type="url"
            value={url}
            disabled={action.blocked}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          disabled={!read.fresh || action.blocked || !url.trim()}
        >
          Connect webhook
        </Button>
      </form>
      {read.data?.kind && (
        <div className="settings-actions">
          <Button
            disabled={!read.fresh || action.blocked}
            onClick={() =>
              void action.run(
                () => client.testChat(),
                () => setResult("Test request confirmed."),
                {
                  title: "Send a test message?",
                  body: "This sends a message to the connected chat.",
                  action: "Send test",
                },
              )
            }
          >
            Send test
          </Button>
          <Button
            disabled={!read.fresh || action.blocked}
            onClick={() =>
              void action.run(
                () => client.disableChat(),
                () => read.commit({ kind: null }),
                {
                  title: "Disconnect chat delivery?",
                  action: "Disconnect",
                  danger: true,
                },
              )
            }
          >
            Disconnect
          </Button>
        </div>
      )}
      {result && <p role="status">{result}</p>}
      <ActionError action={action} />
    </SettingsSection>
  );
}
