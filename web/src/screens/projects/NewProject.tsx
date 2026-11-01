import "./NewProject.css";
import { useAccount } from "../../app/account";
import type { RouteResult } from "../../lib/route-scope";
import {
  HttpError,
  DEFAULT_STAGES,
  TEMPLATE_STARTERS,
  hasTeamPermission,
  projectDeadlineAt,
  workspacePresets,
  type Project,
  type Proposal,
} from "@orbyn/core";
import { LayoutTemplate, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { client, getSessionVersion } from "../../lib/session";
import {
  Button,
  Dialog,
  type DialogPortalLease,
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
  onCreated: (project: Project | null) => void | Promise<RouteResult | void>;
  onTemplates: (id?: string) => void;
}) {
  const { user } = useAccount();
  const [openingGeneration] = useState(getSessionVersion),
    mounted = useRef(true),
    portalLease = useRef<DialogPortalLease | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const owned = () =>
    mounted.current && openingGeneration === getSessionVersion();
  const handoffLock = useRef(false);
  const handoffCreated = async (project: Project | null) => {
    if (!owned() || handoffLock.current) return;
    handoffLock.current = true;
    setBusy(true);
    if (project) portalLease.current?.retire();
    try {
      const result = await onCreated(project);
      if (!owned()) return;
      if (!result || result.kind !== "committed") {
        portalLease.current?.restore();
        if (result)
          setError(
            result.kind === "refused"
              ? `Project saved, but ${result.reason}`
              : "Project saved. Opening it was interrupted; use Open project to try again.",
          );
      }
    } catch (failure) {
      if (owned()) {
        portalLease.current?.restore();
        setError(
          messageOf(failure, "Project saved, but it couldn't be opened."),
        );
      }
    } finally {
      handoffLock.current = false;
      if (owned()) setBusy(lock.current);
    }
  };
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
  const [unknown, setUnknown] = useState(false);
  const unresolved = useRef(false);
  type CreateInput = Parameters<typeof client.createProject>[0];
  const createAttempt = useRef<{
    input: CreateInput;
    key: string;
    started: number;
  } | null>(null);
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );

  const close = async (next: () => void = onClose) => {
    if (!owned() || lock.current || handoffLock.current) return;
    if (unresolved.current) {
      setError(
        "The previous result is unconfirmed. Keep its original attempt here until it can be resolved.",
      );
      return;
    }
    lock.current = true;
    try {
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
      if (owned()) next();
    } finally {
      lock.current = false;
    }
  };

  const guarded = async (fn: () => Promise<void>, retry = false) => {
    if (!owned() || lock.current || (unresolved.current && !retry)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (failure) {
      if (!owned()) return;
      const status = failure instanceof HttpError ? failure.statusCode : 0;
      const uncertain =
        retry || !status || status >= 500 || status === 408 || status === 429;
      unresolved.current = uncertain;
      setUnknown(uncertain);
      if (!uncertain) createAttempt.current = null;
      setError(
        uncertain
          ? "The result is unconfirmed. Its original attempt is retained; changing or abandoning it could duplicate saved work."
          : messageOf(failure, "That didn't work. Your draft is still here."),
      );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };

  const sendCreate = async (
    attempt: NonNullable<typeof createAttempt.current>,
  ) => {
    const elapsed = Date.now() - attempt.started;
    if (!owned() || elapsed < 0 || elapsed >= 23 * 60 * 60 * 1000)
      throw new Error(
        "The original request can no longer be safely replayed. Keep this attempt for reconciliation.",
      );
    const result = await client.once(attempt.key, () =>
      client.createProject(attempt.input),
    );
    if (!owned()) return result;
    const input = attempt.input;
    if (
      !result ||
      typeof result.id !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(result.id) ||
      result.user_id !== user?.id ||
      result.team_id !== (input.team_id ?? null) ||
      result.name !== input.name ||
      result.summary !== (input.summary ?? "") ||
      (result.deadline === null ? null : Date.parse(result.deadline)) !==
        (input.deadline ? Date.parse(input.deadline) : null) ||
      !Array.isArray(result.stages) ||
      JSON.stringify(result.stages.map((stage) => stage.name)) !==
        JSON.stringify(input.stages)
    )
      throw new Error(
        "The project receipt does not match the original request. Keep the attempt for reconciliation.",
      );
    unresolved.current = false;
    setUnknown(false);
    return result;
  };
  const retryCreate = () => {
    const attempt = createAttempt.current;
    if (!attempt || !unresolved.current) return;
    void guarded(async () => {
      const project = await sendCreate(attempt);
      if (!owned()) return;
      setCreated(project);
      await handoffCreated(project);
    }, true);
  };

  const create = () => {
    if (created) return void handoffCreated(created);
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
      const attempt = {
        input: structuredClone(input),
        key: crypto.randomUUID(),
        started: Date.now(),
      };
      createAttempt.current = attempt;
      const project = await sendCreate(attempt);
      if (!owned()) return;
      setCreated(project);
      await handoffCreated(project);
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
      const nextProposal = await client.draftProject(
        text,
        deviceTimeZone(),
        teamId || null,
        {
          summary: brief.trim(),
          deadline: deadline
            ? projectDeadlineAt(deadline, null, deviceTimeZone())
            : null,
        },
      );
      if (!owned()) return;
      setProposal(nextProposal);
      setApplied(false);
    });
  };

  const approve = () =>
    guarded(async () => {
      if (!proposal || applied) return;
      const { project_id } = await client.applyProposal(proposal.id, {
        give_tasks_deadlines: giveDeadlines,
      });
      if (!owned()) return;
      setApplied(true);
      const project = project_id
        ? await client.getProject(project_id).catch(() => null)
        : null;
      if (!owned()) return;
      if (project) setCreated(project);
      await handoffCreated(project);
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
  const actions = unknown ? (
    <>
      {createAttempt.current && (
        <Button busy={busy} onClick={retryCreate}>
          Retry original request
        </Button>
      )}
      <span role="status">Unconfirmed result · original setup kept</span>
    </>
  ) : mode === "manual" ? (
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
      portalLease={portalLease}
      title="Start a project"
      onClose={() => void close()}
      actions={actions}
    >
      <fieldset
        className="pj-new-fields"
        disabled={busy || !!created || unknown}
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
                      onClick={() =>
                        setStages(stages.filter((x) => x !== stage))
                      }
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
      </fieldset>
    </Dialog>
  );
}
