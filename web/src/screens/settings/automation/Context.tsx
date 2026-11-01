import {
  agentInstructionsInput,
  MAX_AGENT_INSTRUCTIONS,
  type AgentContextSettings,
  type AgentInstructions,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { navigate } from "../../../lib/router";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import {
  Button,
  ErrorNotice,
  Loading,
  TextArea,
  Field,
  useConfirm,
} from "../../../ui/kit";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";
import { unknownOutcome } from "./model";
type ContextAttempt =
  | Readonly<{ kind: "instructions"; teamId: string | null; text: string }>
  | Readonly<{ kind: "profile"; docId: string | null }>;
const validProfile = (profile: AgentContextSettings["profile"]) =>
  !!profile &&
  typeof profile.doc_id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    profile.doc_id,
  ) &&
  typeof profile.title === "string";
const matchesContext = (
  saved: AgentContextSettings,
  attempt: ContextAttempt,
) =>
  attempt.kind === "instructions"
    ? Array.isArray(saved?.instructions) &&
      saved.instructions.some(
        (row) => row.team_id === attempt.teamId && row.text === attempt.text,
      )
    : validProfile(saved?.profile) &&
      (!attempt.docId || saved.profile?.doc_id === attempt.docId);
export function AutomationContext() {
  const owned = useSettingsOwner(),
    confirm = useConfirm(),
    read = useSettingsRead(() => client.agentContext());
  const [editing, setEditing] = useState<AgentInstructions | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [observed, setObserved] = useState<AgentContextSettings | null>(null),
    [openDoc, setOpenDoc] = useState("");
  const lock = useRef(false),
    unknown = useRef(false),
    operation = useRef<"profile" | "instructions" | null>(null),
    current = useRef({ editing, text, observed });
  current.current = { editing, text, observed };
  const attempt = useRef<ContextAttempt | null>(null);
  const dirty = !!editing && text !== editing.text,
    frozen = busy || confirming || uncertain;
  useSettingsExit({
    dirty,
    pending: busy || confirming,
    sensitive: uncertain,
    message: uncertain
      ? "Check the unconfirmed context change before leaving."
      : undefined,
  });
  useEffect(() => {
    if (openDoc && !busy && owned()) {
      setOpenDoc("");
      navigate(`/app/doc/${encodeURIComponent(openDoc)}`);
    }
  }, [openDoc, busy, owned]);
  const edit = (row: AgentInstructions) => {
    if (
      !owned() ||
      lock.current ||
      unknown.current ||
      editing ||
      !read.fresh ||
      !row.can_edit
    )
      return;
    setEditing(row);
    setText(row.text);
    setError("");
    setStatus("");
  };
  const cancel = async () => {
    if (!owned() || lock.current || unknown.current) return;
    const captured = current.current;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard instruction changes?",
          action: "Discard changes",
          danger: true,
        }))
      )
        return;
      if (
        owned() &&
        current.current.editing === captured.editing &&
        current.current.text === captured.text
      )
        setEditing(null);
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const save = async () => {
    if (
      !owned() ||
      lock.current ||
      unknown.current ||
      !editing ||
      !dirty ||
      !read.fresh
    )
      return;
    const target = editing,
      allowed = read.data?.instructions.find(
        (row) => row.team_id === target.team_id,
      );
    if (!allowed?.can_edit) {
      setError("You can no longer change these instructions.");
      return;
    }
    const checked = agentInstructionsInput.safeParse({ text });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "Check these instructions.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const submitted: ContextAttempt = Object.freeze({
      kind: "instructions",
      teamId: target.team_id,
      text: checked.data.text,
    });
    attempt.current = submitted;
    setObserved(null);
    read.invalidate();
    operation.current = "instructions";
    try {
      const next = await client.setAgentInstructions(
        submitted.teamId,
        submitted.text,
      );
      if (
        !owned() ||
        current.current.editing !== target ||
        attempt.current !== submitted
      )
        return;
      if (!matchesContext(next, submitted))
        throw new Error(
          "The instruction receipt does not match the submitted space and text. Check saved context.",
        );
      read.commit(next);
      setEditing(null);
      operation.current = null;
      attempt.current = null;
      setStatus("Instructions saved.");
    } catch (failure) {
      if (owned()) {
        unknown.current = unknownOutcome(failure);
        setUncertain(unknown.current);
        setError(
          messageOf(failure, "Couldn't save instructions. Your draft is kept."),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const profile = async () => {
    if (!owned() || lock.current || unknown.current || editing || !read.fresh)
      return;
    if (read.data?.profile) {
      if (!validProfile(read.data.profile)) {
        setError(
          "The context-page identity is invalid. Refresh saved context before opening it.",
        );
        return;
      }
      navigate(`/app/doc/${encodeURIComponent(read.data.profile.doc_id)}`);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const submitted: ContextAttempt = Object.freeze({
      kind: "profile",
      docId: null,
    });
    attempt.current = submitted;
    setObserved(null);
    operation.current = "profile";
    read.invalidate();
    try {
      const made = await client.openAgentProfile();
      if (!owned() || attempt.current !== submitted) return;
      if (
        !validProfile({
          doc_id: made?.doc_id,
          title: made?.title,
          updated_at: "",
        }) ||
        typeof made.created !== "boolean"
      )
        throw new Error(
          "The context-page receipt has no valid document identity. Check saved context.",
        );
      const receiptAttempt: ContextAttempt = Object.freeze({
        kind: "profile",
        docId: made.doc_id,
      });
      attempt.current = receiptAttempt;
      const saved = await client.agentContext();
      if (!owned() || attempt.current !== receiptAttempt) return;
      if (!matchesContext(saved, receiptAttempt))
        throw new Error(
          "The saved context page does not match this receipt. Check saved context.",
        );
      read.commit(saved);
      operation.current = null;
      attempt.current = null;
      setOpenDoc(made.doc_id);
    } catch (failure) {
      if (owned()) {
        unknown.current =
          (attempt.current?.kind === "profile" && !!attempt.current.docId) ||
          unknownOutcome(failure);
        setUncertain(unknown.current);
        setError(
          messageOf(
            failure,
            "Couldn't confirm creation of the context page. Check context before trying again.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const check = async () => {
    const submitted = attempt.current;
    if (!owned() || lock.current || !unknown.current || !submitted) return;
    lock.current = true;
    setBusy(true);
    try {
      const saved = await client.agentContext();
      if (!owned() || attempt.current !== submitted) return;
      setObserved(saved);
      setError(
        matchesContext(saved, submitted)
          ? ""
          : submitted.kind === "profile"
            ? "No matching existing context page is confirmed. The earlier creation may still finish; keep checking."
            : "Saved instructions do not match the submitted space and text. The earlier save may still finish; keep checking.",
      );
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't check saved context."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const canAdopt =
    !!observed &&
    !!attempt.current &&
    matchesContext(observed, attempt.current);
  const keep = async () => {
    const submitted = attempt.current;
    if (
      !owned() ||
      lock.current ||
      !observed ||
      !unknown.current ||
      !submitted ||
      !matchesContext(observed, submitted)
    )
      return;
    const saved = observed;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        !(await confirm({
          title: "Use saved context?",
          body: "Discard this local change and keep the current saved context. This does not prove which request saved it.",
          action: "Use saved context",
          danger: true,
        }))
      )
        return;
      if (
        !owned() ||
        attempt.current !== submitted ||
        current.current.observed !== saved ||
        !matchesContext(saved, submitted)
      )
        return;
      read.commit(saved);
      unknown.current = false;
      setUncertain(false);
      setObserved(null);
      setEditing(null);
      operation.current = null;
      attempt.current = null;
      setError("");
      setStatus("Using the saved context.");
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  return (
    <SettingsSection
      title="Agent context"
      description="Your context page and instructions followed in each space."
    >
      {read.loading && !read.data && <Loading label="Loading agent context" />}
      {read.error && (
        <ErrorNotice
          message={read.error}
          onRetry={uncertain ? undefined : () => void read.reload()}
        />
      )}
      {error && <ErrorNotice message={error} />}{" "}
      {status && <p role="status">{status}</p>}
      {uncertain && (
        <div className="settings-automation-recovery">
          <p>
            The{" "}
            {operation.current === "profile"
              ? "page creation"
              : "instruction save"}{" "}
            is unconfirmed. No automatic retry will change your context.
          </p>
          <Button disabled={busy || confirming} onClick={() => void check()}>
            Check saved context
          </Button>
          {observed && (
            <>
              <p>
                {observed.profile
                  ? `Context page: ${observed.profile.title}`
                  : "No context page in this snapshot."}
              </p>
              <details>
                <summary>Current saved instructions</summary>
                {observed.instructions.map((row) => (
                  <div key={row.team_id ?? "personal"}>
                    <h5>{row.space}</h5>
                    <p className="settings-automation-verbatim">
                      {row.text || "No instructions"}
                    </p>
                  </div>
                ))}
              </details>
              <Button
                disabled={busy || confirming || !canAdopt}
                onClick={() => void keep()}
              >
                Use saved context
              </Button>
            </>
          )}
        </div>
      )}
      <div className="settings-automation-actions">
        <Button
          disabled={frozen || !!editing || !read.fresh}
          onClick={() => void profile()}
        >
          {read.data?.profile ? "Open context page" : "Create context page"}
        </Button>
        {!read.fresh && !uncertain && (
          <Button
            disabled={busy || confirming}
            onClick={() => void read.reload()}
          >
            Refresh saved context
          </Button>
        )}
      </div>
      {read.data?.profile && (
        <p className="small muted">
          Changed {new Date(read.data.profile.updated_at).toLocaleString()}
        </p>
      )}
      {editing ? (
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label={`Instructions for ${editing.space}`}>
            <TextArea
              rows={5}
              maxLength={MAX_AGENT_INSTRUCTIONS}
              value={text}
              disabled={frozen}
              onChange={(event) => {
                if (owned() && !lock.current && !unknown.current)
                  setText(event.target.value);
              }}
            />
          </Field>
          <p className="small muted">
            {text.length} / {MAX_AGENT_INSTRUCTIONS}
          </p>
          <div className="settings-automation-actions">
            <Button disabled={frozen} onClick={() => void cancel()}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={confirming || uncertain || !dirty || !read.fresh}
            >
              Save instructions
            </Button>
          </div>
        </form>
      ) : (
        <ul className="settings-automation-list">
          {read.data?.instructions.map((row) => (
            <li key={row.team_id ?? "personal"}>
              <strong dir="auto">{row.space}</strong>
              <p className="settings-automation-verbatim" dir="auto">
                {row.text || "No instructions"}
              </p>
              {row.updated_at && (
                <p className="small muted">
                  {row.updated_by ?? "Someone"}
                  {row.updated_via ? ` via ${row.updated_via}` : ""} ·{" "}
                  {new Date(row.updated_at).toLocaleString()}
                </p>
              )}
              {row.can_edit ? (
                <Button
                  disabled={frozen || !read.fresh}
                  aria-label={`Edit ${row.space} instructions`}
                  onClick={() => edit(row)}
                >
                  Edit instructions
                </Button>
              ) : (
                <p className="small muted">Read only</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
