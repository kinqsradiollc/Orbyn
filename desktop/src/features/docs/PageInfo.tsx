import { useEffect, useRef, useState } from "react";
import { Folder, Info, Link2, Users, X } from "lucide-react";
import {
  dateLabel,
  savedAgo,
  type Doc,
  type DocInfo,
  type DocTag,
  type DocViewer,
  type OutlineEntry,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { DocOutline } from "./DocOutline";
import { DocViewers } from "./DocViewers";
import { PageFreshness } from "./PageFreshness";
import { PageTags } from "./PageTags";

/**
 * A page's Info (NAV-04): one slim rail beside the page, opened with ⓘ,
 * that holds the facts that used to stack above the words: what it belongs
 * to, its tags, what links here, its contents, its versions, who's here and
 * whether it's still true. Sections with nothing to say are left out.
 * (Fields join it with saved views.)
 */
export function PageInfo({
  doc,
  tags,
  canWrite,
  reading,
  outline,
  current,
  viewers,
  facts,
  revision,
  onTags,
  onJump,
  onOpenProject,
  onShowHistory,
  onShowLinked,
  onClose,
  report,
}: {
  doc: Doc;
  tags: DocTag[];
  canWrite: boolean;
  reading: boolean;
  outline: OutlineEntry[];
  current: number;
  viewers: DocViewer[];
  /** "1,204 words · 5 min read · Saved 2 min ago". */
  facts: string;
  /** Changes when the page is saved, so versions and links read afresh. */
  revision: string | number;
  onTags: (tags: DocTag[]) => void;
  onJump: (entry: OutlineEntry) => void;
  onOpenProject?: (id: string) => void;
  onShowHistory: () => void;
  /** Scroll to "Linked here" under the page. */
  onShowLinked: () => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [asked, setAsked] = useState(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    let live = true;
    client.docInfo(doc.id).then(
      (next) => live && setInfo(next),
      (e) => live && reportRef.current(e),
    );
    return () => {
      live = false;
    };
  }, [doc.id, revision, asked]);

  const belongs = [
    info?.team ? `In ${info.team.name}` : "Only you",
    info?.folder ? `Folder: ${info.folder.name}` : null,
  ].filter(Boolean);
  return (
    <aside className="page-info" aria-label="Page info">
      <div className="page-info-head">
        <h2>
          <Info size={15} aria-hidden="true" /> Info
        </h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close info"
          title="Close info"
        >
          <X size={15} />
        </button>
      </div>
      <p className="page-info-facts">{facts}</p>

      <section className="page-info-section">
        <h3>Belongs to</h3>
        {info?.project && (
          <button
            className="page-info-link"
            onClick={() => onOpenProject?.(info.project!.id)}
            disabled={!onOpenProject}
          >
            Project: {info.project.name}
          </button>
        )}
        {info?.event && (
          <p className="page-info-line">
            Notes for {info.event.title}
            {info.event.due_at ? ` · ${dateLabel(info.event.due_at)}` : ""}
          </p>
        )}
        <p className="page-info-line">
          {info?.team ? (
            <Users size={13} aria-hidden="true" />
          ) : (
            <Folder size={13} aria-hidden="true" />
          )}
          {belongs.join(" · ")}
        </p>
      </section>

      {(tags.length > 0 || (canWrite && !reading)) && (
        <section className="page-info-section">
          <h3>Tags</h3>
          <PageTags
            docId={doc.id}
            teamId={doc.team_id}
            tags={tags}
            canWrite={canWrite && !reading}
            onChange={onTags}
            report={report}
          />
        </section>
      )}

      {!!info?.linked_here && (
        <section className="page-info-section">
          <h3>Linked here</h3>
          <button className="page-info-link" onClick={onShowLinked}>
            <Link2 size={13} aria-hidden="true" />
            {info.linked_here === 1
              ? "1 place links here"
              : `${info.linked_here} places link here`}
          </button>
        </section>
      )}

      {outline.length > 0 && (
        <section className="page-info-section">
          <DocOutline
            outline={outline}
            current={current}
            onJump={onJump}
            className="page-info-outline"
          />
        </section>
      )}

      {!!info?.versions.count && (
        <section className="page-info-section">
          <h3>Versions</h3>
          <ul className="page-info-versions">
            {info.versions.recent.map((v) => (
              <li key={v.version}>
                <span>{v.author ?? "Someone"}</span>
                <small>{savedAgo(v.created_at)}</small>
              </li>
            ))}
          </ul>
          <button className="page-info-link" onClick={onShowHistory}>
            {info.versions.count > info.versions.recent.length
              ? `All ${info.versions.count} versions`
              : "Show history"}
          </button>
        </section>
      )}

      {viewers.length > 0 && (
        <section className="page-info-section">
          <h3>Here now</h3>
          <DocViewers viewers={viewers} />
        </section>
      )}

      {doc.kind === "doc" && (
        <section className="page-info-section">
          <h3>Confirmed still true</h3>
          <PageFreshness
            doc={{
              ...doc,
              reviewed_at: info?.reviewed_at ?? doc.reviewed_at,
            }}
            canWrite={info?.can_write ?? canWrite}
            always
            onReviewed={() => setAsked((n) => n + 1)}
          />
        </section>
      )}
    </aside>
  );
}
