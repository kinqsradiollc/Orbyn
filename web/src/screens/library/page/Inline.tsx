import {
  docLinkDestination,
  mentionedPerson,
  parseDocInline,
  parseObjectHref,
  type DocInline,
} from "@orbyn/core";
import katex from "katex";
import "katex/dist/katex.min.css";
import { FileText, Hash, Link2 } from "lucide-react";
import {
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import { useLibraryOwner } from "../lifetime";
import { navigate } from "../../../lib/router";
import { tasks } from "../../shared-task";
import { FootnoteContext, PageContext, pillKey } from "./context";
import { cut, type Mark } from "./marks";
import { LinkedObject } from "./LinkedObject";

export function Math({
  latex,
  display = false,
}: {
  latex: string;
  display?: boolean;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        strict: false,
      });
    } catch {
      return null;
    }
  }, [latex, display]);
  if (html === null)
    return (
      <code className="doc-math-error" title="This formula isn't valid yet">
        {latex}
      </code>
    );
  return (
    <span
      className={display ? "doc-math-display" : "doc-math-inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Pieces({ run, marks }: { run: DocInline; marks: Mark[] }) {
  return (
    <>
      {cut(run, marks).map((piece, index) =>
        piece.depth ? (
          <span
            key={index}
            data-src={piece.start}
            className={`doc-mark${piece.active ? " is-active" : ""}${piece.proposed ? " is-proposed" : ""}`}
            data-depth={piece.depth > 1 ? 2 : 1}
          >
            {piece.text}
          </span>
        ) : (
          <span key={index} data-src={piece.start}>
            {piece.text}
          </span>
        ),
      )}
    </>
  );
}

const TAG = /(^|[\s(])#([\p{L}\p{N}_-]+)/gu;

/** A #tag stands apart from the words around it. */
function tagged(run: DocInline, marks: Mark[], plain: boolean): ReactNode {
  if (!plain || !run.text.includes("#"))
    return <Pieces run={run} marks={marks} />;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of run.text.matchAll(TAG)) {
    const start = match.index + match[1].length;
    if (start > at)
      parts.push(
        <Pieces
          key={at}
          run={{
            ...run,
            text: run.text.slice(at, start),
            start: run.start + at,
          }}
          marks={marks}
        />,
      );
    const end = start + match[2].length + 1;
    parts.push(
      <span key={start} className="doc-inline-tag" title={`Tag: ${match[2]}`}>
        <Pieces
          run={{
            ...run,
            text: run.text.slice(start, end),
            start: run.start + start,
          }}
          marks={marks}
        />
      </span>,
    );
    at = end;
  }
  if (!parts.length) return <Pieces run={run} marks={marks} />;
  if (at < run.text.length)
    parts.push(
      <Pieces
        key={at}
        run={{ ...run, text: run.text.slice(at), start: run.start + at }}
        marks={marks}
      />,
    );
  return parts;
}

const modded = (event: MouseEvent) =>
  event.button !== 0 ||
  event.metaKey ||
  event.ctrlKey ||
  event.shiftKey ||
  event.altKey;

function LinkPillView({
  href,
  label,
  start,
  hint,
}: {
  href: string;
  label: string;
  start: number;
  hint?: string;
}) {
  const page = useContext(PageContext);
  const [details, setDetails] = useState(false);
  const [tickBusy, setTickBusy] = useState(false);
  const [tickError, setTickError] = useState("");
  const tickLock = useRef(false);
  const current = useLibraryOwner();
  const identity = useRef(href);
  identity.current = href;
  const ref = parseObjectHref(href);
  const pill = ref ? page?.pills.get(pillKey(ref)) : undefined;
  useEffect(() => {
    setTickError("");
  }, [pill]);
  if (!ref) return null;
  if (pill && pill.state !== "ok") {
    const deleted = pill.state === "deleted";
    return (
      <span
        className="doc-pill is-gone"
        data-src={start}
        onClick={(event) => event.stopPropagation()}
      >
        <Link2 aria-hidden="true" />
        {deleted
          ? `Deleted ${ref.kind === "doc" ? "page" : ref.kind}`
          : "Not found"}
        {deleted && pill.can_restore && page?.onRestoreDoc && (
          <button type="button" onClick={() => page.onRestoreDoc?.(ref.id)}>
            Restore
          </button>
        )}
      </span>
    );
  }
  const title = ref.kind === "date" ? label : (pill?.title ?? label);
  const isTask = ref.kind === "task" || ref.kind === "event";
  const done = !!pill?.done;
  const target = pill?.moved_to
    ? { kind: "doc" as const, id: pill.moved_to }
    : ref;
  const openable = ref.kind !== "person" && ref.kind !== "date";
  const open = () => {
    if (!openable) return;
    const kind = target.kind === "event" ? "task" : target.kind;
    page?.onOpen(
      `orbyn://${kind}/${target.id}${ref.block ? `#${ref.block}` : ""}`,
    );
  };
  return (
    <>
      <span
        className={`doc-pill${done ? " is-done" : ""}`}
        data-src={start}
        title={hint}
      >
        {isTask && page?.onToggleTask && (
          <input
            type="checkbox"
            checked={done}
            aria-label={`Done: ${title}`}
            onClick={(event) => event.stopPropagation()}
            disabled={tickBusy || !!tickError}
            onChange={() => {
              if (tickLock.current || tickError || !current()) return;
              tickLock.current = true;
              setTickBusy(true);
              void (async () => {
                if (ref.kind !== "task" && ref.kind !== "event") return;
                const receipt = await client.linkCard({
                  kind: ref.kind,
                  id: ref.id,
                });
                if (!current() || identity.current !== href) return;
                if (receipt.state !== "ok" || !receipt.can_write)
                  throw new Error("You don't have edit access to this task.");
                await page.onToggleTask?.(ref.id, !done);
              })()
                .catch((failure: unknown) => {
                  if (current() && identity.current === href)
                    setTickError(
                      messageOf(failure, "Couldn't confirm the task status."),
                    );
                })
                .finally(() => {
                  tickLock.current = false;
                  if (current()) setTickBusy(false);
                });
            }}
          />
        )}
        {!isTask &&
          (ref.block ? (
            <Hash aria-hidden="true" />
          ) : (
            <FileText aria-hidden="true" />
          ))}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (event.metaKey || event.ctrlKey) {
              const kind = target.kind === "event" ? "task" : target.kind;
              if (kind === "doc" || kind === "project" || kind === "task")
                tasks.peek({ kind, id: target.id });
            } else open();
          }}
        >
          {title}
        </button>
        {page &&
          (ref.kind === "doc" ||
            ref.kind === "task" ||
            ref.kind === "event" ||
            ref.kind === "project") && (
            <button
              type="button"
              className="linked-object-trigger"
              aria-label={`Details for ${title}`}
              aria-haspopup="dialog"
              disabled={tickBusy}
              onClick={(event) => {
                event.stopPropagation();
                event.currentTarget.focus({ preventScroll: true });
                setDetails(true);
              }}
            >
              Details
            </button>
          )}
      </span>
      {tickError && (
        <span className="linked-object-tick-error" role="alert">
          {tickError} Open Details to check the current status.
        </span>
      )}
      {details &&
        page &&
        (ref.kind === "doc" ||
          ref.kind === "task" ||
          ref.kind === "event" ||
          ref.kind === "project") && (
          <LinkedObject
            key={`${ref.kind}:${ref.id}:${ref.block ?? ""}`}
            target={{ ...ref, kind: ref.kind }}
            links={page}
            onClose={() => setDetails(false)}
          />
        )}
    </>
  );
}

