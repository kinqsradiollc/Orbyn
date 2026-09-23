import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  LayoutTemplate,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import {
  describeRrule,
  findRepeat,
  hasTeamPermission,
  localDateKey,
  repeatRrule,
  firstRepeatDay,
  type ProjectTemplate,
  type Proposal,
  type Team,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { ProjectDraftReview } from "../../components/ProjectDraftReview";
import { useConfirm } from "../../components/Confirm";
import { Select } from "../../components/Select";
import { deviceTimeZone, errorText } from "../../lib/planning";

const SOURCE_LABEL = {
  starter: "Starter",
  personal: "Yours",
  team: "Team",
} as const;

/** A rhythm typed in plain words ("every other Friday"), as a rule. */
function rhythmFrom(text: string) {
  const zone = deviceTimeZone();
  const today = localDateKey(new Date(), zone);
  const found = findRepeat(text.trim(), today);
  if (!found || found.perPeriod) return null;
  const first = firstRepeatDay(found, today);
  return first ? repeatRrule(found, first) : null;
}

/**
 * Templates: start a project from one (reviewed before anything is made),
 * and look after your own and your teams'. Starters come from the server.
 */
export function TemplatesDialog({
  teams,
  initialId,
  onClose,
  onStarted,
}: {
  teams: Team[];
  /** Open on this template (from a "ready to start" notice). */
  initialId?: string | null;
  onClose: () => void;
  /** After a project was made from a template. */
  onStarted: () => void;
}) {
  const { ask } = useConfirm();
  const [templates, setTemplates] = useState<ProjectTemplate[] | null>(null);
  const [picked, setPicked] = useState<ProjectTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState<string>("");
  const [rhythm, setRhythm] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );

  const load = () =>
    client.listTemplates().then(
      (all) => {
        setTemplates(all);
        return all;
      },
      (e) => {
        setTemplates([]);
        setError(errorText(e));
      },
    );
  useEffect(() => {
    void load().then((all) => {
      const first = initialId && all?.find((t) => t.id === initialId);
      if (first) choose(first);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLElement>("button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = (t: ProjectTemplate) => {
    setPicked(t);
    setTitle(t.name);
    setTeamId(t.team_id ?? "");
    setRhythm("");
    setProposal(null);
    setNote("");
  };

  const review = () =>
    run(async () => {
      if (!picked) return;
      setProposal(
        await client.useTemplate(picked.id, {
          title: title.trim() || picked.name,
          team_id: teamId || null,
        }),
      );
    });
  const approve = () =>
    run(async () => {
      if (!proposal) return;
      await client.applyProposal(proposal.id);
      onStarted();
      onClose();
    });

  const saveRhythm = () =>
    run(async () => {
      if (!picked) return;
      const rrule = rhythm.trim() ? rhythmFrom(rhythm) : null;
      if (rhythm.trim() && !rrule) {
        setError(
          'Try a rhythm like "every other Friday" or "first Monday of the month".',
        );
        return;
      }
      // A starter becomes your own copy, which can have a rhythm.
      const saved =
        picked.source === "starter"
          ? await client.createTemplate({
              name: picked.name,
              description: picked.description,
              tasks: picked.tasks,
              page: picked.page,
              rrule,
            })
          : await client.updateTemplate(picked.id, { rrule });
      setPicked(saved);
      setRhythm("");
      setNote(
        saved.rrule
          ? `Saved. ${describeRrule(saved.rrule)}, you'll be asked to review the next one.`
          : "Saved. It no longer starts itself.",
      );
      await load();
    });

  const remove = (t: ProjectTemplate) =>
    void (async () => {
      if (
        !(await ask({
          title: `Delete the template “${t.name}”?`,
          body: "Projects made from it stay as they are.",
          confirmLabel: "Delete",
          destructive: true,
        }))
      )
        return;
      await run(async () => {
        await client.deleteTemplate(t.id);
        setPicked(null);
        await load();
      });
    })();

  const groups = (["team", "personal", "starter"] as const)
    .map((source) => ({
      source,
      list: (templates ?? []).filter((t) => t.source === source),
    }))
    .filter((g) => g.list.length);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={root}
        className="modal templates-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="templates-title"
      >
        <div className="section-heading">
          {picked && (
            <button
              className="icon-button"
              aria-label="All templates"
              onClick={() => {
                setPicked(null);
                setProposal(null);
              }}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <h2 id="templates-title">{picked ? picked.name : "Templates"}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="templates-body">
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {!picked ? (
            templates === null ? (
              <p className="muted">Loading…</p>
            ) : (
              groups.map((g) => (
                <section key={g.source} className="templates-group">
                  <h3>
                    {g.source === "starter"
                      ? "Starters"
                      : g.source === "team"
                        ? "Your teams'"
                        : "Yours"}
                  </h3>
                  <ul className="templates-list">
                    {g.list.map((t) => (
                      <li key={t.id}>
                        <button
                          className="template-card"
                          onClick={() => choose(t)}
                        >
                          <LayoutTemplate size={16} aria-hidden="true" />
                          <span>
                            <strong>{t.name}</strong>
                            <small>
                              {t.description || `${t.tasks.length} tasks`}
                            </small>
                            <small className="template-meta">
                              {t.tasks.length} tasks
                              {t.team_name ? ` · ${t.team_name}` : ""}
                              {t.rrule ? ` · ${describeRrule(t.rrule)}` : ""}
                            </small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )
          ) : proposal?.project ? (
            <>
              <p className="muted">
                Nothing is made until you approve. The schedule uses your
                calendar as it is now.
              </p>
              <ProjectDraftReview project={proposal.project} />
              {proposal.project.page && (
                <p className="template-page-note">
                  With a page: <strong>{proposal.project.page.title}</strong>
                </p>
              )}
              <div className="confirm-actions">
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => setProposal(null)}
                >
                  Back
                </button>
                <button className="primary" disabled={busy} onClick={approve}>
                  <Check size={15} /> Make the project
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                {picked.description}{" "}
                <span className="template-source">
                  {SOURCE_LABEL[picked.source]}
                </span>
              </p>
              <ol className="template-tasks">
                {picked.tasks.map((t) => (
                  <li key={t.id}>
                    <span>{t.title}</span>
                    <small className="muted">
                      Day {t.due_in_days + 1} · {t.estimate_minutes} min
                      {t.target_value != null
                        ? ` · target ${t.target_value}${t.value_unit ? " " + t.value_unit : ""}`
                        : ""}
                    </small>
                  </li>
                ))}
              </ol>
              <label>
                Project name
                <input
                  value={title}
                  maxLength={120}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              {writable.length > 0 && (
                <label>
                  For
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
              )}
              <div className="confirm-actions">
                <button className="primary" disabled={busy} onClick={review}>
                  Review the plan
                </button>
              </div>

              {(picked.source === "starter" || picked.can_edit) && (
                <div className="template-rhythm">
                  <h3>
                    <Repeat size={14} aria-hidden="true" /> Start itself
                  </h3>
                  <p className="muted">
                    {picked.rrule
                      ? `${describeRrule(picked.rrule)}. You're asked to review each one; nothing is made on its own.`
                      : "On a rhythm, you're asked to review the next one when it's due."}
                  </p>
                  <div className="template-rhythm-row">
                    <input
                      aria-label="Rhythm, in words"
                      placeholder={
                        picked.rrule
                          ? "A new rhythm, or empty to stop"
                          : "every other Friday"
                      }
                      value={rhythm}
                      onChange={(e) => setRhythm(e.target.value)}
                    />
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={saveRhythm}
                    >
                      {picked.source === "starter" ? "Save a copy" : "Save"}
                    </button>
                  </div>
                  {rhythm.trim() && (
                    <small className="muted">
                      {rhythmFrom(rhythm)
                        ? describeRrule(rhythmFrom(rhythm))
                        : "Not a rhythm yet"}
                    </small>
                  )}
                  {note && <small className="template-note">{note}</small>}
                </div>
              )}
              {picked.can_edit && (
                <button
                  className="text-button template-delete"
                  disabled={busy}
                  onClick={() => remove(picked)}
                >
                  <Trash2 size={14} /> Delete template
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
