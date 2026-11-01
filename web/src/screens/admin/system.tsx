import { useEffect, useRef, useState } from "react";
import {
  systemSettingsUpdate,
  maintenanceInput,
  announcementInput,
  type SystemSettingsView,
  type SweepView,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input, TextArea, SelectBox } from "../../ui/kit";
import {
  Facts,
  requireMatch,
  Outcome,
  ReadState,
  Section,
  toIso,
  toLocal,
  useExit,
  useOperation,
  useRead,
} from "./shared";
export function System() {
  return (
    <>
      <Runtime />
      <Banners />
      <Retention />
      <Releases />
    </>
  );
}
function Runtime() {
  const read = useRead(() => client.getSystemSettings());
  return (
    <Section title="Runtime settings">
      <ReadState read={read}>
        {read.data && <RuntimeForm data={read.data} refresh={read.reload} />}
      </ReadState>
    </Section>
  );
}
function RuntimeForm({
  data,
  refresh,
}: {
  data: SystemSettingsView;
  refresh: () => Promise<void>;
}) {
  const baseline = useRef(data.settings);
  const op = useOperation(),
    [draft, setDraft] = useState(data.settings),
    [origins, setOrigins] = useState(data.settings.cors_origins.join("\n")),
    [password, setPassword] = useState(""),
    [keyMode, setKeyMode] = useState("keep"),
    [dirty, setDirty] = useState(false),
    [reset, setReset] = useState<string[]>([]),
    [to, setTo] = useState("");
  useExit({ dirty });
  useEffect(() => {
    if (!dirty) {
      baseline.current = data.settings;
      setDraft(data.settings);
      setOrigins(data.settings.cors_origins.join("\n"));
    }
  }, [data.settings, dirty]);
  const update = (next: typeof draft) => {
    setDraft(next);
    setDirty(true);
  };
  function save() {
    const input = {
      ...draft,
      cors_origins: origins
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean),
      smtp: {
        host: draft.smtp.host,
        port: draft.smtp.port,
        user: draft.smtp.user,
        secure: draft.smtp.secure,
        from: draft.smtp.from,
        ...(keyMode === "keep"
          ? {}
          : { password: keyMode === "remove" ? "" : password }),
      },
    };
    const changed = Object.fromEntries(
      Object.entries(input).filter(
        ([key, value]) =>
          key !== "smtp" &&
          JSON.stringify(value) !==
            JSON.stringify(Reflect.get(baseline.current, key)),
      ),
    );
    const smtp = Object.fromEntries(
      Object.entries(input.smtp).filter(
        ([key, value]) =>
          key === "password" ||
          value !== Reflect.get(baseline.current.smtp, key),
      ),
    );
    const parsed = systemSettingsUpdate.safeParse({
      ...changed,
      ...(Object.keys(smtp).length ? { smtp } : {}),
    });
    if (!parsed.success) {
      op.reject(parsed.error.issues[0]?.message || "Check settings.");
      return;
    }
    void op.run(
      () => client.updateSystemSettings(parsed.data),
      (receipt) => {
        const expected = { ...parsed.data };
        if (parsed.data.smtp) {
          const { password: secret, ...savedSmtp } = parsed.data.smtp;
          expected.smtp = savedSmtp;
          requireMatch(
            receipt.settings.smtp,
            {
              ...savedSmtp,
              ...(secret === undefined ? {} : { has_password: !!secret }),
            },
            "SMTP settings",
          );
        }
        requireMatch(receipt.settings, expected, "Runtime settings");
        setDirty(false);
        setPassword("");
        setKeyMode("keep");
        void refresh();
      },
    );
  }
  return (
    <>
      <Facts
        value={{
          sources: data.sources,
          updated_at: data.updated_at,
          clock: data.clock,
        }}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset disabled={op.blocked}>
          <Field
            label="Allowed CORS origins"
            hint="One origin per line, without paths."
          >
            <TextArea
              value={origins}
              onChange={(e) => {
                setOrigins(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <div className="admin-form">
            {(
              [
                ["rate_limit_per_minute", "Requests per minute", 0, 100000],
                ["notifier_concurrency", "Notifier concurrency", 1, 64],
                [
                  "status_interval_ms",
                  "Status interval (milliseconds)",
                  5000,
                  3600000,
                ],
              ] as const
            ).map(([key, label, min, max]) => (
              <Field key={key} label={label}>
                <Input
                  type="number"
                  required
                  min={min}
                  max={max}
                  value={draft[key]}
                  onChange={(e) =>
                    update({ ...draft, [key]: Number(e.target.value) })
                  }
                />
              </Field>
            ))}
          </div>
          <h3>SMTP</h3>
          <p>
            {data.settings.smtp.has_password
              ? "A saved password exists."
              : "No saved password."}{" "}
            Omit keeps it; Remove clears it.
          </p>
          <div className="admin-form">
            {(["host", "user", "from"] as const).map((key) => (
              <Field key={key} label={`SMTP ${key}`}>
                <Input
                  maxLength={200}
                  value={draft.smtp[key]}
                  onChange={(e) =>
                    update({
                      ...draft,
                      smtp: { ...draft.smtp, [key]: e.target.value },
                    })
                  }
                />
              </Field>
            ))}
            <Field label="SMTP port">
              <Input
                type="number"
                min={1}
                max={65535}
                required
                value={draft.smtp.port}
                onChange={(e) =>
                  update({
                    ...draft,
                    smtp: { ...draft.smtp, port: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label="Password action">
              <SelectBox
                value={keyMode}
                onChange={(e) => {
                  setKeyMode(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="keep">Keep saved password</option>
                <option value="replace">Replace password</option>
                <option value="remove">Remove password</option>
              </SelectBox>
            </Field>
            {keyMode === "replace" && (
              <Field label="New SMTP password">
                <Input
                  autoComplete="new-password"
                  type="password"
                  maxLength={500}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
            )}
          </div>
          <label>
            <input
              type="checkbox"
              checked={draft.smtp.secure}
              onChange={(e) =>
                update({
                  ...draft,
                  smtp: { ...draft.smtp, secure: e.target.checked },
                })
              }
            />
            Secure SMTP
          </label>
          <Button type="submit" disabled={!dirty}>
            Save runtime settings
          </Button>
        </fieldset>
      </form>
      <h3>Return groups to environment configuration</h3>
      {Object.keys(data.sources).map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={reset.includes(key)}
            disabled={op.blocked}
            onChange={(e) =>
              setReset(
                e.target.checked
                  ? [...reset, key]
                  : reset.filter((v) => v !== key),
              )
            }
          />
          {key.replaceAll("_", " ")}
        </label>
      ))}
      <Button
        disabled={op.blocked || !reset.length || dirty}
        onClick={() => {
          const parsed = systemSettingsUpdate.safeParse({ reset });
          if (parsed.success)
            void op.run(
              () => client.updateSystemSettings(parsed.data),
              (receipt) => {
                for (const group of reset)
                  requireMatch(
                    receipt.sources,
                    { [group]: "environment" },
                    "Environment reset",
                  );
                setReset([]);
                void refresh();
              },
              {
                title: "Use environment values?",
                body: `Reset ${reset.join(", ")}. Unsaved edits must be saved first.`,
                action: "Reset selected groups",
                danger: true,
              },
            );
        }}
      >
        Reset selected groups
      </Button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void op.run(
            () => client.sendTestEmail(to || undefined),
            () => {},
            {
              title: "Send test email?",
              body: "This sends a real email using the currently saved SMTP settings.",
              action: "Send test email",
            },
          );
        }}
      >
        <Field label="Test email recipient (blank uses your account)">
          <Input
            type="email"
            maxLength={254}
            value={to}
            disabled={op.blocked}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={op.blocked || dirty}>
          Send test email
        </Button>
      </form>
      <Outcome op={op} />
    </>
  );
}
function Banners() {
  const read = useRead(async () => ({
    maintenance: await client.getMaintenance(),
    announcement: await client.announcement(),
  }));
  return (
    <Section title="Service notices">
      <ReadState read={read}>
        {read.data && (
          <NoticeForm
            key={
              read.data.maintenance.updated_at +
              String(read.data.announcement?.updated_at)
            }
            data={read.data}
            refresh={read.reload}
          />
        )}
      </ReadState>
    </Section>
  );
}
function NoticeForm({
  data,
  refresh,
}: {
  data: {
    maintenance: Awaited<ReturnType<typeof client.getMaintenance>>;
    announcement: Awaited<ReturnType<typeof client.announcement>>;
  };
  refresh: () => Promise<void>;
}) {
  const op = useOperation(),
    [m, setM] = useState(data.maintenance),
    [a, setA] = useState({
      message: data.announcement?.message || "",
      tone: data.announcement?.tone || "info",
      until: data.announcement?.until || null,
    }),
    [md, setMD] = useState(false),
    [ad, setAD] = useState(false);
  useExit({ dirty: md || ad });
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = maintenanceInput.safeParse({
            enabled: m.enabled,
            message: m.message,
            until: m.until,
          });
          if (!parsed.success) {
            op.reject("Check the maintenance message and expiry.");
            return;
          }
          void op.run(
            () => client.setMaintenance(parsed.data),
            (receipt) => {
              requireMatch(receipt, parsed.data, "Maintenance");
              setMD(false);
              void refresh();
            },
            {
              title: "Update maintenance mode?",
              body: "This changes service access for ordinary users.",
              action: "Update maintenance",
              danger: m.enabled,
            },
          );
        }}
      >
        <fieldset disabled={op.blocked}>
          <h3>Maintenance</h3>
          <label>
            <input
              type="checkbox"
              checked={m.enabled}
              onChange={(e) => {
                setM({ ...m, enabled: e.target.checked });
                setMD(true);
              }}
            />
            Maintenance enabled
          </label>
          <Field label="Maintenance message">
            <TextArea
              maxLength={500}
              value={m.message}
              onChange={(e) => {
                setM({ ...m, message: e.target.value });
                setMD(true);
              }}
            />
          </Field>
          <Field label="Maintenance ends (local time, optional)">
            <Input
              type="datetime-local"
              value={toLocal(m.until)}
              onChange={(e) => {
                setM({ ...m, until: toIso(e.target.value) });
                setMD(true);
              }}
            />
          </Field>
          <Button type="submit" disabled={!md}>
            Save maintenance
          </Button>
        </fieldset>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = announcementInput.safeParse(a);
          if (!parsed.success) {
            op.reject("Check announcement fields.");
            return;
          }
          void op.run(
            () => client.setAnnouncement(parsed.data),
            (receipt) => {
              requireMatch(receipt, parsed.data, "Announcement");
              setAD(false);
              void refresh();
            },
          );
        }}
      >
        <fieldset disabled={op.blocked}>
          <h3>Announcement</h3>
          <Field
            label="Announcement message"
            hint="An empty message clears the notice."
          >
            <TextArea
              maxLength={300}
              value={a.message}
              onChange={(e) => {
                setA({ ...a, message: e.target.value });
                setAD(true);
              }}
            />
          </Field>
          <Field label="Tone">
            <SelectBox
              value={a.tone}
              onChange={(e) => {
                setA({ ...a, tone: e.target.value as "info" | "warning" });
                setAD(true);
              }}
            >
              <option value="info">Information</option>
              <option value="warning">Warning</option>
            </SelectBox>
          </Field>
          <Field label="Announcement expires (local time, optional)">
            <Input
              type="datetime-local"
              value={toLocal(a.until)}
              onChange={(e) => {
                setA({ ...a, until: toIso(e.target.value) });
                setAD(true);
              }}
            />
          </Field>
          <Button type="submit" disabled={!ad}>
            Save announcement
          </Button>
        </fieldset>
      </form>
      <Outcome op={op} />
    </>
  );
}
function Retention() {
  const read = useRead(() => client.adminSweep());
  return (
    <Section title="Retention">
      <ReadState read={read}>
        {read.data && <RetentionForm data={read.data} refresh={read.reload} />}
      </ReadState>
    </Section>
  );
}
function RetentionForm({
  data,
  refresh,
}: {
  data: SweepView;
  refresh: () => Promise<void>;
}) {
  const op = useOperation(),
    [values, setValues] = useState<Record<string, number>>({}),
    dirty = Object.keys(values).length > 0;
  useExit({ dirty });
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void op.run(
            () => client.setRetention(values),
            (receipt) => {
              for (const [key, days] of Object.entries(values)) {
                const rule = receipt.rules.find((r) => r.key === key);
                requireMatch(rule, { days }, "Retention");
              }
              setValues({});
              void refresh();
            },
          );
        }}
      >
        <fieldset disabled={op.blocked}>
          {data.rules.map((r) => (
            <div key={r.key} className="admin-row">
              <div>
                <h3>{r.label}</h3>
                <p>{r.detail}</p>
                <p>
                  {r.rows} rows · {r.size} · default{" "}
                  {r.default_days === 0
                    ? "forever"
                    : r.default_days === null
                      ? "fixed"
                      : `${r.default_days} days`}
                </p>
              </div>
              {r.configurable ? (
                <Field label={`${r.label} days (0 keeps forever)`}>
                  <Input
                    type="number"
                    required
                    min={0}
                    max={3650}
                    value={values[r.key] ?? r.days ?? 0}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (n !== 0 && r.min_days !== null && n < r.min_days) {
                        op.reject(
                          `Minimum for ${r.label} is ${r.min_days} days, or 0 to keep forever.`,
                        );
                        return;
                      }
                      setValues({ ...values, [r.key]: n });
                    }}
                  />
                </Field>
              ) : (
                <span>Fixed policy</span>
              )}
            </div>
          ))}
          <Button type="submit" disabled={!dirty}>
            Save retention
          </Button>
        </fieldset>
      </form>
      <Facts value={data.last} />
      <Button
        disabled={op.blocked || dirty}
        onClick={() =>
          void op.run(
            () => client.runSweep(),
            () => void refresh(),
            {
              title: "Run retention sweep?",
              body: "Permanently removes eligible retained records using the saved policies.",
              action: "Run sweep",
              danger: true,
            },
          )
        }
      >
        Run retention sweep
      </Button>
      <Outcome op={op} />
    </>
  );
}
function Releases() {
  const read = useRead(async () => ({
    version: await client.getVersion(),
    updates: await client.getUpdates(),
  }));
  return (
    <Section title="Version and updates">
      <ReadState read={read}>
        <Facts value={read.data} />
        {read.data?.updates.deploy_url &&
          /^https?:\/\//.test(read.data.updates.deploy_url) && (
            <a
              href={read.data.updates.deploy_url}
              target="_blank"
              rel="noreferrer"
            >
              Open deployment information
            </a>
          )}
        <p>Opening deployment information does not run an update.</p>
        <Button onClick={() => void read.reload()}>
          Check update metadata
        </Button>
      </ReadState>
    </Section>
  );
}
