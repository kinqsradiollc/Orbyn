import {
  HttpError,
  hasTeamPermission,
  tagInput,
  tagUpdate,
  type Tag,
} from "@orbyn/core";
import { useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Loading,
  SelectBox,
  useConfirm,
} from "../../ui/kit";
import { refreshPlanner, Swatches, SWATCHES } from "../shared-task";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "./shared";

type Draft = { id: string | null; name: string; color: string; team: string };
type Attempt = {
  kind: "create" | "update" | "delete";
  draft: Draft;
  before: string[];
};
const same = (tag: Tag, draft: Draft) =>
  tag.name === draft.name.trim() &&
  tag.color.toLowerCase() === draft.color.toLowerCase() &&
  tag.team_id === (draft.team || null);
const uncertain = (failure: unknown) =>
  !(failure instanceof HttpError) ||
  failure.statusCode >= 500 ||
  [408, 429].includes(failure.statusCode);

export function TagSettings() {
  const owned = useSettingsOwner();
  const confirm = useConfirm();
  const read = useSettingsRead(async () => {
    const [tags, teams] = await Promise.all([
      client.listTags(),
      client.listTeams(),
    ]);
    return { tags, teams };
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unknown, setUnknown] = useState<Attempt | null>(null);
  const [candidates, setCandidates] = useState<Tag[]>([]);
  const lock = useRef(false);
  const current = useRef({
    draft,
    unknown,
    data: read.data,
    fresh: read.fresh,
  });
  current.current = { draft, unknown, data: read.data, fresh: read.fresh };
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(baseline);
  useSettingsExit({
    dirty,
    pending: busy || !!unknown,
    message: unknown
      ? "Check this tag's saved state before leaving."
      : undefined,
  });
  const canWrite = (tag: Pick<Tag, "team_id">, data = current.current.data) =>
    !tag.team_id ||
    hasTeamPermission(
      data?.teams.find((team) => team.id === tag.team_id)?.role,
      "items:write",
    );
  const close = async () => {
    if (!owned() || lock.current || current.current.unknown) return;
    lock.current = true;
    setBusy(true);
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard tag changes?",
          action: "Discard changes",
          danger: true,
        }))
      )
        return;
      if (owned()) {
        setDraft(null);
        setBaseline(null);
        setError("");
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const edit = (tag?: Tag) => {
    if (!owned() || lock.current || unknown) return;
    const next: Draft = tag
      ? {
          id: tag.id,
          name: tag.name,
          color: tag.color,
          team: tag.team_id ?? "",
        }
      : { id: null, name: "", color: SWATCHES[1], team: "" };
    setDraft(next);
    setBaseline(next);
    setError("");
    setNotice("");
  };
  const save = async () => {
    const snapshot = current.current.draft;
    if (
      !snapshot ||
      !owned() ||
      lock.current ||
      current.current.unknown ||
      !current.current.fresh ||
      !canWrite({ team_id: snapshot.team || null })
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    let sent = false;
    const attempt: Attempt = {
      kind: snapshot.id ? "update" : "create",
      draft: { ...snapshot },
      before: current.current.data?.tags.map((tag) => tag.id) ?? [],
    };
    try {
      let saved: Tag;
      if (snapshot.id) {
        const input = tagUpdate.parse({
          name: snapshot.name.trim(),
          color: snapshot.color,
        });
        sent = true;
        saved = await client.updateTag(snapshot.id, input);
      } else {
        const input = tagInput.parse({
          name: snapshot.name.trim(),
          color: snapshot.color,
          team_id: snapshot.team || null,
        });
        sent = true;
        saved = await client.createTag(input);
      }
      if (!owned()) return;
      if ((snapshot.id && saved.id !== snapshot.id) || !same(saved, snapshot))
        throw new Error(
          "The tag receipt doesn't match your changes. Check its saved state.",
        );
      read.invalidate();
      setDraft(null);
      setBaseline(null);
      setNotice(snapshot.id ? "Tag saved." : "Tag added.");
      await read.reload();
      if (owned()) void refreshPlanner(true).catch(() => undefined);
    } catch (failure) {
      if (owned()) {
        if (sent && uncertain(failure)) setUnknown(attempt);
        setError(
          messageOf(failure, "Couldn't confirm this tag's saved state."),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const remove = async (tag: Tag) => {
    if (
      !owned() ||
      lock.current ||
      current.current.unknown ||
      !current.current.fresh ||
      !canWrite(tag)
    )
      return;
    lock.current = true;
    setBusy(true);
    let sent = false;
    try {
      if (
        !(await confirm({
          title: `Delete “${tag.name}”?`,
          body: "Tasks keep everything else.",
          action: "Delete tag",
          danger: true,
        }))
      )
        return;
      if (!owned() || !current.current.fresh || !canWrite(tag)) return;
      setBusy(true);
      setError("");
      setNotice("");
      sent = true;
      await client.deleteTag(tag.id);
      if (!owned()) return;
      read.invalidate();
      setNotice("Tag deleted.");
      await read.reload();
      if (owned()) void refreshPlanner(true).catch(() => undefined);
    } catch (failure) {
      if (owned()) {
        if (sent && uncertain(failure))
          setUnknown({
            kind: "delete",
            draft: {
              id: tag.id,
              name: tag.name,
              color: tag.color,
              team: tag.team_id ?? "",
            },
            before: [],
          });
        setError(messageOf(failure, "Couldn't delete this tag."));
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const check = async () => {
    const attempt = current.current.unknown;
    if (!attempt || !owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const [tags, teams] = await Promise.all([
        client.listTags(),
        client.listTeams(),
      ]);
      if (!owned() || current.current.unknown !== attempt) return;
      read.commit({ tags, teams });
      if (!canWrite({ team_id: attempt.draft.team || null }, { tags, teams }))
        throw new Error(
          "Your access to this tag's space has changed. Its earlier result remains unconfirmed.",
        );
      if (attempt.kind === "create") {
        const found = tags.filter(
          (tag) => !attempt.before.includes(tag.id) && same(tag, attempt.draft),
        );
        setCandidates(found);
        setError(
          found.length
            ? "A matching saved tag is available. Choose it if it is the tag you added."
            : "No matching saved tag is visible yet. The earlier request may still finish; check again.",
        );
      } else {
        const saved = tags.find((tag) => tag.id === attempt.draft.id);
        if (
          (attempt.kind === "delete" && !saved) ||
          (attempt.kind === "update" && saved && same(saved, attempt.draft))
        ) {
          setUnknown(null);
          setDraft(null);
          setBaseline(null);
          setNotice(
            attempt.kind === "delete"
              ? "The tag is no longer saved."
              : "Your changes are saved.",
          );
          void refreshPlanner(true).catch(() => undefined);
        } else
          setError(
            "The saved snapshot doesn't confirm the earlier result. Check again before making another change.",
          );
      }
    } catch (failure) {
      if (owned()) setError(messageOf(failure, "Couldn't check saved tags."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const useCandidate = async (candidate: Tag) => {
    const attempt = current.current.unknown;
    if (
      !attempt ||
      attempt.kind !== "create" ||
      !owned() ||
      lock.current ||
      !candidates.some((tag) => tag.id === candidate.id)
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      const [tags, teams] = await Promise.all([
        client.listTags(),
        client.listTeams(),
      ]);
      if (!owned() || current.current.unknown !== attempt) return;
      const saved = tags.find((tag) => tag.id === candidate.id);
      if (
        !saved ||
        attempt.before.includes(saved.id) ||
        !same(saved, attempt.draft) ||
        !canWrite(saved, { tags, teams })
      )
        throw new Error("That saved tag changed. Check saved state again.");
      read.commit({ tags, teams });
      setUnknown(null);
      setCandidates([]);
      setDraft(null);
      setBaseline(null);
      setError("");
      setNotice("Using the selected saved tag.");
      void refreshPlanner(true).catch(() => undefined);
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't confirm that saved tag."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const problem = (
    <>
      {error && <ErrorNotice message={error} />}
      {unknown && (
        <div className="settings-form">
          <p className="muted">
            The earlier request may have saved. Another write is blocked.
          </p>
          <Button disabled={busy} onClick={() => void check()}>
            Check saved state
          </Button>
          {candidates.map((tag) => (
            <Button
              key={tag.id}
              disabled={busy}
              onClick={() => void useCandidate(tag)}
            >
              Use saved tag “{tag.name}”
            </Button>
          ))}
        </div>
      )}
    </>
  );
  return (
    <SettingsSection title="Tags">
      {read.error && (
        <ErrorNotice
          message={read.error}
          onRetry={busy || unknown ? undefined : () => void read.reload()}
        />
      )}
      {notice && <p role="status">{notice}</p>}
      {!draft && problem}
      {!read.data ? (
        read.loading ? (
          <Loading label="Loading tags" />
        ) : null
      ) : (
        <>
          <div className="settings-actions">
            <Button
              disabled={!read.fresh || busy || !!unknown}
              onClick={() => edit()}
            >
              Add tag
            </Button>
          </div>
          {!read.data.tags.length && <Empty title="No tags yet" />}
          {read.data.tags.map((tag) => (
            <div className="settings-row" key={tag.id}>
              <div>
                <div className="settings-tag-label">
                  <span
                    className="settings-tag-color"
                    style={{ backgroundColor: tag.color }}
                    aria-hidden="true"
                  />
                  <strong dir="auto">{tag.name}</strong>
                </div>
                <p className="muted small" dir="auto">
                  {tag.team_id
                    ? (read.data?.teams.find((team) => team.id === tag.team_id)
                        ?.name ?? "Shared space")
                    : "Personal"}
                </p>
              </div>
              <div className="settings-actions">
                {canWrite(tag) ? (
                  <>
                    <Button
                      disabled={!read.fresh || busy || !!unknown}
                      onClick={() => edit(tag)}
                      aria-label={`Edit ${tag.name}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!read.fresh || busy || !!unknown}
                      onClick={() => void remove(tag)}
                      aria-label={`Delete ${tag.name}`}
                    >
                      Delete
                    </Button>
                  </>
                ) : (
                  <span className="muted small">View only</span>
                )}
              </div>
            </div>
          ))}
        </>
      )}
      {draft && (
        <Dialog
          title={draft.id ? "Edit tag" : "Add tag"}
          onClose={() => void close()}
          actions={
            <>
              <Button disabled={busy || !!unknown} onClick={() => void close()}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  !!unknown ||
                  !read.fresh ||
                  !draft.name.trim() ||
                  !dirty
                }
                onClick={() => void save()}
                busy={busy}
              >
                Save tag
              </Button>
            </>
          }
        >
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label="Name">
              <Input
                autoFocus
                maxLength={40}
                value={draft.name}
                disabled={busy || !!unknown}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </Field>
            {!draft.id && (
              <Field label="Space">
                <SelectBox
                  value={draft.team}
                  disabled={busy || !!unknown}
                  onChange={(event) =>
                    setDraft({ ...draft, team: event.target.value })
                  }
                >
                  <option value="">Personal</option>
                  {read.data?.teams
                    .filter((team) =>
                      hasTeamPermission(team.role, "items:write"),
                    )
                    .map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                </SelectBox>
              </Field>
            )}
            <Swatches
              label="Tag color"
              value={draft.color}
              disabled={busy || !!unknown}
              onChange={(color) => setDraft({ ...draft, color })}
            />
            {problem}
          </form>
        </Dialog>
      )}
    </SettingsSection>
  );
}
