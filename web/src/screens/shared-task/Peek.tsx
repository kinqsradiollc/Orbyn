import { useRouteScope, useRouteInput } from "../../lib/route-scope";
import { plainText, type Doc, type Project } from "@orbyn/core";
import { Boxes, FileText, Maximize2, Pin, PinOff, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useResource } from "../../lib/resource";
import { useNavigate } from "../../lib/router";
import { client, getSessionVersion } from "../../lib/session";
import { ErrorNotice, IconButton, Loading } from "../../ui/kit";
import { useTasks, type PeekTarget } from "./host-store";

type Loaded = { doc: Doc } | { project: Project };

const textOf = (block: { text?: string }) =>
  block.text ? plainText(block.text).trim() : "";

/** A page or project read beside the screen you are on, without leaving it. */
export function Peek({
  target,
  pinned,
  onClose,
}: {
  target: PeekTarget;
  pinned: boolean;
  onClose: () => void;
}) {
  const tasks = useTasks();
  const scope = useRouteScope();
  const inputAllowed = useRouteInput();
  const navigate = useNavigate();
  const box = useRef<HTMLElement>(null);
  const shown = useResource<Loaded>(
    async () =>
      target.kind === "doc"
        ? { doc: await client.getDoc(target.id) }
        : { project: await client.getProject(target.id) },
    [target.kind, target.id],
  );
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null,
      root = box.current,
      generation = getSessionVersion();
    const allowed = () =>
      generation === getSessionVersion() &&
      (!scope || (scope.getSnapshot().visible && scope.getSnapshot().focused));
    if (allowed()) root?.focus({ preventScroll: true });
    return () => {
      const ownedFocus =
        !!root?.contains(document.activeElement) ||
        document.activeElement === document.body;
      if (
        allowed() &&
        ownedFocus &&
        opener?.isConnected &&
        !opener.closest("[inert]") &&
        !opener.matches(":disabled") &&
        !document.querySelector("dialog[open]")
      )
        opener.focus({ preventScroll: true });
    };
  }, [scope]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!inputAllowed() || event.key !== "Escape" || event.defaultPrevented)
        return;
      if (document.querySelector("dialog[open], .menu")) return;
      onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [inputAllowed, onClose]);
  const data = shown.data;
  const title = !data
    ? ""
    : "doc" in data
      ? data.doc.title || "Untitled"
      : data.project.name;
  const openFull = () => {
    navigate(`/app/${target.kind}/${target.id}`);
    if (!pinned) onClose();
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
        <IconButton label="Close" onClick={onClose}>
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
