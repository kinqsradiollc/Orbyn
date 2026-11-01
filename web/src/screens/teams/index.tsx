import { useEffect, useRef, useState } from "react";
import { teamInput, type Team } from "@orbyn/core";
import { useAccount } from "../../app/account";
import { navigate, useSearch, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  useConfirm,
} from "../../ui/kit";
import {
  Guard,
  ActionState,
  ReadState,
  useCommand,
  useOwned,
  useRead,
  useTeamsExit,
  useTeamsLeave,
  validId,
} from "./state";
import { Workspace } from "./Workspace";
import "./teams.css";
export default function TeamsScreen() {
  const account = useAccount();
  useTitle("Teams");
  return (
    <Guard key={account.version}>
      <TeamsHome />
    </Guard>
  );
}
function TeamsHome() {
  const owned = useOwned(),
    search = useSearch(),
    query = new URLSearchParams(search),
    requested = query.get("team"),
    invalid =
      query.getAll("team").length > 1 ||
      (query.has("team") && !validId(requested ?? "")),
    read = useRead(() => client.listTeams()),
    [created, setCreated] = useState<Team | null>(null),
    [creating, setCreating] = useState(false),
    [pendingSelection, setPendingSelection] = useState<string | null>(null),
    [goneId, setGoneId] = useState<string | null>(null),
    leave = useTeamsLeave(),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = client.watchEvents(
      (news) => {
        if (news.kind !== "changed" || !owned()) return;
        if (news.area && !["items", "projects", "organize"].includes(news.area))
          return;
        client.noteExternalMutation();
        if (timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          if (owned()) {
            setRevision((r) => r + 1);
            void read.reload();
          }
        }, 1000);
      },
      () => {},
    );
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [owned, read.reload]);
  const teams =
    created && !read.data?.some((t) => t.id === created.id)
      ? [created, ...(read.data ?? [])]
      : (read.data ?? []);
  useEffect(() => {
    if (created && read.data?.some((t) => t.id === created.id))
      setCreated(null);
  }, [created, read.data]);
  useEffect(() => {
    if (pendingSelection !== null && !creating) {
      const next = new URLSearchParams(search);
      if (pendingSelection) next.set("team", pendingSelection);
      else next.delete("team");
      navigate("/app/teams" + (next.size ? "?" + next.toString() : ""));
      setPendingSelection(null);
    }
  }, [pendingSelection, creating, search]);
  const choose = (id: string | null) => {
    const next = new URLSearchParams(search);
    if (id) next.set("team", id);
    else next.delete("team");
    navigate("/app/teams" + (next.size ? "?" + next.toString() : ""));
  };
  return (
    <main className="teams-main">
      <header className="teams-heading">
        <div>
          <h1>Teams</h1>
          <p className="small">Shared work, people and time</p>
        </div>
        <Button
          variant="primary"
          onClick={() =>
            void leave().then((ok) => {
              if (ok && owned()) setCreating(true);
            })
          }
        >
          New team
        </Button>
      </header>
      <div className="teams-layout">
        <aside className="teams-directory" aria-label="Your teams">
          <ReadState read={read} label="teams" />
          {!read.loading && !read.error && !teams.length && (
            <p>You have no teams yet.</p>
          )}
          {teams.map((t) => (
            <button
              className="teams-choice"
              key={t.id}
              aria-pressed={requested === t.id}
              onClick={() => choose(t.id)}
            >
              <strong dir="auto">{t.name}</strong>
              <span className="small">
                {t.member_count} members · {t.role ?? "Administrative access"}
              </span>
            </button>
          ))}
          <Button
            variant="ghost"
            disabled={read.loading}
            onClick={() => void read.reload()}
          >
            Refresh teams
          </Button>
        </aside>
        <section className="teams-content">
          {invalid ? (
            <ErrorNotice message="This team link has an invalid ID." />
          ) : requested && goneId !== requested ? (
            <Workspace
              key={requested}
              teamId={requested}
              revision={revision}
              onGone={() => {
                setCreated(null);
                setGoneId(requested);
                setPendingSelection("");
                void read.reload();
              }}
              onChanged={() => void read.reload()}
            />
          ) : (
            <div className="teams-empty">
              <h2>Choose a team</h2>
              <p>Open one to manage shared work or find time together.</p>
            </div>
          )}
        </section>
      </div>
      {creating && (
        <CreateTeam
          onClose={() => setCreating(false)}
          onSaved={(team) => {
            setCreated(team);
            setCreating(false);
            setGoneId(null);
            setPendingSelection(team.id);
            void read.reload();
          }}
        />
      )}
    </main>
  );
}
function CreateTeam({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (team: Team) => void;
}) {
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    command = useCommand(),
    confirm = useConfirm(),
    owned = useOwned(),
    closeLock = useRef(false),
    latestName = useRef(name),
    [confirming, setConfirming] = useState(false);
  latestName.current = name;
  useTeamsExit({
    live: () => ({
      ...command.live(),
      pending: command.live().pending || closeLock.current,
    }),
    dirty: !!name,
    pending: command.pending || confirming,
    uncertain: command.unknown,
    fingerprint: name,
    discard: () => {
      setName("");
      onClose();
    },
  });
  const close = async () => {
    if (command.blocked || closeLock.current || !owned()) return;
    closeLock.current = true;
    setConfirming(true);
    const snapshot = name;
    try {
      if (
        snapshot &&
        !(await confirm({
          title: "Discard this team draft?",
          action: "Discard",
          danger: true,
        }))
      )
        return;
      if (owned() && latestName.current === snapshot) onClose();
    } finally {
      closeLock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const submit = () => {
    const parsed = teamInput.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a team name.");
      return;
    }
    const input = parsed.data,
      key = crypto.randomUUID(),
      started = Date.now(),
      priorIds = new Set<string>();
    setError("");
    void command.run<Team>({
      label: "Create team",
      checkLabel: "Retry exact team creation",
      prepare: async () => {
        const prior = await client.listTeams();
        if (!owned()) throw Error("This team session ended.");
        prior.forEach((team) => priorIds.add(team.id));
      },
      perform: () => client.once(key, () => client.createTeam(input)),
      validate: (t) =>
        validId(t.id) &&
        !priorIds.has(t.id) &&
        t.name === input.name &&
        t.role === "owner",
      check: async () => {
        const age = Date.now() - started;
        if (age < 0 || age >= 23 * 3600000)
          throw Error(
            "The replay window has expired. Inspect your teams; this request will not be replayed.",
          );
        const t = await client.once(key, () => client.createTeam(input));
        return {
          done:
            validId(t.id) &&
            !priorIds.has(t.id) &&
            t.name === input.name &&
            t.role === "owner",
          value: t,
        };
      },
      saved: (t) => {
        if (t) onSaved(t);
      },
    });
  };
  return (
    <Dialog
      title="New team"
      onClose={() => void close()}
      actions={
        <>
          <Button
            disabled={command.blocked || confirming}
            onClick={() => void close()}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || command.blocked || confirming}
            busy={command.pending}
            onClick={submit}
          >
            Create team
          </Button>
        </>
      }
    >
      <Field label="Team name">
        <Input
          value={name}
          maxLength={80}
          disabled={command.blocked || confirming}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
      {error && <ErrorNotice message={error} />}
      <ActionState command={command} />
    </Dialog>
  );
}
