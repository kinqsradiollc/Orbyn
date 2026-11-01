import { type ApiKey, type ClipKey } from "@orbyn/core";
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
export function Credentials({ clip = false }: { clip?: boolean }) {
  const read = useSettingsRead<Array<ApiKey | ClipKey>>(async () =>
    clip ? client.listClipKeys() : client.listApiKeys(),
  );
  const action = useConnectionAction();
  const [name, setName] = useState(clip ? "Orbyn Clipper" : ""),
    [query, setQuery] = useState(""),
    [secret, setSecret] = useState("");
  useSettingsExit({
    dirty: !!name.trim() && (!clip || name !== "Orbyn Clipper"),
  });
  return (
    <SettingsSection
      title={clip ? "Orbyn Clipper" : "Personal API keys"}
      description={
        clip
          ? "Save browser pages with a key that cannot read your pages."
          : "Use a separate key for each app. Revoking it stops that app."
      }
    >
      <ReadState {...read}>
        {read.data && (
          <>
            <Field label="Find keys">
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
            {read.data
              .filter((k) =>
                k.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
              )
              .map((k) => (
                <div className="settings-row" key={k.id}>
                  <div>
                    <strong dir="auto">{k.name}</strong>
                    <p className="small muted">
                      {"prefix" in k ? k.prefix : k.hint} · created{" "}
                      {new Date(k.created_at).toLocaleString()} · last used{" "}
                      {k.last_used_at
                        ? new Date(k.last_used_at).toLocaleString()
                        : "Never"}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    disabled={action.blocked || !!secret || !read.fresh}
                    onClick={() =>
                      void action.run(
                        () =>
                          clip
                            ? client.deleteClipKey(k.id)
                            : client.deleteApiKey(k.id),
                        () => {
                          read.commit(read.data!.filter((x) => x.id !== k.id));
                        },
                        {
                          title: "Revoke this key?",
                          body: `${k.name} stops working immediately.`,
                          action: "Revoke key",
                          danger: true,
                        },
                      )
                    }
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            {!read.data.length && <p className="muted">No keys yet.</p>}
          </>
        )}
      </ReadState>
      {secret ? (
        <Secret value={secret} onDone={() => setSecret("")} />
      ) : (
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(
              async () =>
                clip
                  ? client.createClipKey(name.trim())
                  : client.createApiKey(name.trim()),
              (value) => {
                const key = checkedSecret(value.key, clip ? "ocl_" : "ok_");
                const row = "clip_key" in value ? value.clip_key : value;
                if (
                  !receiptId(row.id) ||
                  row.name !== name.trim() ||
                  read.data?.some((old) => old.id === row.id)
                )
                  throw Error(
                    "The key receipt does not match this new connection. Check saved keys; this attempt will not be repeated.",
                  );
                setSecret(key);
                setName("");
                void read.reload();
              },
            );
          }}
        >
          <Field label="Key name">
            <Input
              required
              maxLength={clip ? 60 : 80}
              value={name}
              disabled={action.blocked}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            disabled={!read.fresh || action.blocked || !name.trim()}
          >
            Create key
          </Button>
        </form>
      )}
      <ActionError action={action} />
    </SettingsSection>
  );
}
