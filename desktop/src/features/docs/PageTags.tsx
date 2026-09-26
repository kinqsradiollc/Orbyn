import { useState } from "react";
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
export function PageTags({
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
  const [picking, setPicking] = useState<DOMRect | null>(null);
  const [offered, setOffered] = useState<Tag[] | null>(null);
  const [busy, setBusy] = useState(false);

  const inSpace = (t: Tag) =>
    teamId ? t.team_id === teamId : t.team_id === null;

  const open = (anchor: DOMRect) => {
    setPicking(anchor);
    client.listTags().then((all) => setOffered(all.filter(inSpace)), report);
  };

  const set = (ids: string[]) => {
    setBusy(true);
    client
      .setDocTags(docId, ids)
      .then(({ tags: next }) => onChange(next), report)
      .finally(() => setBusy(false));
  };

  const create = async (name: string) => {
    try {
      const made = await client.createTag({ name, team_id: teamId });
      setOffered((all) => [...(all ?? []), made]);
      return made;
    } catch (e) {
      report(e);
      return null;
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
          onClose={() => setPicking(null)}
          width={320}
        >
          <div className="page-tags-picker">
            {offered === null ? (
              <p className="muted">Loading…</p>
            ) : (
              <TagPicker
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
