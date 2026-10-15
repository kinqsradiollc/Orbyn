import { useEffect, useRef, useState } from "react";
import { Plus, Tag as TagIcon, X } from "lucide-react";
import type { DocTag, Tag } from "@orbyn/core";
import { client } from "../../lib/api";
import { Popover } from "../../components/Popover";
import { TagPicker } from "../../components/TagPicker";

/**
 * A page's tags, under its title: quiet chips, and a small "Tag" button that
 * opens the same picker tasks use. The list offered is the page's own
 * space's — your tags on your pages, the team's on a team's — and a new tag
 * made here is made there. Typing "#tag" in a line adds to the same row.
 */
export function PageTags(props: Parameters<typeof PageTagsBody>[0]) {
  return (
    <PageTagsBody
      key={`${props.docId}:${props.teamId ?? "personal"}`}
      {...props}
    />
  );
}

function PageTagsBody({
  docId,
  teamId,
  tags,
  canWrite,
  onChange,
  report,
}: {
  docId: string;
  teamId: string | null;
  tags: DocTag[];
  canWrite: boolean;
  onChange: (tags: DocTag[]) => void;
  report: (e: unknown) => void;
}) {
  const request = useRef(0);
  const mutation = useRef(false);
  const [failed, setFailed] = useState(false);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const [picking, setPicking] = useState<DOMRect | null>(null);
  const [offered, setOffered] = useState<Tag[] | null>(null);
  const [busy, setBusy] = useState(false);

  const inSpace = (t: Tag) =>
    teamId ? t.team_id === teamId : t.team_id === null;

  const open = (anchor: DOMRect) => {
    if (!canWrite || mutation.current) return;
    setPicking(anchor);
    const epoch = ++request.current;
    setFailed(false);
    setOffered(null);
    void client.listTags().then(
      (all) => {
        if (epoch === request.current) setOffered(all.filter(inSpace));
      },
      (reason) => {
        if (epoch === request.current) {
          setFailed(true);
          report(reason);
        }
      },
    );
  };

  const set = (ids: string[]) => {
    if (!canWrite || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    client
      .setDocTags(docId, ids)
      .then(({ tags: next }) => onChange(next), report)
      .finally(() => {
        mutation.current = false;
        setBusy(false);
      });
  };

  const create = async (name: string) => {
    if (!canWrite || mutation.current || !name.trim()) return null;
    mutation.current = true;
    setBusy(true);
    try {
      const made = await client.createTag({ name, team_id: teamId });
      setOffered((all) => [...(all ?? []), made]);
      return made;
    } catch (e) {
      report(e);
      return null;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  if (!tags.length && !canWrite) return null;
  return (
    <div className="page-tags" aria-label="Tags on this page">
      {tags.map((t) => (
        <span
          key={t.id}
          className="tag-chip page-tag"
          style={{ "--tag": t.color } as never}
        >
          <i aria-hidden="true" />
          {t.name}
          {canWrite && (
            <button
              type="button"
              className="page-tag-remove"
              aria-label={`Remove the tag ${t.name}`}
              title={`Remove ${t.name}`}
              disabled={busy}
              onClick={() =>
                set(tags.filter((x) => x.id !== t.id).map((x) => x.id))
              }
            >
              <X size={11} aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {canWrite && (
        <button
          type="button"
          className="page-tags-add"
          disabled={busy}
          aria-haspopup="dialog"
          aria-expanded={!!picking}
          aria-label={tags.length ? "Add a tag" : undefined}
          title="Add a tag, or type #tag in a line"
          onClick={(e) => open(e.currentTarget.getBoundingClientRect())}
        >
          {tags.length ? (
            <Plus size={13} aria-hidden="true" />
          ) : (
            <>
              <TagIcon size={13} aria-hidden="true" /> Tag
            </>
          )}
        </button>
      )}
      {picking && (
        <Popover
          label="Tags"
          anchor={picking}
          onClose={() => {
            if (!mutation.current) {
              request.current++;
              setPicking(null);
            }
          }}
          width={320}
        >
          <div className="page-tags-picker">
            {failed ? (
              <div role="alert">
                <p>Couldn't load tags.</p>
                <button className="secondary" onClick={() => open(picking)}>
                  Retry
                </button>
              </div>
            ) : offered === null ? (
              <p className="muted">Loading…</p>
            ) : (
              <TagPicker
                disabled={busy}
                tags={offered}
                selected={tags.map((t) => t.id)}
                onChange={set}
                onCreate={create}
              />
            )}
            <p className="page-tags-hint">
              Or type <code>#tag</code> in a line.
            </p>
          </div>
        </Popover>
      )}
    </div>
  );
}
