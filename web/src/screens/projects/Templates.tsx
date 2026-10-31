import {
  describeRrule,
  findRepeat,
  firstRepeatDay,
  hasTeamPermission,
  localDateKey,
  repeatRrule,
  type ProjectTemplate,
  type Proposal,
} from "@orbyn/core";
import { ArrowLeft, Check, LayoutTemplate, Repeat, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Loading,
  SelectBox,
  useConfirm,
} from "../../ui/kit";
import { deviceTimeZone, usePlanning } from "../shared-task";
import { DraftReview } from "./DraftReview";

const SOURCE = { starter: "Starter", personal: "Yours", team: "Team" } as const;

const rhythmFrom = (text: string) => {
  const today = localDateKey(new Date(), deviceTimeZone());
  const found = findRepeat(text.trim(), today);
  if (!found || found.perPeriod) return null;
  const first = firstRepeatDay(found, today);
  return first ? repeatRrule(found, first) : null;
};

/** Start a project from a template, reviewed before anything is made. */
export function Templates({
  initialId,
  onClose,
  onStarted,
}: {
  initialId?: string | null;
  onClose: () => void;
  onStarted: () => void;
}) {
  const { teams } = usePlanning();
  const confirm = useConfirm();
  const list = useResource(() => client.listTemplates(), []);
  const [picked, setPicked] = useState<ProjectTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState("");
  const [rhythm, setRhythm] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const lock = useRef(false);
  const opened = useRef(false);
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );
  const choose = (t: ProjectTemplate) => {
    setPicked(t);
    setTitle(t.name);
    setTeamId(writable.some((team) => team.id === t.team_id) ? t.team_id! : "");
    setRhythm("");
    setProposal(null);
    setNote("");
    setError("");
  };
  useEffect(() => {
    if (opened.current || !list.data || !initialId) return;
    opened.current = true;
    const first = list.data.find((t) => t.id === initialId);
    if (first) choose(first);
    else setError("That template isn't available any more.");
  }, [list.data, initialId]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (failure) {
      setError(messageOf(failure, "That didn't work. Try again."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
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
      if (!picked || (picked.source !== "starter" && !picked.can_edit)) return;
      const rrule = rhythm.trim() ? rhythmFrom(rhythm) : null;
      if (rhythm.trim() && !rrule) {
        setError(
          'Try a rhythm like "every other Friday" or "first Monday of the month".',
        );
        return;
      }
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
      await list.reload();
    });
  const remove = async (t: ProjectTemplate) => {
    if (!t.can_edit || lock.current) return;
    const yes = await confirm({
      title: `Delete the template “${t.name}”?`,
      body: "Projects made from it stay as they are.",
      action: "Delete",
      danger: true,
    });
    if (!yes) return;
    await run(async () => {
      await client.deleteTemplate(t.id);
      setPicked(null);
      await list.reload();
    });
  };
  const groups = (["team", "personal", "starter"] as const)
    .map((source) => ({
      source,
      rows: (list.data ?? []).filter((t) => t.source === source),
    }))
    .filter((g) => g.rows.length);
  const heading = picked ? picked.name : "Templates";
  return (
    <Dialog
      title={heading}
      wide
      onClose={() => !busy && onClose()}
      actions={
        proposal?.project ? (
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setProposal(null)}
            >
              Back
            </Button>
            <Button
              variant="primary"
              busy={busy}
              onClick={() => void approve()}
            >
              <Check aria-hidden="true" /> Make the project
            </Button>
          </>
        ) : picked ? (
          <Button variant="primary" busy={busy} onClick={() => void review()}>
            Review the plan
          </Button>
        ) : undefined
      }
    >
      {picked && (
        <div>
          <IconButton
            label="All templates"
            disabled={busy}
            onClick={() => {
              setPicked(null);
              setProposal(null);
              setError("");
            }}
          >
            <ArrowLeft />
          </IconButton>
        </div>
      )}
      {list.error && (
        <ErrorNotice message={list.error} onRetry={() => void list.reload()} />
      )}
      {error && <ErrorNotice message={error} />}
      {list.loading && !list.data && <Loading label="Loading templates" />}
      {list.data?.length === 0 && <p className="muted">No templates yet.</p>}
      {!picked ? (
        groups.map((group) => (
          <section key={group.source}>
            <h3>
              {group.source === "starter"
                ? "Starters"
                : group.source === "team"
                  ? "Your teams'"
                  : "Yours"}
            </h3>
            <ul className="pj-templates">
              {group.rows.map((t) => (
                <li key={t.id}>
                  <button onClick={() => choose(t)}>
                    <LayoutTemplate aria-hidden="true" />
                    <span>
                      <strong dir="auto">{t.name}</strong>
                      <small dir="auto">
                        {t.description || `${t.tasks.length} tasks`}
                      </small>
                      <small>
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
      ) : proposal?.project ? (
        <>
          <p className="muted small">
            Nothing is made until you approve. The schedule uses your calendar
            as it is now.
          </p>
          <DraftReview project={proposal.project} />
          {proposal.project.page && (
            <p className="small">
              With a page:{" "}
              <strong dir="auto">{proposal.project.page.title}</strong>
            </p>
          )}
        </>
      ) : (
        <>
          <p className="muted" dir="auto">
            {picked.description}{" "}
            <span className="small">{SOURCE[picked.source]}</span>
          </p>
          <ol className="pj-template-tasks">
            {picked.tasks.map((t) => (
              <li key={t.id}>
                <span dir="auto">{t.title}</span>
                <small className="muted">
                  Day {t.due_in_days + 1} · {t.estimate_minutes} min
                  {t.target_value != null
                    ? ` · target ${t.target_value}${t.value_unit ? " " + t.value_unit : ""}`
                    : ""}
                </small>
              </li>
            ))}
          </ol>
          <Field label="Project name">
            <Input
              disabled={busy}
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          {writable.length > 0 && (
            <Field label="For">
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
          )}
          {(picked.source === "starter" || picked.can_edit) && (
            <details>
              <summary className="pj-summary">
                <Repeat aria-hidden="true" /> Repeat project
              </summary>
              <p className="muted small">
                {picked.rrule
                  ? `${describeRrule(picked.rrule)}. You're asked to review each one; nothing is made on its own.`
                  : "On a rhythm, you're asked to review the next one when it's due."}
              </p>
              <div className="pj-inline">
                <Input
                  disabled={busy}
                  aria-label="Rhythm, in words"
                  placeholder={
                    picked.rrule
                      ? "A new rhythm, or empty to stop"
                      : "every other Friday"
                  }
                  value={rhythm}
                  onChange={(event) => setRhythm(event.target.value)}
                />
                <Button disabled={busy} onClick={() => void saveRhythm()}>
                  {picked.source === "starter" ? "Save a copy" : "Save"}
                </Button>
              </div>
              {rhythm.trim() && (
                <small className="muted">
                  {rhythmFrom(rhythm)
                    ? describeRrule(rhythmFrom(rhythm))
                    : "Not a rhythm yet"}
                </small>
              )}
              {note && <p className="small">{note}</p>}
            </details>
          )}
          {picked.can_edit && (
            <details>
              <summary className="pj-summary">More options</summary>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void remove(picked)}
              >
                <Trash2 aria-hidden="true" /> Delete template
              </Button>
            </details>
          )}
        </>
      )}
    </Dialog>
  );
}
