import type { RelatedPage, UnlinkedMention } from "@orbyn/core";
import { useContext, useEffect, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import { useLibraryOwner } from "../lifetime";
import { useToast } from "../../../ui/kit";
import { PageContext } from "./context";

type Linked = Awaited<ReturnType<typeof client.linksHere>>;

/** The places that link here, names that could, and pages like this one. */
export function LinkedHere({ id, title }: { id: string; title: string }) {
  const page = useContext(PageContext);
  const toast = useToast();
  const [list, setList] = useState<Linked | null>(null);
  const [mentions, setMentions] = useState<UnlinkedMention[]>([]);
  const [related, setRelated] = useState<RelatedPage[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const pendingRef = useRef(new Set<string>());
  const current = useLibraryOwner();
  const [round, setRound] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    if (!current()) return;
    setFailures([]);
    setList(null);
    setMentions([]);
    setRelated([]);
    const failed = (label: string) => {
      if (live && current()) setFailures((was) => [...was, label]);
    };
    client.linksHere("doc", id).then(
      (next) => live && current() && setList(next),
      () => failed("links"),
    );
    client.unlinkedMentions("doc", id).then(
      (next) => live && current() && setMentions(next),
      () => failed("unlinked mentions"),
    );
    client.relatedPages(id).then(
      (next) => live && current() && setRelated(next),
      () => failed("related pages"),
    );
    return () => {
      live = false;
    };
  }, [id, round, current]);
  const count = list?.count ?? 0;
  if (!count && !mentions.length && !related.length && !failures.length)
    return null;
  return (
    <section className="page-linked" aria-label="Linked here">
      {failures.length > 0 && (
        <p className="small muted" role="status">
          Couldn't load {failures.join(", ")}.{" "}
          <button
            type="button"
            className="doc-textlink"
            onClick={() => setRound((n) => n + 1)}
          >
            Try again
          </button>
        </p>
      )}
      <button
        type="button"
        className="small doc-textlink"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {count ? `${count} linked here` : "Related"}
        {mentions.length
          ? ` · ${mentions.length} mention${mentions.length === 1 ? "" : "s"}`
          : ""}
      </button>
      {open && (
        <ul className="page-linked-list">
          {list?.items.map((entry, index) => (
            <li key={index}>
              <button
                type="button"
                className="doc-textlink small"
                dir="auto"
                onClick={() =>
                  page?.onOpen(
                    `orbyn://${entry.kind}/${entry.id}${entry.block_id ? `#${entry.block_id}` : ""}`,
                  )
                }
              >
                {entry.title || "Untitled"}
              </button>
            </li>
          ))}
          {mentions.map((mention) => (
            <li
              key={`${mention.doc_id}:${mention.block_id ?? ""}`}
              className="small"
            >
              <span dir="auto">
                {mention.title}: {mention.context.before}
                <b>{mention.context.linked}</b>
                {mention.context.after}
              </span>{" "}
              {mention.can_link && mention.block_id && (
                <button
                  type="button"
                  className="doc-textlink"
                  disabled={pending.includes(
                    `${mention.doc_id}:${mention.block_id}`,
                  )}
                  onClick={() => {
                    const key = `${mention.doc_id}:${mention.block_id}`;
                    if (!current() || pendingRef.current.has(key)) return;
                    pendingRef.current.add(key);
                    setPending([...pendingRef.current]);
                    void client
                      .linkMention({
                        doc_id: mention.doc_id,
                        block_id: mention.block_id!,
                        matched: mention.matched,
                        target: { kind: "doc", id },
                      })
                      .then(
                        () => {
                          if (current()) setRound((n) => n + 1);
                        },
                        (failure) =>
                          current() &&
                          toast({
                            text: messageOf(failure, `Couldn't link ${title}.`),
                            error: true,
                          }),
                      )
                      .finally(() => {
                        pendingRef.current.delete(key);
                        if (current()) setPending([...pendingRef.current]);
                      });
                  }}
                >
                  Link
                </button>
              )}
            </li>
          ))}
          {related.map((one) => (
            <li key={one.doc_id}>
              <button
                type="button"
                className="doc-textlink small"
                dir="auto"
                onClick={() => page?.onOpen(`orbyn://doc/${one.doc_id}`)}
              >
                {one.title || "Untitled"}
              </button>
              <span className="small muted"> {one.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