export function Inline({ text, marks = [] }: { text: string; marks?: Mark[] }) {
  const page = useContext(PageContext);
  const { references, numbers } = useContext(FootnoteContext);
  const runs = useMemo(
    () => parseDocInline(text, references),
    [text, references],
  );
  return (
    <>
      {runs.map((run, index) => {
        let body: ReactNode;
        if (run.break)
          body =
            run.break === "hard" ? (
              <br data-src={run.start} />
            ) : (
              <span data-src={run.start}> </span>
            );
        else if (run.math)
          body = (
            <span data-src={run.start}>
              <Math latex={run.text} />
            </span>
          );
        else if (run.code)
          body = (
            <code className="doc-code-inline">
              <Pieces run={run} marks={marks} />
            </code>
          );
        else if (run.footnote)
          body = (
            <sup className="doc-footnote-ref" data-src={run.start}>
              <a
                href={`#fn-${run.footnote}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  page?.onFragment(`fn-${run.footnote}`);
                }}
              >
                {numbers.get(run.footnote) ?? run.footnote}
              </a>
            </sup>
          );
        else if (run.source)
          body = (
            <span
              className="doc-source-chip"
              data-src={run.start}
              title={`Source: ${run.text}`}
            >
              <Pieces run={run} marks={marks} />
            </span>
          );
        else if (run.link && mentionedPerson(run.link))
          body = (
            <span
              className="doc-mention"
              title={`Mentioned: ${run.text.replace(/^@/, "")}`}
            >
              <Pieces run={run} marks={marks} />
            </span>
          );
        else if (run.link && parseObjectHref(run.link))
          body = (
            <LinkPillView
              href={run.link}
              label={run.text}
              start={run.start}
              hint={run.linkTitle}
            />
          );
        else if (run.link) {
          const destination = docLinkDestination(run.link, location.origin);
          if (!destination) body = <Pieces run={run} marks={marks} />;
          else
            body = (
              <a
                href={
                  destination.kind === "fragment"
                    ? `#${destination.fragment}`
                    : destination.url
                }
                target={destination.kind === "external" ? "_blank" : undefined}
                rel="noreferrer"
                title={run.linkTitle}
                onClick={(event) => {
                  if (modded(event)) return;
                  event.stopPropagation();
                  if (destination.kind === "fragment") {
                    event.preventDefault();
                    page?.onFragment(destination.fragment);
                  } else if (destination.kind === "app") {
                    event.preventDefault();
                    if (page) page.onOpen(destination.url);
                    else
                      navigate(
                        new URL(destination.url, location.origin).pathname,
                      );
                  }
                }}
              >
                <Pieces run={run} marks={marks} />
              </a>
            );
        } else body = tagged(run, marks, true);
        if (run.highlight)
          body = (
            <mark
              className={`doc-highlight${run.tint ? ` is-${run.tint}` : ""}`}
            >
              {body}
            </mark>
          );
        if (run.strike) body = <s>{body}</s>;
        if (run.italic) body = <em>{body}</em>;
        if (run.bold) body = <strong>{body}</strong>;
        return <Fragment key={index}>{body}</Fragment>;
      })}
    </>
  );
}
