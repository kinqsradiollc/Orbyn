import { useRouteInput } from "../../lib/route-scope";
import {
  CALLOUT_LABELS,
  docObjectLinks,
  docReferenceLinks,
  footnoteNumbers,
  footnoteTexts,
  listLayout,
  parseObjectHref,
  type Doc,
  type DocContainerNode,
  type LinkPill,
} from "@orbyn/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { client, getSessionVersion } from "../../lib/session";
import { useNavigate } from "../../lib/router";
import { ErrorNotice } from "../../ui/kit";
import { BlockView } from "../library/page/Blocks";
import {
  FootnoteContext,
  PageContext,
  PageReadOnlyContext,
  pillKey,
} from "../library/page/context";
import { leavesOf, rootsOf } from "../library/page/tree";
import { useTasks } from "./host-store";
import "../library/library.css";

/** Existing web renderers read a page without supplying any mutation callback. */
export function PagePreview({ doc }: { doc: Doc }) {
  const navigate = useNavigate();
  const tasks = useTasks();
  const inputAllowed = useRouteInput();
  const generation = useRef(getSessionVersion()).current;
  const document = useMemo(
    () => doc.document ?? { format: 1 as const, blocks: doc.content },
    [doc.document, doc.content],
  );
  const blocks = useMemo(() => leavesOf(document), [document]);
  const layout = useMemo(() => listLayout(blocks), [blocks]);
  const notes = useMemo(
    () => ({
      references: docReferenceLinks(blocks),
      numbers: footnoteNumbers(blocks),
      texts: footnoteTexts(blocks),
    }),
    [blocks],
  );
  const frame = useRef<HTMLDivElement>(null);
  const [pills, setPills] = useState(new Map<string, LinkPill>());
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const refs = useMemo(() => {
    const unique = new Map(
      docObjectLinks(blocks)
        .filter((link) => link.ref.kind !== "date")
        .map((link) => [pillKey(link.ref), link.ref]),
    );
    return [...unique.values()];
  }, [blocks]);
  useEffect(() => {
    let alive = true;
    setPills(new Map());
    setError("");
    const batches = [];
    for (let at = 0; at < refs.length; at += 60)
      batches.push(refs.slice(at, at + 60));
    void Promise.all(batches.map((batch) => client.resolveLinks(batch))).then(
      (values) => {
        if (alive && generation === getSessionVersion())
          setPills(new Map(values.flat().map((pill) => [pillKey(pill), pill])));
      },
      () => {
        if (alive && generation === getSessionVersion())
          setError(
            "Linked titles could not be loaded. The page remains available.",
          );
      },
    );
    return () => {
      alive = false;
    };
  }, [refs, retry, generation]);
  function fragment(id: string) {
    if (!inputAllowed() || generation !== getSessionVersion()) return;
    const element = [
      ...(frame.current?.querySelectorAll<HTMLElement>(
        "[data-preview-block], [id]",
      ) ?? []),
    ].find(
      (element) => element.dataset.previewBlock === id || element.id === id,
    );
    element?.scrollIntoView({ block: "nearest" });
    if (element) {
      element.tabIndex = -1;
      element.focus({ preventScroll: true });
    }
  }
  function open(href: string) {
    if (!inputAllowed() || generation !== getSessionVersion()) return;
    const ref = parseObjectHref(href);
    if (ref) {
      if (ref.kind === "task" || ref.kind === "event") tasks.open(ref.id);
      else if (ref.kind === "doc" || ref.kind === "project")
        navigate(
          `/app/${ref.kind}/${encodeURIComponent(ref.id)}${ref.block ? `#${encodeURIComponent(ref.block)}` : ""}`,
        );
      return;
    }
    try {
      const url = new URL(href, location.origin);
      if (url.origin === location.origin)
        navigate(url.pathname + url.search + url.hash);
      else if (url.protocol === "https:" || url.protocol === "http:")
        window.open(url.href, "_blank", "noopener,noreferrer");
    } catch {
      /* An invalid authored destination never becomes navigation authority. */
    }
  }
  let leaf = 0;
  const render = (nodes: readonly DocContainerNode[], path = ""): ReactNode =>
    nodes.map((node, index) => {
      const key = `${path}/${index}`;
      if (node.kind === "block") {
        const at = leaf++;
        return (
          <div
            key={node.block.id ?? key}
            className="doc-block"
            tabIndex={-1}
            data-preview-block={node.block.id}
          >
            <BlockView
              block={node.block}
              number={layout[at]?.number}
              depth={layout[at]?.depth}
              pageBlocks={blocks}
            />
          </div>
        );
      }
      if (node.kind === "quote")
        return (
          <blockquote
            key={node.id ?? key}
            className={
              node.callout
                ? `doc-callout is-${node.callout.tone}`
                : "doc-quote-box"
            }
          >
            {node.callout ? (
              <details open={!node.callout.folded}>
                <summary>{CALLOUT_LABELS[node.callout.tone]}</summary>
                {render(node.children, key)}
              </details>
            ) : (
              render(node.children, key)
            )}
          </blockquote>
        );
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag
          key={node.id ?? key}
          className="doc-list"
          start={node.ordered ? node.start : undefined}
        >
          {node.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {item.checked !== undefined && (
                <input
                  type="checkbox"
                  checked={item.checked}
                  disabled
                  aria-label="Checklist item"
                />
              )}
              {render(item.children, `${key}/${itemIndex}`)}
            </li>
          ))}
        </Tag>
      );
    });
  return (
    <PageReadOnlyContext.Provider value={true}>
      <PageContext.Provider
        value={{
          docId: doc.id,
          projectId: doc.project_id,
          pills,
          onFragment: fragment,
          onOpen: open,
        }}
      >
        <FootnoteContext.Provider value={notes}>
          {error && (
            <ErrorNotice
              message={error}
              onRetry={() => setRetry((value) => value + 1)}
            />
          )}
          <div ref={frame} className="doc-body">
            {blocks.length ? (
              render(rootsOf(document))
            ) : (
              <p>This page is empty.</p>
            )}
          </div>
        </FootnoteContext.Provider>
      </PageContext.Provider>
    </PageReadOnlyContext.Provider>
  );
}
