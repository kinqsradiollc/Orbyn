import { useEffect, useRef, useState } from "react";
import {
  TEAM_ROLES,
  type AdminUser,
  type TeamRole,
  adminUserProfileUpdate,
} from "@orbyn/core";
import { useAccount } from "../../app/account";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { Button, Field, Input, SelectBox, ErrorNotice } from "../../ui/kit";
import {
  Facts,
  Outcome,
  PrivateReceipt,
  ReadState,
  Section,
  download,
  useAdminLeave,
  useExit,
  useOperation,
  useOwner,
  useRead,
} from "./shared";
export function People({ area }: { area: string }) {
  return area === "users" ? <Users /> : <Teams />;
}
function Users() {
  const owned = useOwner("users:read"),
    leave = useAdminLeave(),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [rows, setRows] = useState<AdminUser[]>([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    lock = useRef(false),
    epoch = useRef(0),
    queued = useRef(false),
    latest = useRef(search);
  latest.current = search;
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  async function load(reset: boolean) {
    if (!owned()) return;
    if (lock.current) {
      if (reset) queued.current = true;
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const mine = epoch.current;
    try {
      const page = await client.adminListUsers({
        search: latest.current,
        limit: 50,
        offset: reset ? 0 : rows.length,
      });
      if (owned() && mine === epoch.current) {
        setRows((old) =>
          reset
            ? page.rows
            : [
                ...old,
                ...page.rows.filter((r) => !old.some((o) => o.id === r.id)),
              ],
        );
        setTotal(page.total);
      }
    } catch (e) {
      if (owned() && mine === epoch.current)
        setError(messageOf(e, "Could not load accounts."));
    } finally {
      lock.current = false;
      if (owned()) {
        setBusy(false);
        if (queued.current) {
          queued.current = false;
          void load(true);
        }
      }
    }
  }
  useEffect(() => {
    epoch.current++;
    setRows([]);
    void load(true);
  }, [search]);
  async function select(id: string) {
    if (id !== selected && (await leave()) && owned()) setSelected(id);
  }
  return (
    <Section title="Accounts">
      <div className="admin-master">
        <div>
          <Field label="Find an account">
            <Input
              maxLength={100}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          <Button disabled={busy} onClick={() => void load(true)}>
            Refresh accounts
          </Button>
          {error && (
            <ErrorNotice
              message={error}
              onRetry={() => void load(!rows.length)}
            />
          )}
          <div className="admin-collection">
            {rows.map((r) => (
              <Button
                key={r.id}
                variant="ghost"
                aria-pressed={selected === r.id}
                onClick={() => void select(r.id)}
              >
                <span>
                  <span dir="auto">{r.name || r.email}</span>
                  <small dir="auto">
                    {r.email} · {r.role}
                    {r.disabled ? " · disabled" : ""}
                  </small>
                </span>
              </Button>
            ))}
          </div>
          <p>
            {rows.length} of {total}
          </p>
          <Button
            busy={busy}
            disabled={rows.length >= total}
            onClick={() => void load(false)}
          >
            More accounts
          </Button>
        </div>
        {selected && (
          <UserDetail
            key={selected}
            id={selected}
            onRemoved={() => {
              setSelected("");
              void load(true);
            }}
          />
        )}
      </div>
    </Section>
  );
}
function UserDetail({ id, onRemoved }: { id: string; onRemoved: () => void }) {
  const read = useRead(() => client.adminUserDetail(id), [id], "users:read");
  return (
    <ReadState read={read}>
      {read.data && (
        <UserEditor
          key={id}
          id={id}
          data={read.data}
          reload={read.reload}
          onRemoved={onRemoved}
        />
      )}
    </ReadState>
  );
}
type Detail = Awaited<ReturnType<typeof client.adminUserDetail>>;
function UserEditor({
  id,
  data,
  reload,
  onRemoved,
}: {
  id: string;
  data: Detail;
  reload: () => Promise<void>;
  onRemoved: () => void;
}) {
  const account = useAccount(),
    op = useOperation("users:manage"),
    [name, setName] = useState(data.name),
    [email, setEmail] = useState(data.email),
    [dirty, setDirty] = useState(false),
    [secret, setSecret] = useState(""),
    [secretInfo, setSecretInfo] = useState<{
      minutes: number;
      emailed: boolean;
    } | null>(null),
    [attempt, setAttempt] = useState<{
      kind: "profile";
      identity: string;
      body: { name: string; email: string };
    } | null>(null),
    currentProof = useRef<typeof attempt>(null);
  useExit({ dirty });
  useEffect(() => {
    if (!dirty) {
      setName(data.name);
      setEmail(data.email);
    }
  }, [data.name, data.email, dirty]);
  const refresh = () => {
    void reload();
    if (account.user?.id === id) void account.refresh();
  };
  function clearProof() {
    currentProof.current = null;
    setAttempt(null);
  }
  function other<T>(...args: Parameters<typeof op.run<T>>) {
    const [work, accept, question, effect] = args;
    return op.run(
      () => {
        clearProof();
        return work();
      },
      accept,
      question,
      effect,
    );
  }
  async function profile() {
    const parsed = adminUserProfileUpdate.safeParse({ name, email });
    if (!parsed.success) {
      op.reject(parsed.error.issues[0]?.message || "Check profile fields.");
      return;
    }
    const body = {
      name: parsed.data.name ?? name,
      email: parsed.data.email ?? email,
    };
    const submitted = {
      kind: "profile" as const,
      identity: crypto.randomUUID(),
      body,
    };
    await op.run(
      () => {
        currentProof.current = submitted;
        setAttempt(submitted);
        return client.adminUpdateUserProfile(id, parsed.data);
      },
      (value) => {
        if (currentProof.current !== submitted || value.ok !== true)
          throw new Error(
            "Profile receipt is invalid or belongs to another attempt.",
          );
        clearProof();
        setDirty(false);
        refresh();
      },
    );
  }
  return (
    <div className="admin-detail">
      <h3 dir="auto">{data.name || data.email}</h3>
      <Facts
        value={{
          id,
          role: data.role,
          disabled: data.disabled,
          email_verified: data.email_verified,
          created_at: data.created_at,
          last_active: data.last_active,
          counts: data.counts,
          teams: data.teams,
          activity: data.activity,
          audit: data.audit,
        }}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void profile();
        }}
      >
        <fieldset disabled={op.blocked}>
          <legend>Profile</legend>
          <Field label="Name">
            <Input
              required
              maxLength={100}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label="Email">
            <Input
              required
              type="email"
              maxLength={254}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Button type="submit" disabled={!dirty}>
            Save profile
          </Button>
        </fieldset>
      </form>
      <Outcome
        op={op}
        check={
          attempt
            ? async () => {
                const proof = attempt;
                if (
                  currentProof.current !== proof ||
                  proof.kind !== "profile" ||
                  !op.owned()
                )
                  return false;
                const d = await client.adminUserDetail(id);
                if (!op.owned() || currentProof.current !== proof) return false;
                if (
                  d.name === proof.body.name &&
                  d.email === proof.body.email
                ) {
                  clearProof();
                  setDirty(false);
                  await reload();
                  return true;
                }
                return false;
              }
            : undefined
        }
      />
      <div className="admin-actions">
        <Button
          disabled={op.blocked}
          onClick={() =>
            void other(
              () =>
                client.adminUpdateUser(id, {
                  role: data.role === "admin" ? "member" : "admin",
                }),
              (r) => {
                if (r.id !== id) throw new Error("Wrong account receipt.");
                refresh();
              },
              {
                title: "Change system role?",
                body: `Change ${data.email} to ${data.role === "admin" ? "member" : "administrator"}? Server safeguards protect the last active administrator.`,
                action: "Change role",
                danger: true,
              },
            )
          }
        >
          Make {data.role === "admin" ? "member" : "administrator"}
        </Button>
        <Button
          disabled={op.blocked}
          onClick={() =>
            void other(
              () => client.adminUpdateUser(id, { disabled: !data.disabled }),
              (r) => {
                if (r.id !== id) throw new Error("Wrong account receipt.");
                refresh();
              },
              {
                title: data.disabled ? "Enable account?" : "Disable account?",
                body: "Disabling ends sessions and revokes connected access.",
                action: data.disabled ? "Enable" : "Disable",
                danger: !data.disabled,
              },
            )
          }
        >
          {data.disabled ? "Enable" : "Disable"}
        </Button>
        <Button
          disabled={op.blocked}
          onClick={() =>
            void other(
              () =>
                client.adminUpdateUser(id, {
                  email_verified: !data.email_verified,
                }),
              (r) => {
                if (r.id !== id) throw new Error("Wrong account receipt.");
                refresh();
              },
              {
                title: "Change email verification?",
                body: `Update the verification flag for ${data.email}.`,
                action: "Change verification",
              },
            )
          }
        >
          {data.email_verified ? "Mark unverified" : "Mark verified"}
        </Button>
        <Button
          disabled={op.blocked}
          onClick={() =>
            void other(
              () => client.adminSignOutUser(id),
              (r) => {
                if (!Number.isFinite(r.ended))
                  throw new Error("Invalid sign-out receipt.");
                refresh();
              },
              {
                title: "End all sessions?",
                body: `Sign ${data.email} out on all devices.`,
                action: "Sign out all",
                danger: true,
              },
            )
          }
        >
          Sign out all devices
        </Button>
        <Button
          disabled={op.blocked || !!secret}
          onClick={() =>
            void other(
              () => client.adminResetLink(id),
              (r) => {
                if (!r.link || !r.expires_in_minutes)
                  throw new Error("Reset link receipt is missing.");
                setSecret(r.link);
                setSecretInfo({
                  minutes: r.expires_in_minutes,
                  emailed: r.emailed,
                });
              },
              {
                title: "Create password reset link?",
                body: "Creates a private one-hour link and may email it to this account.",
                action: "Create reset link",
              },
            )
          }
        >
          Password reset link
        </Button>
        <Button
          disabled={op.blocked || !data.two_factor}
          onClick={() =>
            void other(
              () => client.adminResetTwoFactor(id),
              (r) => {
                if (typeof r.cleared !== "boolean")
                  throw new Error("Invalid reset receipt.");
                refresh();
              },
              {
                title: "Reset two-step verification?",
                body: `Remove the extra sign-in protection for ${data.email}.`,
                action: "Reset protection",
                danger: true,
              },
            )
          }
        >
          Reset two-step verification
        </Button>
        <Button
          disabled={op.blocked}
          onClick={() =>
            void other(
              () => client.adminExportUser(id),
              (r) =>
                download(
                  new Blob([JSON.stringify(r, null, 2)], {
                    type: "application/json",
                  }),
                  `account-${id}.json`,
                ),
              {
                title: "Download private account export?",
                body: "The export may contain personal workspace data. Save it securely.",
                action: "Download export",
              },
              "read",
            )
          }
        >
          Export account
        </Button>
        <Button
          variant="danger"
          disabled={op.blocked}
          onClick={() =>
            void other(() => client.adminDeleteUser(id), onRemoved, {
              title: "Delete account permanently?",
              body: `Permanently delete ${data.email} and its personal workspace. Admin self-deletion is refused by the server.`,
              action: "Delete account",
              danger: true,
            })
          }
        >
          Delete account
        </Button>
      </div>
      {secret && (
        <>
          <p>
            Expires in {secretInfo?.minutes} minutes.{" "}
            {secretInfo?.emailed
              ? "Email sent by server."
              : "Server did not email this link."}
          </p>
          <PrivateReceipt value={secret} onDone={() => setSecret("")} />
        </>
      )}
      <h4>Sessions</h4>
      {data.sessions.map((s) => (
        <div className="admin-row" key={s.id}>
          <Facts value={s} />
          <Button
            disabled={op.blocked}
            onClick={() =>
              void other(() => client.adminEndSession(id, s.id), refresh, {
                title: "End this session?",
                body: s.user_agent || s.id,
                action: "End session",
                danger: true,
              })
            }
          >
            End session
          </Button>
        </div>
      ))}
      <h4>Personal API keys</h4>
      {data.keys.map((k) => (
        <div className="admin-row" key={k.id}>
          <Facts value={k} />
          <Button
            disabled={op.blocked}
            onClick={() =>
              void other(() => client.adminRevokeApiKey(id, k.id), refresh, {
                title: "Revoke personal key?",
                body: "Clients using this key will lose access.",
                action: "Revoke key",
                danger: true,
              })
            }
          >
            Revoke key
          </Button>
        </div>
      ))}
      <h4>Connected agents</h4>
      {data.agents.map((a) => (
        <div className="admin-row" key={a.id}>
          <Facts value={a} />
          <Button
            disabled={op.blocked}
            onClick={() =>
              void other(() => client.adminRevokeUserAgent(id, a.id), refresh, {
                title: "Revoke agent access?",
                body: "Ends this exact connected grant.",
                action: "Revoke access",
                danger: true,
              })
            }
          >
            Revoke agent
          </Button>
        </div>
      ))}
      <Button disabled={op.busy} onClick={() => void reload()}>
        Refresh account detail
      </Button>
    </div>
  );
}
function Teams() {
  const read = useRead(() => client.adminListTeams(), [], "teams:read_all"),
    leave = useAdminLeave(),
    [query, setQuery] = useState(""),
    [id, setId] = useState("");
  return (
    <Section title="Teams">
      <ReadState read={read}>
        <Field label="Find a team">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <div className="admin-master">
          <div className="admin-collection">
            {read.data
              ?.filter((t) =>
                t.name.toLowerCase().includes(query.toLowerCase()),
              )
              .map((t) => (
                <Button
                  key={t.id}
                  variant="ghost"
                  aria-pressed={id === t.id}
                  onClick={() =>
                    void leave().then((ok) => {
                      if (ok && read.owned()) setId(t.id);
                    })
                  }
                >
                  <span dir="auto">{t.name}</span>
                  <small>
                    {t.member_count} members · {t.role || "not a member"}
                  </small>
                </Button>
              ))}
          </div>
          {id && (
            <TeamEditor
              key={id}
              id={id}
              done={() => {
                setId("");
                void read.reload();
              }}
            />
          )}
        </div>
      </ReadState>
    </Section>
  );
}
function TeamEditor({ id, done }: { id: string; done: () => void }) {
  const read = useRead(() => client.getTeam(id), [id], "teams:read_all"),
    op = useOperation("teams:manage_all"),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [role, setRole] = useState<TeamRole>("member"),
    [dirty, setDirty] = useState(false);
  useExit({ dirty: dirty || !!email });
  useEffect(() => {
    if (read.data && !dirty) setName(read.data.name);
  }, [read.data, dirty]);
  const refresh = () => void read.reload();
  return (
    <ReadState read={read}>
      {read.data && (
        <div className="admin-detail">
          <h3 dir="auto">{read.data.name}</h3>
          <p>
            Your membership: {read.data.role || "none"}. Team authorization is
            checked by the server.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim())
                void op.run(
                  () => client.updateTeam(id, { name: name.trim() }),
                  () => {
                    setDirty(false);
                    refresh();
                  },
                );
            }}
          >
            <fieldset disabled={op.blocked}>
              <Field label="Team name">
                <Input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Button type="submit" disabled={!dirty}>
                Rename team
              </Button>
            </fieldset>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void op.run(
                () => client.addTeamMember(id, { email, role }),
                () => {
                  setEmail("");
                  refresh();
                },
                {
                  title: "Add team member?",
                  body: `Add ${email} as ${role}.`,
                  action: "Add member",
                },
              );
            }}
          >
            <fieldset disabled={op.blocked}>
              <Field label="Member email">
                <Input
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="New member role">
                <SelectBox
                  value={role}
                  onChange={(e) => setRole(e.target.value as TeamRole)}
                >
                  {TEAM_ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </SelectBox>
              </Field>
              <Button type="submit">Add member</Button>
            </fieldset>
          </form>
          {read.data.members.map((m) => (
            <div className="admin-row" key={m.user_id}>
              <Facts value={m} />
              <Field label={`Role for ${m.email}`}>
                <SelectBox
                  disabled={op.blocked}
                  value={m.role}
                  onChange={(e) => {
                    const next = e.target.value as TeamRole;
                    void op.run(
                      () =>
                        client.updateTeamMember(id, m.user_id, { role: next }),
                      refresh,
                      {
                        title: "Change team role?",
                        body: `Change ${m.email} from ${m.role} to ${next}.`,
                        action: "Change role",
                        danger: next === "owner",
                      },
                    );
                  }}
                >
                  {TEAM_ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </SelectBox>
              </Field>
              <Button
                disabled={op.blocked}
                onClick={() =>
                  void op.run(
                    () => client.removeTeamMember(id, m.user_id),
                    refresh,
                    {
                      title: "Remove team member?",
                      body: m.email,
                      action: "Remove member",
                      danger: true,
                    },
                  )
                }
              >
                Remove member
              </Button>
            </div>
          ))}
          <Outcome op={op} />
          <Button
            variant="danger"
            disabled={op.blocked}
            onClick={() =>
              void op.run(() => client.deleteTeam(id), done, {
                title: "Delete team permanently?",
                body: "Delete the team and its shared workspace.",
                action: "Delete team",
                danger: true,
              })
            }
          >
            Delete team
          </Button>
        </div>
      )}
    </ReadState>
  );
}
