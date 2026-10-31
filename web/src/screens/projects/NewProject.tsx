import {
  DEFAULT_STAGES,
  TEMPLATE_STARTERS,
  hasTeamPermission,
  projectDeadlineAt,
  workspacePresets,
  type Project,
  type Proposal,
} from "@orbyn/core";
import { LayoutTemplate, Plus, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Segmented,
  SelectBox,
  TextArea,
  useConfirm,
} from "../../ui/kit";
import { deviceTimeZone, usePlanning } from "../shared-task";
import { usePrefs } from "../today/prefs";
import { DraftReview } from "./DraftReview";

type Mode = "manual" | "assistant";

/**
 * Start a project yourself, or describe it and review a draft. A draft is
 * only a proposal: nothing exists until it is approved here.
 */
export function NewProject({
  onClose,
  onCreated,
  onTemplates,
}: {
  onClose: () => void;
  onCreated: (project: Project | null) => void;
  onTemplates: (id?: string) => void;
}) {
  const { teams } = usePlanning();
  const { prefs } = usePrefs();
  const confirm = useConfirm();
  const presets = workspacePresets(prefs.views.workspace);
  const engineer = presets.includes("engineer");
  const student = presets.includes("student");
  const starterIds = new Set([
    ...(engineer ? ["starter:sprint", "starter:retro"] : []),
    ...(student ? ["starter:weekly"] : []),
  ]);
  const starters = TEMPLATE_STARTERS.filter((s) => starterIds.has(s.id));
  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [teamId, setTeamId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [stages, setStages] = useState([...DEFAULT_STAGES]);
  const [stageDraft, setStageDraft] = useState("");
  const [stagesOpen, setStagesOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [giveDeadlines, setGiveDeadlines] = useState(true);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Project | null>(null);
  const lock = useRef(false);
  const requests = useRef(new Map<string, string>());
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );

  const close = async (next: () => void = onClose) => {
    if (lock.current) return;
    const dirty =
      !applied &&
      !created &&
      (name.trim() ||
        summary.trim() ||
        brief.trim() ||
        stageDraft.trim() ||
        deadline ||
        teamId ||
        JSON.stringify(stages) !== JSON.stringify(DEFAULT_STAGES) ||
        proposal);
    if (
      dirty &&
      !(await confirm({
        title: "Discard this project draft?",
        action: "Discard",
        danger: true,
      }))
    )
      return;
    next();
  };

  const guarded = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (failure) {
      setError(
        messageOf(failure, "That didn't work. Your draft is still here."),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const create = () => {
    if (created) return onCreated(created);
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the project a name.");
    if (stageDraft.trim()) {
      setStagesOpen(true);
      return setError("Add or clear the unfinished stage.");
    }
    if (teamId && !writable.some((t) => t.id === teamId))
      return setError("Choose a project space you can edit.");
    if (!stages.length) {
      setStagesOpen(true);
      return setError("Keep at least one stage.");
    }
    return void guarded(async () => {
      const input = {
        name: trimmed,
        summary: summary.trim(),
        team_id: teamId || null,
        deadline: deadline
          ? projectDeadlineAt(deadline, null, deviceTimeZone())
          : null,
        stages,
      };
      const key = JSON.stringify(input);
      let id = requests.current.get(key);
      if (!id) {
        id = crypto.randomUUID();
        requests.current.set(key, id);
      }
      const project = await client.once(id, () => client.createProject(input));
      setCreated(project);
      onCreated(project);
    });
  };

  const draft = () => {
    if (teamId && !writable.some((t) => t.id === teamId))
      return setError("Choose a project space you can edit.");
    if (!brief.trim())
      return setError("Say what the project is for, in a sentence or two.");
    return void guarded(async () => {
      const text = [
        brief.trim(),
        deadline ? `It needs to be done by ${deadline}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      setProposal(
        await client.draftProject(text, deviceTimeZone(), teamId || null, {
          summary: brief.trim(),
          deadline: deadline
            ? projectDeadlineAt(deadline, null, deviceTimeZone())
            : null,
        }),
      );
      setApplied(false);
    });
  };

  const approve = () =>
    guarded(async () => {
      if (!proposal || applied) return;
      const { project_id } = await client.applyProposal(proposal.id, {
        give_tasks_deadlines: giveDeadlines,
      });
      setApplied(true);
      const project = project_id
        ? await client.getProject(project_id).catch(() => null)
        : null;
      if (project) setCreated(project);
      onCreated(project);
    });

  const addStage = () => {
    const next = stageDraft.trim();
    if (!next || stages.includes(next) || stages.length >= 20) return;
    setStages([...stages, next]);
    setStageDraft("");
  };

  const whose = (
    <div className="pj-pair">
      <Field label="Whose project">
        <SelectBox
          disabled={busy}
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
        >
          <option value="">Just me</option>
          {writable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectBox>
      </Field>
      <Field label="Deadline (optional)">
        <Input
          type="date"
          disabled={busy}
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
        />
      </Field>
    </div>
  );
  const actions =
    mode === "manual" ? (
      <>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void close(() => onTemplates())}
        >
          <LayoutTemplate aria-hidden="true" /> From a template
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void close()}>
          Cancel
        </Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={!name.trim()}
          onClick={create}
        >
          {busy ? "Creating…" : created ? "Open project" : "Create project"}
        </Button>
      </>
    ) : proposal ? (
      <>
        <Button
          variant="ghost"
          disabled={busy || applied}
          onClick={() => {
            setError("");
            setProposal(null);
          }}
        >
          Discard draft
        </Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={applied}
          onClick={() => void approve()}
        >
          Create project
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" disabled={busy} onClick={() => void close()}>
          Cancel
        </Button>
        <Button
          variant="primary"
          busy={busy}
          disabled={!brief.trim()}
          onClick={draft}
        >
          <Sparkles aria-hidden="true" />{" "}
          {busy ? "Drafting…" : "Draft the project"}
        </Button>
      </>
    );
  return (
    <Dialog
      title="Start a project"
      onClose={() => void close()}
      actions={actions}
    >
      {starters.length > 0 && (
        <section aria-label="Project starters">
          <h3>Project starters</h3>
          <p className="muted small">
            Review the tasks and brief before creating a project.
          </p>
          <div className="pj-row-wrap">
            {starters.map((starter) => (
              <Button
                key={starter.id}
                disabled={busy}
                title={starter.description}
                onClick={() => void close(() => onTemplates(starter.id))}
              >
                <LayoutTemplate aria-hidden="true" /> {starter.name}
              </Button>
            ))}
          </div>
        </section>
      )}
      <Segmented
        label="How to start"
        value={mode}
        options={[
          { value: "manual", label: "Manual" },
          { value: "assistant", label: "Assistant" },
        ]}
        onChange={(next) => {
          if (busy) return;
          setMode(next);
          setError("");
        }}
      />
      {mode === "manual" ? (
        <>
          <Field label="Name">
            <Input
              autoFocus
              disabled={busy}
              maxLength={120}
              value={name}
              placeholder={
                engineer && student
                  ? "Project, course or assignment"
                  : student
                    ? "Course or assignment"
                    : engineer
                      ? "Feature or investigation"
                      : "Launch the new pricing page"
              }
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  create();
                }
              }}
            />
          </Field>
          <Field label="What it's for (optional)">
            <TextArea
              rows={3}
              disabled={busy}
              maxLength={2000}
              value={summary}
              placeholder={
                student && !engineer
                  ? "Course material, assessment dates and what you need to prepare."
                  : "The goal, and how you'll know it's done."
              }
              onChange={(event) => setSummary(event.target.value)}
            />
          </Field>
          {whose}
          <details
            open={stagesOpen}
            onToggle={(event) => setStagesOpen(event.currentTarget.open)}
          >
            <summary className="pj-summary">Project stages</summary>
            <ul className="pj-stage-edit">
              {stages.map((stage) => (
                <li key={stage}>
                  <span dir="auto">{stage}</span>
                  <IconButton
                    label={`Remove stage ${stage}`}
                    onClick={() => setStages(stages.filter((x) => x !== stage))}
                  >
                    <X />
                  </IconButton>
                </li>
              ))}
            </ul>
            <div className="pj-inline">
              <Input
                aria-label="New stage"
                placeholder="Add a stage"
                value={stageDraft}
                maxLength={60}
                onChange={(event) => setStageDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addStage();
                  }
                }}
              />
              <Button disabled={!stageDraft.trim()} onClick={addStage}>
                <Plus aria-hidden="true" /> Add
              </Button>
            </div>
          </details>
        </>
      ) : proposal ? (
        <>
          {proposal.project ? (
            <DraftReview project={proposal.project} />
          ) : (
            <p dir="auto">{proposal.summary}</p>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={giveDeadlines}
              disabled={busy || applied}
              onChange={(event) => setGiveDeadlines(event.target.checked)}
            />
            Give tasks deadlines from this plan
          </label>
        </>
      ) : (
        <>
          <Field label="Describe the project">
            <TextArea
              autoFocus
              rows={6}
              disabled={busy}
              maxLength={1800}
              value={brief}
              placeholder="Goal, deadline and key requirements"
              onChange={(event) => setBrief(event.target.value)}
            />
          </Field>
          {whose}
          <p className="muted small">
            Review the draft before creating tasks and a schedule.
          </p>
        </>
      )}
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}
