import { type Doc, type Tag } from "@orbyn/core";
import { Plus, Tag as TagIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Input,
  Loading,
  useToast,
} from "../../../ui/kit";
import { loadLibrary } from "../store";
import type { Page } from "./usePage";

export function Tags({
  page,
  doc,
  canWrite,
}: {
  page: Page;
  doc: Doc;
  canWrite: boolean;
}) {
  const toast = useToast();
  const [tags, setTags] = useState(doc.tags ?? []);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setTags(doc.tags ?? []), [doc.id, doc.tags]);
  useEffect(() => {
    if (!page.tagsStamp) return;
    client.getDoc(doc.id).then(
      (fresh) => setTags(fresh.tags ?? []),
      () => {},
    );
  }, [page.tagsStamp, doc.id]);
  const set = async (ids: string[]) => {
    setBusy(true);
    try {
      const result = await client.setDocTags(doc.id, ids);
      setTags(result.tags);
      void loadLibrary();
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't change the tags."),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  if (!tags.length && !canWrite) return null;
  return (
    <span className="doc-tags">
      {tags.map((tag) => (
        <span key={tag.id} className="lib-tag">
          <i style={{ background: tag.color }} aria-hidden="true" />
          {tag.name}
          {canWrite && (
            <button
              type="button"
              aria-label={`Remove the tag ${tag.name}`}
              disabled={busy}
              onClick={() =>
                void set(
                  tags.filter((one) => one.id !== tag.id).map((one) => one.id),
                )
              }
            >
              <X aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {canWrite && (
        <button
          type="button"
          className="doc-tag-add small"
          title="Add a tag, or type #tag in a line"
          aria-label="Add a tag"
          disabled={busy}
          onClick={() => setPicking(true)}
        >
          {tags.length ? (
            <Plus aria-hidden="true" />
          ) : (
            <>
              <TagIcon aria-hidden="true" /> Tag
            </>
          )}
        </button>
      )}
      {picking && (
        <TagPicker
          teamId={doc.team_id}
          chosen={tags.map((tag) => tag.id)}
          onClose={() => setPicking(false)}
          onChoose={(id) => {
            setPicking(false);
            void set([...tags.map((tag) => tag.id), id]);
          }}
        />
      )}
    </span>
  );
}

function TagPicker({
  teamId,
  chosen,
  onClose,
  onChoose,
}: {
  teamId: string | null;
  chosen: string[];
  onClose: () => void;
  onChoose: (id: string) => void;
}) {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [making, setMaking] = useState(false);
  useEffect(() => {
    let live = true;
    setError("");
    client.listTags().then(
      (list) =>
        live &&
        setTags(
          list.filter((tag) => (tag.team_id ?? null) === (teamId ?? null)),
        ),
      (failure) => live && setError(messageOf(failure, "Couldn't load tags.")),
    );
    return () => {
      live = false;
    };
  }, [teamId, attempt]);
  const words = query.trim();
  const shown = tags?.filter(
    (tag) =>
      !chosen.includes(tag.id) &&
      tag.name.toLocaleLowerCase().includes(words.toLocaleLowerCase()),
  );
  const exact = tags?.some(
    (tag) => tag.name.toLocaleLowerCase() === words.toLocaleLowerCase(),
  );
  return (
    <Dialog title="Add a tag" onClose={onClose}>
      <Input
        autoFocus
        aria-label="Find or name a tag"
        placeholder="Find or name a tag"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {error && (
        <ErrorNotice message={error} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {!tags && !error && <Loading label="Loading tags" />}
      <div className="lib-picklist">
        {shown?.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="row"
            onClick={() => onChoose(tag.id)}
          >
            <span className="lib-tag">
              <i style={{ background: tag.color }} aria-hidden="true" />
              {tag.name}
            </span>
          </button>
        ))}
        {words && tags && !exact && (
          <Button
            busy={making}
            onClick={() => {
              setMaking(true);
              client.createTag({ name: words, team_id: teamId }).then(
                (made) => onChoose(made.id),
                (failure) => {
                  setError(messageOf(failure, "Couldn't create the tag."));
                  setMaking(false);
                },
              );
            }}
          >
            Create “{words}”
          </Button>
        )}
      </div>
    </Dialog>
  );
}
