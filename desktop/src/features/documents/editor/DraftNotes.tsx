import { useEffect, useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { docPreview, newId, type DraftNote } from "@orbyn/core";
import { client } from "../../../lib/api";
import { session } from "../../../lib/session";
import { errorText } from "../../planner/planning";

/**
 * Notes the assistant has drafted, waiting for someone to keep them.
 *
 * A draft is shown as itself — its title, how long it is, and the first of
 * what it says — because the decision is whether this is worth keeping,
 * which you cannot make from a summary of a summary. Nothing is written
 * until Keep is pressed.
 */
export function DraftNotes(props: React.ComponentProps<typeof DraftNotesBody>) {
  return (
    <DraftNotesBody
      key={`${session.get()}:${props.scope ?? "drafts"}`}
      {...props}
    />
  );
}
function DraftNotesBody({
  notes,
  onKept,
  report,
}: {
  scope?: string;
  notes: DraftNote[];
  /** Called with the page once it exists, to open it. */
  onKept?: (docId: string) => void;
  report: (e: unknown) => void;
}) {
  const owner = useRef(session.get()).current;
  const mounted = useRef(true),
    operation = useRef(false);
  const owns = () => mounted.current && session.get() === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const noteKey = (note: DraftNote, at: number) =>
    JSON.stringify([
      at,
      note.title,
      note.content,
      note.project_id,
      note.item_id,
      note.team_id,
    ]);
  const keys = notes.map(noteKey),
    currentKeys = useRef(keys);
  currentKeys.current = keys;
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
  const [teamNames, setTeamNames] = useState<{
    key: string;
    names: Record<string, string>;
    error: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!teamIds.length) {
      setTeamNames({ key: teamKey, names: {}, error: "" });
      return;
    }
    Promise.all(
      teamIds.map((id) =>
        client.getTeam(id).then((team) => [id, team.name] as const),
      ),
    ).then(
      (rows) => {
        if (alive && owns())
          setTeamNames({
            key: teamKey,
            names: Object.fromEntries(rows),
            error: "",
          });
      },
      (error) => {
        if (alive && owns())
          setTeamNames({ key: teamKey, names: {}, error: errorText(error) });
      },
    );
    return () => {
      alive = false;
    };
  }, [teamKey, retry]);
  const teamData = teamNames?.key === teamKey ? teamNames : null;
  const current = (key: string) => owns() && currentKeys.current.includes(key);
  const keep = async (draft: DraftNote, at: number) => {
    const key = noteKey(draft, at);
    if (
      !current(key) ||
      operation.current ||
      kept[key] ||
      (draft.team_id && !teamData?.names[draft.team_id])
    )
      return;
    operation.current = true;
    setBusy(true);
    setErrors((all) => ({ ...all, [key]: "" }));
    const request = requests.current.get(key) ?? newId();
    requests.current.set(key, request);
    let docId: string | null = null;
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
      docId = doc.id;
      if (!owns()) return;
      setKept((all) => ({ ...all, [key]: doc.id }));
      if (current(key)) await onKept?.(doc.id);
    } catch (error) {
      if (current(key)) {
        setErrors((all) => ({
          ...all,
          [key]: docId
            ? "Note kept. Couldn't open it. Try Open note."
            : errorText(error),
        }));
        report(error);
      }
    } finally {
      operation.current = false;
      if (owns()) setBusy(false);
    }
  };
  const open = async (key: string) => {
    if (!current(key) || operation.current || !kept[key]) return;
    operation.current = true;
    setBusy(true);
    setErrors((all) => ({ ...all, [key]: "" }));
    try {
      await onKept?.(kept[key]);
    } catch (error) {
      if (current(key))
        setErrors((all) => ({ ...all, [key]: errorText(error) }));
    } finally {
      operation.current = false;
      if (owns()) setBusy(false);
    }
  };
  if (!notes.length) return null;

  return (
    <div className="ai-drafts">
      {teamData?.error && (
        <div role="alert" className="error">
          {teamData.error}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry note destination
          </button>
        </div>
      )}
      {notes.map((draft, at) => (
        <article key={at} className="ai-draft">
          <header>
            <FileText size={14} aria-hidden="true" />
            <strong>{draft.title || "Untitled"}</strong>
            {!!draft.project_name && (
              <span className="chip">{draft.project_name}</span>
            )}
          </header>
          <p className="ai-draft-preview">{docPreview(draft.content, 200)}</p>
          <p className="muted small">
            {draft.team_id
              ? (teamData?.names[draft.team_id] ??
                (teamData?.error ? "Team unavailable" : "Loading team…"))
              : "Personal"}
          </p>
          <details>
            <summary>Full text</summary>
            <div className="ai-draft-full">
              {docPreview(draft.content, Number.MAX_SAFE_INTEGER)}
            </div>
          </details>
          {!!draft.note && (
            <details>
              <summary>Why this note</summary>
              <p className="ai-draft-why">{draft.note}</p>
            </details>
          )}
          {!!errors[keys[at]] && (
            <p className="error" role="alert">
              {errors[keys[at]]}
            </p>
          )}
          <div className="ai-draft-actions">
            {kept[keys[at]] ? (
              onKept ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || !onKept}
                  onClick={() => void open(keys[at])}
                >
                  Open note
                </button>
              ) : (
                <span role="status">Note kept</span>
              )
            ) : (
              <button
                type="button"
                className="primary"
                disabled={
                  busy || (!!draft.team_id && !teamData?.names[draft.team_id])
                }
                onClick={() => void keep(draft, at)}
              >
                <Plus size={14} aria-hidden="true" /> Keep note
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
