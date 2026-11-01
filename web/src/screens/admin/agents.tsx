import { useEffect, useRef, useState } from "react";
import {
  agentSettingsUpdate,
  LEGACY_KEY_CLIENT_ID,
  type AgentSettings,
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
export function Agents() {
  const read = useRead(() => client.adminAgentSettings()),
    [days, setDays] = useState(30),
    clients = useRead(() => client.adminAgentClients()),
    usage = useRead(() => client.adminAgentUsage(days), [days]);
  return (
    <>
      <Section title="Outside-agent access">
        <ReadState read={read}>
          {read.data && <AgentForm data={read.data} refresh={read.reload} />}
        </ReadState>
      </Section>
      <Section title="Registered apps">
        <ReadState read={clients}>
          <Facts value={clients.data} />
          <Button onClick={() => void clients.reload()}>Refresh apps</Button>
        </ReadState>
      </Section>
      <Section title="App usage">
        <Field label="Usage days">
          <Input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 1 && n <= 90) setDays(n);
            }}
          />
        </Field>
        <p>People who opted out of analytics are not counted.</p>
        <ReadState read={usage}>
          <Facts value={usage.data} />
        </ReadState>
      </Section>
    </>
  );
}
function AgentForm({
  data,
  refresh,
}: {
  data: AgentSettings;
  refresh: () => Promise<void>;
}) {
  const baseline = useRef(data);
  const op = useOperation(),
    [value, setValue] = useState(data),
    [hosts, setHosts] = useState(data.allowed_client_hosts.join("\n")),
    [blocked, setBlocked] = useState(
      data.blocked_client_ids
        .filter((v) => v !== LEGACY_KEY_CLIENT_ID)
        .join("\n"),
    ),
    [legacy, setLegacy] = useState(
      !data.blocked_client_ids.includes(LEGACY_KEY_CLIENT_ID),
    ),
    [dirty, setDirty] = useState(false);
  useExit({ dirty });
  useEffect(() => {
    if (!dirty && !op.unknown) {
      baseline.current = data;
      setValue(data);
      setHosts(data.allowed_client_hosts.join("\n"));
      setBlocked(
        data.blocked_client_ids
          .filter((v) => v !== LEGACY_KEY_CLIENT_ID)
          .join("\n"),
      );
      setLegacy(!data.blocked_client_ids.includes(LEGACY_KEY_CLIENT_ID));
    }
  }, [data, dirty, op.unknown]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const input = {
          agents_enabled: value.agents_enabled,
          agents_writes_enabled: value.agents_writes_enabled,
          dcr_enabled: value.dcr_enabled,
          mcp_apps_enabled: value.mcp_apps_enabled,
          max_grant_days: value.max_grant_days,
          agent_limits: value.agent_limits,
          allowed_client_hosts: hosts
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
          blocked_client_ids: [
            ...new Set([
              ...blocked
                .split("\n")
                .map((v) => v.trim())
                .filter(Boolean),
              ...(legacy ? [] : [LEGACY_KEY_CLIENT_ID]),
            ]),
          ],
        };
        const parsed = agentSettingsUpdate.safeParse(
          Object.fromEntries(
            Object.entries(input).filter(
              ([key, v]) =>
                JSON.stringify(v) !==
                JSON.stringify(Reflect.get(baseline.current, key)),
            ),
          ),
        );
        if (!parsed.success) {
          op.reject(
            parsed.error.issues[0]?.message || "Check access settings.",
          );
          return;
        }
        void op.run(
          () => client.adminUpdateAgentSettings(parsed.data),
          (receipt) => {
            requireMatch(receipt, parsed.data, "Agent policy");
            setDirty(false);
            void refresh();
          },
          {
            title: "Change outside-agent policy?",
            body: "These runtime settings affect connected apps and their write access.",
            action: "Save agent policy",
          },
        );
      }}
    >
      <fieldset disabled={op.blocked}>
        {(
          [
            ["agents_enabled", "Allow outside agents"],
            ["agents_writes_enabled", "Allow agent writes"],
            ["dcr_enabled", "Allow dynamic client registration"],
            ["mcp_apps_enabled", "Allow MCP app cards"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={value[key]}
              onChange={(e) => {
                setValue({ ...value, [key]: e.target.checked });
                setDirty(true);
              }}
            />
            {label}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={legacy}
            disabled={!data.legacy_keys_until}
            onChange={(e) => {
              setLegacy(e.target.checked);
              setDirty(true);
            }}
          />
          Allow legacy personal API keys until reported cutoff
        </label>
        <p>
          Legacy key cutoff: {data.legacy_keys_until || "already ended"}. This
          is not a new grant type.
        </p>
        <div className="admin-form">
          <Field label="Allowed client hosts (one per line)">
            <TextArea
              value={hosts}
              onChange={(e) => {
                setHosts(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label="Blocked client IDs (one per line)">
            <TextArea
              value={blocked}
              onChange={(e) => {
                setBlocked(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label="Maximum grant days">
            <Input
              type="number"
              min={1}
              max={90}
              required
              value={value.max_grant_days}
              onChange={(e) => {
                setValue({ ...value, max_grant_days: Number(e.target.value) });
                setDirty(true);
              }}
            />
          </Field>
          {Object.entries(value.agent_limits).map(([key, n]) => (
            <Field key={key} label={key.replaceAll("_", " ")}>
              <Input
                type="number"
                required
                min={key === "concurrent" ? 1 : 0}
                max={
                  key === "concurrent"
                    ? 64
                    : key === "calls_per_day"
                      ? 10000000
                      : key === "writes_per_day"
                        ? 1000000
                        : key === "user_per_minute"
                          ? 100000
                          : 10000
                }
                value={n}
                onChange={(e) => {
                  setValue({
                    ...value,
                    agent_limits: {
                      ...value.agent_limits,
                      [key]: Number(e.target.value),
                    },
                  });
                  setDirty(true);
                }}
              />
            </Field>
          ))}
        </div>
        <Button type="submit" disabled={!dirty}>
          Save access policy
        </Button>
      </fieldset>
      <Outcome op={op} />
    </form>
  );
}
