import {
  ASSISTANT_RULE_ACTIONS,
  assistantRulesInput,
  type AssistantActionRule,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import {
  Button,
  ErrorNotice,
  Field,
  Loading,
  SelectBox,
  useConfirm,
} from "../../../ui/kit";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";
import { equal, unknownOutcome } from "./model";
const LANES = [
  { id: "interactive", name: "Chat" },
  { id: "background", name: "Background" },
  { id: "overnight", name: "Overnight" },
] as const;
const DECISIONS = [
  { id: "allow", name: "Allow" },
  { id: "ask", name: "Ask first" },
  { id: "deny", name: "Block" },
] as const;
const ACTIONS: Record<AssistantActionRule["action"], string> = {
  read: "Read",
  any_change: "Any change",
  create: "Create",
  edit: "Edit",
  delete_move_restore: "Delete, move or restore",
  email: "Email",
  notify: "Notify",
  publish: "Publish",
  fetch: "Fetch",
  handoff: "Handoff",
};
type Snapshot = Awaited<ReturnType<typeof client.assistantRules>>;
export function AutomationRules() {
  const owned = useSettingsOwner(),
    confirm = useConfirm(),
    read = useSettingsRead(() => client.assistantRules()),
    teams = useSettingsRead(() => client.listTeams());
  const [base, setBase] = useState<Snapshot | null>(null),
    [rules, setRules] = useState<AssistantActionRule[] | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [observed, setObserved] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const lock = useRef(false),
    unknown = useRef(false),
    latest = useRef(rules);
  latest.current = rules;
  const attempt = useRef<Readonly<{
    revision: number;
    rules: AssistantActionRule[];
  }> | null>(null);
  const observation = useRef(observed);
  observation.current = observed;
  useEffect(() => {
    if (owned() && read.data && !latest.current) {
      setBase(read.data);
      setRules(read.data.rules);
    }
  }, [read.data, owned]);
  const dirty = !!rules && !!base && !equal(rules, base.rules),
    frozen = busy || confirming || uncertain;
  useSettingsExit({
    dirty,
    pending: busy || confirming,
    sensitive: uncertain,
    message: uncertain
      ? "Check the unconfirmed rules save before leaving."
      : undefined,
  });
  const update = (id: string, next: AssistantActionRule) => {
    if (!owned() || lock.current || unknown.current) return;
    setRules(
      (rows) => rows?.map((row) => (row.id === id ? next : row)) ?? null,
    );
    setStatus("");
  };
  const add = () => {
    if (
      !owned() ||
      lock.current ||
      unknown.current ||
      !rules ||
      rules.length >= 100 ||
      !read.fresh
    )
      return;
    const row: AssistantActionRule = {
      id: crypto.randomUUID(),
      lane: "background",
      action: "any_change",
      scope: { kind: "all" },
      decision: "ask",
    };
    setRules([...rules, row]);
    setEditing(row.id);
    setStatus("");
  };
  const save = async () => {
    if (
      !owned() ||
      lock.current ||
      unknown.current ||
      !rules ||
      !base ||
      !dirty ||
      !read.fresh ||
      read.data?.revision !== base.revision
    )
      return;
    const checked = assistantRulesInput.safeParse({
      expected_revision: base.revision,
      rules,
    });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "Check these rules.");
      return;
    }
    const submitted = Object.freeze({
      revision: checked.data.expected_revision,
      rules: structuredClone(checked.data.rules),
    });
    attempt.current = submitted;
    lock.current = true;
    setBusy(true);
    setError("");
    setObserved(null);
    read.invalidate();
    try {
      const saved = await client.replaceAssistantRules(
        submitted.revision,
        submitted.rules,
      );
      if (!owned() || attempt.current !== submitted) return;
      if (
        saved.revision !== submitted.revision + 1 ||
        !equal(saved.rules, submitted.rules)
      )
        throw new Error(
          "The rules receipt does not match this replacement. Check saved rules.",
        );
      read.commit(saved);
      setBase(saved);
      setRules(saved.rules);
      setEditing(null);
      attempt.current = null;
      setStatus("Assistant rules saved.");
    } catch (failure) {
      if (owned()) {
        unknown.current = unknownOutcome(failure);
        setUncertain(unknown.current);
        setError(
          messageOf(failure, "Couldn't save rules. Your draft is kept."),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const check = async () => {
    const submitted = attempt.current;
    if (!owned() || lock.current || (unknown.current && !submitted)) return;
    lock.current = true;
    setBusy(true);
    try {
      const saved = await client.assistantRules();
      if (owned() && attempt.current === submitted) {
        setObserved(saved);
        read.commit(saved);
        setError(
          unknown.current && submitted && saved.revision <= submitted.revision
            ? "The saved revision has not advanced. The earlier replacement may still finish; keep checking before leaving."
            : "",
        );
      }
    } catch (failure) {
      if (owned()) setError(messageOf(failure, "Couldn't check saved rules."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const canAdoptObserved =
    !uncertain ||
    (!!observed &&
      !!attempt.current &&
      observed.revision > attempt.current.revision);
  const useSaved = async () => {
    const submitted = attempt.current;
    const saved = unknown.current ? observed : (observed ?? read.data);
    if (
      !owned() ||
      lock.current ||
      !saved ||
      (!read.fresh && !observed) ||
      (unknown.current && (!submitted || saved.revision <= submitted.revision))
    )
      return;
    const draft = latest.current;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        (dirty || unknown.current) &&
        !(await confirm({
          title: "Use saved assistant rules?",
          body: "Discard this local draft and keep the current saved rules.",
          action: "Use saved rules",
          danger: true,
        }))
      )
        return;
      if (
        !owned() ||
        latest.current !== draft ||
        attempt.current !== submitted ||
        (unknown.current &&
          (observation.current !== saved ||
            !submitted ||
            saved.revision <= submitted.revision))
      )
        return;
      read.commit(saved);
      setBase(saved);
      setRules(saved.rules);
      setEditing(null);
      setObserved(null);
      unknown.current = false;
      setUncertain(false);
      attempt.current = null;
      setError("");
      setStatus("Using the saved rules.");
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const savedView = uncertain ? observed : (observed ?? read.data);
  return (
    <SettingsSection
      title="Assistant rules"
      description="Restrictions for Orbyn's Chat, Background and Overnight agents. Rules restrict existing access; Block wins over Ask first, then Allow."
    >
      {read.loading && !rules && <Loading label="Loading assistant rules" />}
      {read.error && (
        <ErrorNotice
          message={read.error}
          onRetry={uncertain ? undefined : () => void read.reload()}
        />
      )}
      {error && <ErrorNotice message={error} />}{" "}
      {status && <p role="status">{status}</p>}
      {teams.error && (
        <ErrorNotice
          message={teams.error}
          onRetry={() => void teams.reload()}
        />
      )}
      {rules && (
        <>
          <p className="small muted">
            {rules.length} / 100 rules · Saved revision {base?.revision}
          </p>
          {rules.length === 0 && <p>No extra rules.</p>}
          <ul className="settings-automation-list">
            {rules.map((rule) => (
              <li key={rule.id}>
                {editing === rule.id ? (
                  <fieldset
                    className="settings-automation-fields"
                    disabled={frozen}
                  >
                    <legend>Edit rule</legend>
                    <Field label="Agent">
                      <SelectBox
                        value={rule.lane}
                        onChange={(event) => {
                          const lane = LANES.find(
                            (lane) => lane.id === event.target.value,
                          );
                          if (lane) update(rule.id, { ...rule, lane: lane.id });
                        }}
                      >
                        {LANES.map((lane) => (
                          <option key={lane.id} value={lane.id}>
                            {lane.name}
                          </option>
                        ))}
                      </SelectBox>
                    </Field>
                    <Field label="Action">
                      <SelectBox
                        value={rule.action}
                        onChange={(event) => {
                          const action = ASSISTANT_RULE_ACTIONS.find(
                            (action) => action === event.target.value,
                          );
                          if (action) update(rule.id, { ...rule, action });
                        }}
                      >
                        {ASSISTANT_RULE_ACTIONS.map((action) => (
                          <option key={action} value={action}>
                            {ACTIONS[action]}
                          </option>
                        ))}
                      </SelectBox>
                    </Field>
                    <Field label="Space">
                      <SelectBox
                        value={
                          rule.scope.kind === "team"
                            ? rule.scope.id
                            : rule.scope.kind
                        }
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "all" || value === "personal")
                            update(rule.id, {
                              ...rule,
                              scope: { kind: value },
                            });
                          else if (
                            teams.data?.some((team) => team.id === value)
                          )
                            update(rule.id, {
                              ...rule,
                              scope: { kind: "team", id: value },
                            });
                        }}
                      >
                        <option value="all">Every space</option>
                        <option value="personal">Personal</option>
                        {rule.scope.kind === "team" &&
                          !teams.data?.some(
                            (team) =>
                              rule.scope.kind === "team" &&
                              team.id === rule.scope.id,
                          ) && (
                            <option value={rule.scope.id}>
                              Unavailable team ({rule.scope.id})
                            </option>
                          )}
                        {teams.data?.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </SelectBox>
                    </Field>
                    <Field label="Rule">
                      <SelectBox
                        value={rule.decision}
                        onChange={(event) => {
                          const decision = DECISIONS.find(
                            (decision) => decision.id === event.target.value,
                          );
                          if (decision)
                            update(rule.id, { ...rule, decision: decision.id });
                        }}
                      >
                        {DECISIONS.map((decision) => (
                          <option key={decision.id} value={decision.id}>
                            {decision.name}
                          </option>
                        ))}
                      </SelectBox>
                    </Field>
                    {rule.action === "read" && rule.decision !== "allow" && (
                      <p className="small muted">Agents skip this space.</p>
                    )}
                  </fieldset>
                ) : (
                  <p>
                    {LANES.find((lane) => lane.id === rule.lane)?.name} ·{" "}
                    {ACTIONS[rule.action]} ·{" "}
                    {rule.scope.kind === "all"
                      ? "Every space"
                      : rule.scope.kind === "personal"
                        ? "Personal"
                        : (teams.data?.find(
                            (team) =>
                              rule.scope.kind === "team" &&
                              team.id === rule.scope.id,
                          )?.name ??
                          `Unavailable team (${rule.scope.id})`)}{" "}
                    ·{" "}
                    {
                      DECISIONS.find(
                        (decision) => decision.id === rule.decision,
                      )?.name
                    }
                  </p>
                )}
                <div className="settings-automation-actions">
                  <Button
                    disabled={frozen}
                    onClick={() => {
                      if (owned() && !lock.current && !unknown.current)
                        setEditing(editing === rule.id ? null : rule.id);
                    }}
                  >
                    {editing === rule.id ? "Done" : "Edit rule"}
                  </Button>
                  <Button
                    disabled={frozen}
                    onClick={() => {
                      if (owned() && !lock.current && !unknown.current) {
                        setRules(
                          (rows) =>
                            rows?.filter((row) => row.id !== rule.id) ?? null,
                        );
                        if (editing === rule.id) setEditing(null);
                      }
                    }}
                  >
                    Remove rule
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="settings-automation-actions">
            <Button
              disabled={frozen || rules.length >= 100 || !read.fresh}
              onClick={add}
            >
              Add rule
            </Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={
                confirming ||
                uncertain ||
                !dirty ||
                !read.fresh ||
                read.data?.revision !== base?.revision
              }
              onClick={() => void save()}
            >
              Save rules
            </Button>
            <Button disabled={busy || confirming} onClick={() => void check()}>
              {uncertain ? "Check saved rules" : "Refresh saved rules"}
            </Button>
            {!uncertain && read.fresh && (
              <Button
                disabled={busy || confirming || !dirty}
                onClick={() => void useSaved()}
              >
                Discard changes
              </Button>
            )}
          </div>
        </>
      )}
      {(uncertain ||
        observed ||
        (base && read.data && base.revision !== read.data.revision)) && (
        <div className="settings-automation-recovery">
          <p>
            {uncertain
              ? "The save is unconfirmed. Your draft cannot be sent again until you review saved rules."
              : "Review the current saved rules before replacing them."}
          </p>
          {savedView && (
            <>
              <details>
                <summary>Current saved rules</summary>
                <pre>{JSON.stringify(savedView?.rules, null, 2)}</pre>
              </details>
              <Button
                disabled={busy || confirming || !canAdoptObserved}
                onClick={() => void useSaved()}
              >
                Use saved rules
              </Button>
            </>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
