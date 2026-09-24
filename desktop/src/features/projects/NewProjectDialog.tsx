import { useEffect, useState } from "react";
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
  const [brief, setBrief] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [state, setState] = useState<TurnState>("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the project a name.");
    if (!stages.length) return setError("Keep at least one stage.");
    setBusy(true);
    setError("");
    try {
      const project = await client.createProject({
        name: trimmed,
        summary: summary.trim(),
        team_id: teamId || null,
        // 5 pm on the day, where you are (the same rule as editing it).
        deadline: deadline
          ? projectDeadlineAt(deadline, null, deviceTimeZone())
          : null,
        stages,
      });
      onCreated(project);
    } catch (e) {
      setError(errorText(e));
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const draft = async () => {
    const text = [
      brief.trim(),
      deadline ? `It needs to be done by ${deadline}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (!brief.trim())
      return setError("Say what the project is for, in a sentence or two.");
    setBusy(true);
    setError("");
    try {
      setProposal(
        await client.draftProject(
          text,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          teamId || null,
        ),
      );
      setState("pending");
    } catch (e) {
      setError(errorText(e));
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!proposal) return;
    setBusy(true);
    try {
      await client.applyProposal(proposal.id);
      setState("applied");
      onCreated(null);
    } catch (e) {
      setError(errorText(e));
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const addStage = () => {
    const next = stageDraft.trim();
    if (!next || stages.includes(next) || stages.length >= 20) return;
    setStages([...stages, next]);
    setStageDraft("");
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <section
        className="modal new-project"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
      >
        <div className="section-heading">
          <h2 id="new-project-title">Start a project</h2>
          <button
            className="icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="new-project-body">
          <div className="segmented" role="tablist" aria-label="How to start">
            <button
              role="tab"
              aria-selected={mode === "manual"}
              className={mode === "manual" ? "active" : ""}
              onClick={() => {
                setMode("manual");
                setError("");
              }}
            >
              Set it up myself
            </button>
            <button
              role="tab"
              aria-selected={mode === "assistant"}
              className={mode === "assistant" ? "active" : ""}
              onClick={() => {
                setMode("assistant");
                setError("");
              }}
            >
              <Sparkles size={14} /> Describe it to the assistant
            </button>
          </div>

          {mode === "manual" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
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
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                  />
                </label>
              </div>
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
                        onClick={() => setStages(stages.filter((x) => x !== s))}
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
              {error && <p className="new-project-error">{error}</p>}
              <div className="button-row">
                <button
                  type="button"
                  className="text-button new-project-template"
                  onClick={onTemplates}
                >
                  <LayoutTemplate size={14} /> Start from a template
                </button>
                <button type="button" className="secondary" onClick={onClose}>
                  Cancel
                </button>
                <button className="primary" disabled={busy || !name.trim()}>
                  {busy ? "Creating…" : "Create project"}
                </button>
              </div>
            </form>
          ) : proposal ? (
            <div className="new-project-draft">
              <ProposalReview
                proposal={proposal}
                items={items}
                busy={busy}
                state={state}
                onApply={() => void approve()}
                onDismiss={() => {
                  setProposal(null);
                  setState("discarded");
                }}
              />
              {error && <p className="new-project-error">{error}</p>}
              {state === "applied" && (
                <div className="button-row">
                  <button className="primary" onClick={onClose}>
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
              <label>
                Describe the project
                <textarea
                  autoFocus
                  rows={6}
                  value={brief}
                  maxLength={1800}
                  placeholder="What you're trying to do, what's involved, and anything already decided. For example: Relaunch the pricing page before the October campaign — new copy, three plan tiers, a comparison table and sign-off from sales."
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
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                  />
                </label>
              </div>
              <p className="muted new-project-note">
                The assistant drafts the tasks, their order and estimates, and a
                schedule around your time. You review everything before anything
                is created.
              </p>
              {error && <p className="new-project-error">{error}</p>}
              <div className="button-row">
                <button type="button" className="secondary" onClick={onClose}>
                  Cancel
                </button>
                <button className="primary" disabled={busy || !brief.trim()}>
                  <Sparkles size={14} />{" "}
                  {busy ? "Drafting…" : "Draft the project"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
