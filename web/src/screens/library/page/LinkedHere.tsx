import type { RelatedPage, UnlinkedMention } from "@orbyn/core";
import { useContext, useEffect, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
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
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    client.linksHere("doc", id).then(
      (next) => live && setList(next),
      () => live && setFailed(true),
    );
    client.unlinkedMentions("doc", id).then(
      (next) => live && setMentions(next),
      () => {},
    );
    client.relatedPages(id).then(
      (next) => live && setRelated(next),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [id, round]);
  if (failed)
    return (
      <p className="small muted page-linked">
        Couldn't load what links here.{" "}
        <button
          type="button"
          className="doc-textlink"
          onClick={() => setRound((n) => n + 1)}
        >
          Try again
        </button>
      </p>
    );
  const count = list?.count ?? 0;
  if (!count && !mentions.length && !related.length) return null;
  return (
    <section className="page-linked" aria-label="Linked here">
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
                  onClick={() =>
                    void client
                      .linkMention({
                        doc_id: mention.doc_id,
                        block_id: mention.block_id!,
                        matched: mention.matched,
                        target: { kind: "doc", id },
                      })
                      .then(
                        () => setRound((n) => n + 1),
                        (failure) =>
                          toast({
                            text: messageOf(failure, `Couldn't link ${title}.`),
                            error: true,
                          }),
                      )
                  }
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
