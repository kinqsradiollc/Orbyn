import { docPreview, newId, type DraftNote } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";
import { Button, ErrorNotice, Pill } from "../../ui/kit";
import { useOwned } from "./hooks";
import { More } from "./parts";

const keyOf = (note: DraftNote, at: number) =>
  JSON.stringify([
    at,
    note.title,
    note.content,
    note.project_id,
    note.item_id,
    note.team_id,
  ]);

/** Notes drafted by the assistant. Nothing is written until Keep note. */
export function DraftNotes({
  notes,
  onKept,
}: {
  notes: DraftNote[];
  onKept?: (docId: string) => void;
}) {
  const owned = useOwned();
  const running = useRef(false);
  const requests = useRef(new Map<string, string>());
  const [kept, setKept] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const teamIds = [
    ...new Set(
      notes.map((note) => note.team_id).filter((id): id is string => !!id),
    ),
  ].sort();
  const teamKey = teamIds.join(",");
  const [teams, setTeams] = useState<{
    key: string;
    names: Record<string, string>;
    error: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    if (!teamIds.length) {
      setTeams({ key: teamKey, names: {}, error: "" });
      return;
    }
    Promise.all(
      teamIds.map((id) =>
        client.getTeam(id).then((team) => [id, team.name] as const),
      ),
    ).then(
      (rows) => {
        if (live && owned())
          setTeams({
            key: teamKey,
            names: Object.fromEntries(rows),
            error: "",
          });
      },
      (failure) => {
        if (live && owned())
          setTeams({
            key: teamKey,
            names: {},
            error: messageOf(failure, "Couldn't check the note's team."),
          });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamKey, attempt]);
  const known = teams?.key === teamKey ? teams : null;

  const keep = async (draft: DraftNote, at: number) => {
    const key = keyOf(draft, at);
    if (
      !owned() ||
      running.current ||
      kept[key] ||
      (draft.team_id && !known?.names[draft.team_id])
    )
      return;
    running.current = true;
    setBusy(true);
    setErrors((all) => ({ ...all, [key]: "" }));
    const request = requests.current.get(key) ?? newId();
    requests.current.set(key, request);
    try {
      const doc = await client.once(request, () =>
        client.createDoc({
          title: draft.title,
          kind: "note",
          content: draft.content,
          project_id: draft.project_id,
          item_id: draft.item_id,
          team_id: draft.team_id,
        }),
      );
      if (!owned()) return;
      setKept((all) => ({ ...all, [key]: doc.id }));
      onKept?.(doc.id);
    } catch (failure) {
      if (owned())
        setErrors((all) => ({
          ...all,
          [key]: messageOf(failure, "Couldn't keep this note."),
        }));
    } finally {
      running.current = false;
      if (owned()) setBusy(false);
    }
  };

  if (!notes.length) return null;
  return (
    <div className="agents-drafts">
      {known?.error && (
        <ErrorNotice
          message={known.error}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {notes.map((draft, at) => {
        const key = keyOf(draft, at);
        return (
          <article key={key}>
            <header>
              <strong dir="auto">{draft.title || "Untitled"}</strong>
              {!!draft.project_name && <Pill>{draft.project_name}</Pill>}
            </header>
            <p dir="auto">{docPreview(draft.content, 200)}</p>
            <p className="muted small">
              {draft.team_id
                ? (known?.names[draft.team_id] ??
                  (known?.error ? "Team unavailable" : "Loading team…"))
                : "Personal"}
            </p>
            <More summary="Full text">
              <p className="agents-prewrap" dir="auto">
                {docPreview(draft.content, Number.MAX_SAFE_INTEGER)}
              </p>
            </More>
            {!!draft.note && (
              <More summary="Why this note">
                <p dir="auto">{draft.note}</p>
              </More>
            )}
            {!!errors[key] && <ErrorNotice message={errors[key]} />}
            {kept[key] ? (
              onKept ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onKept(kept[key])}
                >
                  Open note
                </Button>
              ) : (
                <span role="status">Note kept</span>
              )
            ) : (
              <Button
                disabled={
                  busy || (!!draft.team_id && !known?.names[draft.team_id])
                }
                onClick={() => void keep(draft, at)}
              >
                Keep note
              </Button>
            )}
          </article>
        );
      })}
    </div>
  );
}
