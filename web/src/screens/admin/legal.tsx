import { useEffect, useRef, useState } from "react";
import {
  legalSettingsUpdate,
  type LegalAdminView,
  type LegalDoc,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input, TextArea } from "../../ui/kit";
import {
  Facts,
  requireMatch,
  Outcome,
  ReadState,
  Section,
  useExit,
  useOperation,
  useRead,
} from "./shared";
export function Legal() {
  const read = useRead(() => client.adminLegal());
  const view = read.data;
  function saved(receipt: LegalAdminView) {
    if (
      !receipt.settings ||
      ![
        receipt.settings.company,
        receipt.settings.contact_email,
        receipt.settings.jurisdiction,
        receipt.settings.processors,
      ].every((value) => typeof value === "string") ||
      !(["terms", "privacy"] as const).every((doc) => {
        const value = receipt.settings[doc];
        return (
          value &&
          typeof value.version === "string" &&
          (value.body === null || typeof value.body === "string") &&
          typeof receipt.defaults?.[doc] === "string"
        );
      })
    )
      throw new Error("Legal receipt is incomplete. Keep the current drafts.");
    read.commit(receipt);
  }
  return (
    <Section title="Legal documents and operator">
      <ReadState read={read}>
        {view && (
          <>
            <Facts
              value={{
                missing: view.missing,
                accepted_current: view.accepted_current,
                users: view.users,
                analytics_opted_out: view.analytics_opted_out,
              }}
            />
            <Operator data={view} onSaved={saved} />
            {(["terms", "privacy"] as const).map((doc) => (
              <Document key={doc} doc={doc} data={view} onSaved={saved} />
            ))}
          </>
        )}
      </ReadState>
    </Section>
  );
}
function Operator({
  data,
  onSaved,
}: {
  data: LegalAdminView;
  onSaved: (receipt: LegalAdminView) => void;
}) {
  const baseline = useRef(data.settings);
  const op = useOperation(),
    [value, setValue] = useState({
      company: data.settings.company,
      contact_email: data.settings.contact_email,
      jurisdiction: data.settings.jurisdiction,
      processors: data.settings.processors,
    }),
    [dirty, setDirty] = useState(false);
  useExit({ dirty });
  useEffect(() => {
    if (!dirty && !op.busy && !op.unknown) {
      baseline.current = data.settings;
      setValue({
        company: data.settings.company,
        contact_email: data.settings.contact_email,
        jurisdiction: data.settings.jurisdiction,
        processors: data.settings.processors,
      });
    }
  }, [data.settings, dirty, op.busy, op.unknown]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = legalSettingsUpdate.safeParse(
          Object.fromEntries(
            Object.entries(value).filter(
              ([key, v]) => v !== Reflect.get(baseline.current, key),
            ),
          ),
        );
        if (!parsed.success) {
          op.reject(
            parsed.error.issues[0]?.message || "Check operator details.",
          );
          return;
        }
        void op.run(
          () => client.updateLegal(parsed.data),
          (receipt) => {
            requireMatch(receipt.settings, parsed.data, "Operator details");
            onSaved(receipt);
            baseline.current = receipt.settings;
            setValue({
              company: receipt.settings.company,
              contact_email: receipt.settings.contact_email,
              jurisdiction: receipt.settings.jurisdiction,
              processors: receipt.settings.processors,
            });
            setDirty(false);
          },
        );
      }}
    >
      <fieldset disabled={op.blocked}>
        <legend>Service operator</legend>
        {(["company", "contact_email", "jurisdiction"] as const).map((key) => (
          <Field label={key.replaceAll("_", " ")} key={key}>
            <Input
              type={key === "contact_email" ? "email" : "text"}
              maxLength={key === "contact_email" ? 254 : 160}
              value={value[key]}
              onChange={(e) => {
                setValue({ ...value, [key]: e.target.value });
                setDirty(true);
              }}
            />
          </Field>
        ))}
        <Field label="Processors">
          <TextArea
            maxLength={4000}
            value={value.processors}
            onChange={(e) => {
              setValue({ ...value, processors: e.target.value });
              setDirty(true);
            }}
          />
        </Field>
        <Button type="submit" disabled={!dirty}>
          Save operator details
        </Button>
      </fieldset>
      <Outcome op={op} />
    </form>
  );
}
function Document({
  doc,
  data,
  onSaved,
}: {
  doc: LegalDoc;
  data: LegalAdminView;
  onSaved: (receipt: LegalAdminView) => void;
}) {
  const op = useOperation(),
    [body, setBody] = useState(data.settings[doc].body ?? data.defaults[doc]),
    [shipped, setShipped] = useState(data.settings[doc].body === null),
    [dirty, setDirty] = useState(false);
  useExit({ dirty });
  useEffect(() => {
    if (!dirty && !op.busy && !op.unknown) {
      setBody(data.settings[doc].body ?? data.defaults[doc]);
      setShipped(data.settings[doc].body === null);
    }
  }, [data.settings, data.defaults, doc, dirty, op.busy, op.unknown]);
  function save(publish: boolean) {
    const parsed = legalSettingsUpdate.safeParse({
      [`${doc}_body`]: shipped ? null : body,
      ...(publish ? { publish: [doc] } : {}),
    });
    if (!parsed.success) {
      op.reject(parsed.error.issues[0]?.message || "Check document text.");
      return;
    }
    void op.run(
      () => client.updateLegal(parsed.data),
      (r) => {
        requireMatch(
          r.settings[doc],
          { body: shipped ? null : body.trim() },
          "Legal document",
        );
        if (publish && r.settings[doc].version === data.settings[doc].version)
          throw new Error("Publication version did not advance.");
        if (!r.settings[doc].version)
          throw new Error("Document receipt is missing.");
        onSaved(r);
        setBody(r.settings[doc].body ?? r.defaults[doc]);
        setShipped(r.settings[doc].body === null);
        setDirty(false);
      },
      publish
        ? {
            title: `Publish new ${doc} version?`,
            body: "Every user may be asked to accept the new legal version. This is a real policy publication.",
            action: "Publish legal version",
            danger: true,
          }
        : undefined,
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      <fieldset disabled={op.blocked}>
        <legend>
          {doc === "terms" ? "Terms of service" : "Privacy policy"}
        </legend>
        <p>
          Current version {data.settings[doc].version} ·{" "}
          {data.settings[doc].updated_at || "shipped default"}
        </p>
        <label>
          <input
            type="checkbox"
            checked={shipped}
            onChange={(e) => {
              setShipped(e.target.checked);
              setDirty(true);
            }}
          />
          Use shipped text
        </label>
        <Field label={`${doc} Markdown source`}>
          <TextArea
            rows={18}
            required={!shipped}
            maxLength={60000}
            disabled={shipped}
            value={shipped ? data.defaults[doc] : body}
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
            }}
          />
        </Field>
        <details>
          <summary>Review current draft text</summary>
          <pre className="admin-prose" dir="auto">
            {shipped ? data.defaults[doc] : body}
          </pre>
        </details>
        <div className="admin-actions">
          <Button type="submit" disabled={!dirty}>
            Save {doc} text
          </Button>
          <Button variant="danger" onClick={() => save(true)}>
            Publish new {doc} version
          </Button>
        </div>
      </fieldset>
      <Outcome op={op} />
    </form>
  );
}
