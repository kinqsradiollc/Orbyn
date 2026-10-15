import { useEffect, useId, useRef, useState } from "react";
import { LayoutTemplate, Plus, Sparkles, X } from "lucide-react";
import {
  DEFAULT_STAGES,
  hasTeamPermission,
  projectDeadlineAt,
  type Item,
  type Project,
  type Proposal,
  type Team,
} from "@orbyn/core";
import { useModalFocus } from "../../hooks/useModalFocus";
import { useConfirm } from "../../components/Confirm";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import { DateField } from "../../components/DateField";
import { Select } from "../../components/Select";
import { ProposalReview } from "../../components/ProposalReview";
import type { TurnState } from "../../hooks/useAssistant";
import { errorText } from "../../lib/errors";
import { deviceTimeZone } from "../../lib/planning";

type Mode = "manual" | "assistant";

/**
 * Starting a project, in a dialog like a new item: set it up yourself (name,
 * what it's for, whose it is, when it's due, its stages) or describe it and
 * let the assistant draft the tasks, estimates and schedule. The assistant's
 * draft is only a proposal — nothing is created until it's approved here.
 */
export function NewProjectDialog({
  teams,
  items,
  onClose,
  onCreated,
  onTemplates,
  report,
}: {
  teams: Team[];
  items: Item[];
  onClose: () => void;
  /** A project made by hand opens straight away; a drafted one reloads the list. */
  onCreated: (project: Project | null) => void;
  onTemplates: () => void;
  report: (e: unknown) => void;
}) {
  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [teamId, setTeamId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [stages, setStages] = useState<string[]>([...DEFAULT_STAGES]);
  const [stageDraft, setStageDraft] = useState("");
  const [stagesOpen, setStagesOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [state, setState] = useState<TurnState>("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { ask } = useConfirm();
  const titleId = useId();
  const owner = useRef(session.get());
  const mounted = useRef(false);
  const lock = useRef(false);
  const [created, setCreated] = useState<Project | null>(null);
  const requests = useRef(new Map<string, string>());
  const current = () => mounted.current && owner.current === session.get();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const close = async (next = onClose) => {
    if (lock.current || !current()) return;
    if (
      state !== "applied" &&
      !created &&
      (name.trim() ||
        summary.trim() ||
        brief.trim() ||
        stageDraft.trim() ||
        deadline ||
        teamId ||
        JSON.stringify(stages) !== JSON.stringify(DEFAULT_STAGES) ||
        proposal)
    ) {
      lock.current = true;
      setBusy(true);
      const discard = await ask({
        title: "Discard this project draft?",
        confirmLabel: "Discard",
        destructive: true,
      });
      lock.current = false;
      if (!current()) return;
      setBusy(false);
      if (!discard) return;
    }
    next();
  };
  const modal = useModalFocus(() => void close(), busy);

  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );

  const create = async () => {
    if (lock.current || !current()) return;
    if (created) {
      onCreated(created);
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the project a name.");
    if (stageDraft.trim()) {
      setStagesOpen(true);
      return setError("Add or clear the unfinished stage.");
    }
    if (teamId && !writable.some((team) => team.id === teamId))
      return setError("Choose a project space you can edit.");
    if (!stages.length) {
      setStagesOpen(true);
      return setError("Keep at least one stage.");
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const input = {
        name: trimmed,
        summary: summary.trim(),
        team_id: teamId || null,
        // 5 pm on the day, where you are (the same rule as editing it).
        deadline: deadline
          ? projectDeadlineAt(deadline, null, deviceTimeZone())
          : null,
        stages,
      };
      const key = JSON.stringify(input);
      let requestId = requests.current.get(key);
      if (!requestId) {
        requestId = crypto.randomUUID();
        requests.current.set(key, requestId);
      }
      const project = await client.once(requestId, () =>
        client.createProject(input),
      );
      if (!current()) return;
      setCreated(project);
      onCreated(project);
    } catch (e) {
      if (current()) {
        setError(errorText(e));
        report(e);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };

  const draft = async () => {
    if (lock.current || !current()) return;
    if (teamId && !writable.some((team) => team.id === teamId))
      return setError("Choose a project space you can edit.");
    const text = [
      brief.trim(),
      deadline ? `It needs to be done by ${deadline}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (!brief.trim())
      return setError("Say what the project is for, in a sentence or two.");
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await client.draftProject(
        text,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        teamId || null,
        {
          summary: brief.trim(),
          deadline: deadline
            ? projectDeadlineAt(deadline, null, deviceTimeZone())
            : null,
        },
      );
      if (!current()) return;
      setProposal(next);
      setState("pending");
    } catch (e) {
      if (current()) {
        setError(errorText(e));
        report(e);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };

  const approve = async (giveTasksDeadlines = true) => {
    if (!proposal || state === "applied" || lock.current || !current()) return;
    lock.current = true;
    setError("");
    setBusy(true);
    try {
      const { project_id } = await client.applyProposal(proposal.id, {
        give_tasks_deadlines: giveTasksDeadlines,
      });
      if (!current()) return;
      setState("applied");
      const project = project_id
        ? await client.getProject(project_id).catch(() => null)
        : null;
      if (!current()) return;
      if (project) setCreated(project);
      onCreated(project);
    } catch (e) {
      if (current()) {
        setError(errorText(e));
        report(e);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };

  const addStage = () => {
    if (lock.current) return;
    const next = stageDraft.trim();
    if (!next || stages.includes(next) || stages.length >= 20) return;
    setStages([...stages, next]);
    setStageDraft("");
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && void close()}
    >
      <section
        ref={modal.ref}
        data-modal-focus={modal.id}
        tabIndex={-1}
        className="modal new-project"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="section-heading">
          <h2 id={titleId}>Start a project</h2>
          <button
            className="icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={() => void close()}
          >
            <X size={20} />
          </button>
        </div>

        <div className="new-project-body">
          <div className="segmented" role="group" aria-label="How to start">
            <button
              disabled={busy}
              aria-pressed={mode === "manual"}
              className={mode === "manual" ? "active" : ""}
              onClick={() => {
                setMode("manual");
                setError("");
              }}
            >
              Manual
            </button>
            <button
              disabled={busy}
              aria-pressed={mode === "assistant"}
              className={mode === "assistant" ? "active" : ""}
              onClick={() => {
                setMode("assistant");
                setError("");
              }}
            >
              <Sparkles size={14} /> Assistant
            </button>
          </div>

          {mode === "manual" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <fieldset disabled={busy} className="new-project-form-fields">
                <label>
                  Name
                  <input
                    autoFocus
                    value={name}
                    maxLength={120}
                    placeholder="Launch the new pricing page"
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  What it&apos;s for (optional)
                  <textarea
                    rows={3}
                    value={summary}
                    maxLength={2000}
                    placeholder="The goal, and how you'll know it's done."
                    onChange={(e) => setSummary(e.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Whose project
                    <Select
                      value={teamId}
                      onChange={(e) => setTeamId(e.target.value)}
                    >
                      <option value="">Just me</option>
                      {writable.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Deadline (optional)
                    <DateField
                      disabled={busy}
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                    />
                  </label>
                </div>
                <details
                  open={stagesOpen}
                  onToggle={(event) => setStagesOpen(event.currentTarget.open)}
                >
                  <summary>Project stages</summary>
                  <fieldset className="new-project-stages">
                    <legend>Stages</legend>
                    <ul>
                      {stages.map((s) => (
                        <li key={s}>
                          <span>{s}</span>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Remove stage ${s}`}
                            onClick={() =>
                              setStages(stages.filter((x) => x !== s))
                            }
                          >
                            <X size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="new-project-stage-add">
                      <input
                        aria-label="New stage"
                        placeholder="Add a stage"
                        value={stageDraft}
                        maxLength={60}
                        onChange={(e) => setStageDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addStage();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="secondary"
                        disabled={!stageDraft.trim()}
                        onClick={addStage}
                      >
                        <Plus size={14} /> Add
                      </button>
                    </div>
                  </fieldset>
                </details>
                {error && (
                  <p role="alert" className="new-project-error">
                    {error}
                  </p>
                )}
                <div className="button-row">
                  <button
                    type="button"
                    className="text-button new-project-template"
                    onClick={() => void close(onTemplates)}
                  >
                    <LayoutTemplate size={14} /> Start from a template
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void close()}
                  >
                    Cancel
                  </button>
                  <button className="primary" disabled={busy || !name.trim()}>
                    {busy
                      ? "Creating…"
                      : created
                        ? "Open project"
                        : "Create project"}
                  </button>
                </div>
              </fieldset>
            </form>
          ) : proposal ? (
            <div className="new-project-draft">
              <ProposalReview
                proposal={proposal}
                items={items}
                busy={busy}
                state={state}
                onApply={(giveTasksDeadlines) =>
                  void approve(giveTasksDeadlines)
                }
                onDismiss={() => {
                  if (lock.current || !current()) return;
                  setError("");
                  setProposal(null);
                  setState("discarded");
                }}
              />
              {error && (
                <p role="alert" className="new-project-error">
                  {error}
                </p>
              )}
              {state === "applied" && (
                <div className="button-row">
                  <button className="primary" onClick={() => void close()}>
                    Done
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void draft();
              }}
            >
              <fieldset disabled={busy} className="new-project-form-fields">
                <label>
                  Describe the project
                  <textarea
                    autoFocus
                    rows={6}
                    value={brief}
                    maxLength={1800}
                    placeholder="Goal, deadline and key requirements"
                    onChange={(e) => setBrief(e.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Whose project
                    <Select
                      value={teamId}
                      onChange={(e) => setTeamId(e.target.value)}
                    >
                      <option value="">Just me</option>
                      {writable.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Deadline (optional)
                    <DateField
                      disabled={busy}
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                    />
                  </label>
                </div>
                <p className="muted new-project-note">
                  Review the draft before creating tasks and a schedule.
                </p>
                {error && (
                  <p role="alert" className="new-project-error">
                    {error}
                  </p>
                )}
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void close()}
                  >
                    Cancel
                  </button>
                  <button className="primary" disabled={busy || !brief.trim()}>
                    <Sparkles size={14} />{" "}
                    {busy ? "Drafting…" : "Draft the project"}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
