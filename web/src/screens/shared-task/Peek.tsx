import { plainText, type Doc, type Project } from "@orbyn/core";
import { Boxes, FileText, Maximize2, Pin, PinOff, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { ErrorNotice, IconButton, Loading } from "../../ui/kit";
import { tasks, type PeekTarget } from "./host-store";

type Loaded = { doc: Doc } | { project: Project };

const textOf = (block: { text?: string }) =>
  block.text ? plainText(block.text).trim() : "";

/** A page or project read beside the screen you are on, without leaving it. */
export function Peek({
  target,
  pinned,
}: {
  target: PeekTarget;
  pinned: boolean;
}) {
  const box = useRef<HTMLElement>(null);
  const shown = useResource<Loaded>(
    async () =>
      target.kind === "doc"
        ? { doc: await client.getDoc(target.id) }
        : { project: await client.getProject(target.id) },
    [target.kind, target.id],
  );
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open], .menu")) return;
      tasks.closePeek();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const data = shown.data;
  const title = !data
    ? ""
    : "doc" in data
      ? data.doc.title || "Untitled"
      : data.project.name;
  const openFull = () => {
    navigate(`/app/${target.kind}/${target.id}`);
    if (!pinned) tasks.closePeek();
  };
  return createPortal(
    <aside
      ref={box}
      className="st-panel"
      tabIndex={-1}
      role="complementary"
      aria-label={`${target.kind === "doc" ? "Page" : "Project"} beside: ${title}`}
    >
      <header className="st-head">
        <span className="st-kicker">
          {target.kind === "doc" ? (
            <FileText aria-hidden="true" />
          ) : (
            <Boxes aria-hidden="true" />
          )}
          {target.kind === "doc" ? "Page" : "Project"}
        </span>
        <span className="st-gap" />
        <IconButton
          label={
            pinned
              ? "Unpin: close it when you move on"
              : "Pin: keep it open as you move around"
          }
          aria-pressed={pinned}
          onClick={() => tasks.pinPeek(!pinned)}
        >
          {pinned ? <PinOff /> : <Pin />}
        </IconButton>
        <IconButton label="Open full" onClick={openFull}>
          <Maximize2 />
        </IconButton>
        <IconButton label="Close" onClick={() => tasks.closePeek()}>
          <X />
        </IconButton>
      </header>
      <div className="st-body">
        {shown.error && !data ? (
          <ErrorNotice
            message={shown.error}
            onRetry={() => void shown.reload()}
          />
        ) : !data ? (
          <Loading label="Opening" />
        ) : (
          <>
            <h2 dir="auto">{title}</h2>
            {"doc" in data ? (
              data.doc.content.length ? (
                data.doc.content
                  .map((block) => textOf(block as { text?: string }))
                  .filter(Boolean)
                  .map((line, index) => (
                    <p key={index} className="st-notes" dir="auto">
                      {line}
                    </p>
                  ))
              ) : (
                <p className="st-hint">This page is empty.</p>
              )
            ) : (
              <>
                {data.project.summary && (
                  <p dir="auto">{data.project.summary}</p>
                )}
                <p className="st-hint">
                  {data.project.done_count} of {data.project.task_count} tasks
                  done
                  {data.project.deadline &&
                    ` · Latest date ${new Date(data.project.deadline).toLocaleDateString()}`}
                </p>
                <ul className="st-links">
                  {data.project.stages.map((stage) => (
                    <li key={stage.id} dir="auto">
                      {stage.name}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </aside>,
    document.body,
  );
}
