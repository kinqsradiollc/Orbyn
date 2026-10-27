import { session } from "../../../lib/session";
import { useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  File as FileIcon,
  Folder,
  Image as ImageIcon,
  Info,
  Link2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  dateLabel,
  fileSize,
  savedAgo,
  sourceReadLabel,
  type Doc,
  type DocInfo,
  type DocTag,
  type DocViewer,
  type OutlineEntry,
  type PageFile,
  type PageFilesUsage,
  type PageSource,
} from "@orbyn/core";
import { useConfirm } from "../../../components/Confirm";
import { client } from "../../../lib/api";
import { DocOutline } from "../editor/DocOutline";
import { DocViewers } from "../collaboration/DocViewers";
import { PageFreshness } from "./PageFreshness";
import { PageTags } from "./PageTags";
import { FieldsPanel } from "../../views/FieldsPanel";
import { AliasesField } from "./AliasesField";
import { downloadFile } from "../editor/RichBlocks";
import { saveBlob } from "../editor/OriginalFile";
import { ConnectionsMap } from "../../connections/ConnectionsMap";

/**
 * A page's Info (NAV-04): one slim rail beside the page, opened with ⓘ,
 * that holds the facts that used to stack above the words: what it belongs
 * to, its tags, what links here, its contents, its versions, who's here and
 * whether it's still true, and your own fields (ORG-02). Sections with
 * nothing to say are left out.
 */
export function PageInfo(props: Parameters<typeof PageInfoBody>[0]) {
  return <PageInfoBody key={`${session.get()}:${props.doc.id}`} {...props} />;
}

function PageInfoBody({
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
  starredHeadings,
  onStarHeading,
  onOpenProject,
  onShowHistory,
  onShowLinked,
  onClose,
  report,
  hidden = false,
}: {
  doc: Doc;
  hidden?: boolean;
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
  /** Starred headings by block id, and starring one (NAV-07). */
  starredHeadings?: Set<string>;
  onStarHeading?: (entry: OutlineEntry) => void;
  onOpenProject?: (id: string) => void;
  onShowHistory: () => void;
  /** Scroll to "Linked here" under the page. */
  onShowLinked: () => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const account = useRef(session.get()).current;
  const [hasOpened, setHasOpened] = useState(!hidden);
  useEffect(() => {
    if (!hidden) setHasOpened(true);
  }, [hidden]);
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [asked, setAsked] = useState(0);
  const [failed, setFailed] = useState(false);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    if (hidden) return;
    let live = true;
    setFailed(false);
    client.docInfo(doc.id).then(
      (next) => live && session.get() === account && setInfo(next),
      (error) => {
        if (live && session.get() === account) {
          setFailed(true);
          reportRef.current(error);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [doc.id, revision, asked, hidden]);

  const belongs = [
    info?.team ? `In ${info.team.name}` : "Only you",
    info?.folder ? `Folder: ${info.folder.name}` : null,
  ].filter(Boolean);
  if (!hasOpened) return null;
  return (
    <aside
      className="page-info"
      hidden={hidden}
      style={hidden ? { display: "none" } : undefined}
      aria-label="Page info"
    >
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

      {failed && (
        <p role="alert">
          Page info couldn’t be loaded.{" "}
          <button
            className="text-button"
            onClick={() => setAsked((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {info && (
        <section className="page-info-section">
          <h3>Location</h3>
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
      )}

      <AliasesSection
        doc={doc}
        canWrite={canWrite && !reading}
        report={report}
      />

      {doc.original && (
        <section className="page-info-section">
          <h3>Original file</h3>
          <button
            className="page-info-link"
            onClick={() =>
              void client
                .downloadOriginal(doc.id)
                .then(({ blob, name }) => saveBlob(blob, name), report)
            }
          >
            <Download size={13} aria-hidden="true" />
            {doc.original.file_name}
          </button>
        </section>
      )}

      <FilesSection
        docId={doc.id}
        canWrite={canWrite && !reading}
        revision={revision}
        report={report}
      />

      {!!info?.sources?.length && (
        <SourcesSection
          docId={doc.id}
          sources={info.sources}
          canWrite={(info?.can_write ?? canWrite) && !reading}
          onRemoved={() => setAsked((n) => n + 1)}
          report={report}
        />
      )}

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

      <FieldsPanel
        target="page"
        targetId={doc.id}
        revision={revision}
        report={report}
      />

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

      <ConnectionsMap
        kind="doc"
        id={doc.id}
        revision={revision}
        report={report}
      />

      {outline.length > 0 && (
        <section className="page-info-section">
          <DocOutline
            outline={outline}
            current={current}
            onJump={onJump}
            starred={starredHeadings}
            onStar={onStarHeading}
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

/**
 * Sources an agent read and saved for this page (H2): each one's title
 * (opening its address in a new tab), site, author, the day it was read
 * and the words it quoted. Orbyn itself never opens them.
 */
function SourcesSection({
  docId,
  sources,
  canWrite,
  onRemoved,
  report,
}: {
  docId: string;
  sources: PageSource[];
  canWrite: boolean;
  onRemoved: () => void;
  report: (e: unknown) => void;
}) {
  const { ask } = useConfirm();
  const mutation = useRef(false);
  const [busy, setBusy] = useState(false);
  // Taking a source off the page (H6b): the page's words stay as they are,
  // and the source stays for other pages that use it.
  const remove = async (src: PageSource) => {
    if (!canWrite || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      if (
        !(await ask({
          title: "Remove source?",
          body: `Removes “${src.title}” from this page. Page text and other citations stay.`,
          confirmLabel: "Remove",
          destructive: true,
        }))
      )
        return;
      await client.removePageSource(docId, src.id);
      onRemoved();
    } catch (error) {
      report(error);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="page-info-section">
      <h3>Sources</h3>
      <ul className="page-info-sources">
        {sources.map((src) => (
          <li key={src.id}>
            <a
              className="page-info-link"
              href={src.url}
              target="_blank"
              rel="noreferrer noopener"
              title={src.url}
            >
              <span>{src.title}</span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
            <small>
              {[src.site, src.author, sourceReadLabel(src.accessed_on)]
                .filter(Boolean)
                .join(" · ")}
            </small>
            {src.quote && <blockquote>{src.quote}</blockquote>}
            {canWrite && (
              <button
                className="icon-button page-info-source-remove"
                disabled={busy}
                onClick={() => void remove(src)}
                aria-label={`Remove ${src.title} from this page`}
                title="Remove from this page"
              >
                <Trash2 size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Also called": a page's other names (LNK-03). */
function AliasesSection({
  doc,
  canWrite,
  report,
}: {
  doc: Doc;
  canWrite: boolean;
  report: (e: unknown) => void;
}) {
  const [aliases, setAliases] = useState(doc.aliases ?? []);
  useEffect(() => setAliases(doc.aliases ?? []), [doc.id, doc.aliases]);
  if (!canWrite && !aliases.length) return null;
  return (
    <section className="page-info-section">
      <h3>Also called</h3>
      <AliasesField
        aliases={aliases}
        canWrite={canWrite}
        onSave={(next) =>
          client.setDocAliases(doc.id, next).then(
            (r) => {
              setAliases(r.aliases);
              return r.aliases;
            },
            (e) => {
              report(e);
              throw e;
            },
          )
        }
      />
    </section>
  );
}

/**
 * The pictures and files on a page (EDT-01), with how much of your space
 * they all take. Removing one here frees its space at once; a picture
 * whose line is removed from every page frees it 30 days later.
 */
function FilesSection({
  docId,
  canWrite,
  revision,
  report,
}: {
  docId: string;
  canWrite: boolean;
  revision: string | number;
  report: (e: unknown) => void;
}) {
  const { ask } = useConfirm();
  const [files, setFiles] = useState<PageFile[]>([]);
  const [usage, setUsage] = useState<PageFilesUsage | null>(null);
  const mutation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(0);
  const [failed, setFailed] = useState(false);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    let live = true;
    setFailed(false);
    Promise.all([client.pageFiles(docId), client.filesUsage()]).then(
      ([list, used]) => {
        if (!live) return;
        setFiles(list);
        setUsage(used);
      },
      (error) => {
        if (live) {
          setFailed(true);
          reportRef.current(error);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [docId, revision, asked]);
  // The space is always shown, so someone near the limit sees it on any page.
  if (!files.length && !usage)
    return failed ? (
      <p role="alert">
        Files couldn’t be loaded.{" "}
        <button
          className="text-button"
          onClick={() => setAsked((value) => value + 1)}
        >
          Retry
        </button>
      </p>
    ) : null;
  const remove = async (file: PageFile) => {
    if (!canWrite || file.doc_id !== docId || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      if (
        !(await ask({
          title: "Delete file?",
          body: `Permanently deletes “${file.name}”. Pages using this file will show it as missing.`,
          confirmLabel: "Delete",
          destructive: true,
        }))
      )
        return;
      await client.deletePageFile(file.id);
      setAsked((value) => value + 1);
    } catch (error) {
      report(error);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const share = usage?.quota_bytes
    ? Math.min(100, (usage.used_bytes / usage.quota_bytes) * 100)
    : 0;
  return (
    <section className="page-info-section">
      <h3>Pictures and files</h3>
      {files.length > 0 && (
        <ul className="page-info-files">
          {files.map((f) => (
            <li key={f.id}>
              <button
                className="page-info-link"
                onClick={() => void downloadFile(f.id).catch(report)}
                title={`Download ${f.name}`}
              >
                {f.kind === "image" ? (
                  <ImageIcon size={13} aria-hidden="true" />
                ) : (
                  <FileIcon size={13} aria-hidden="true" />
                )}
                <span>{f.name}</span>
              </button>
              <small>{fileSize(f.bytes)}</small>
              {/* Only the page a file was added to can delete it; a copy
                pasted here goes when its line does. */}
              {canWrite && f.doc_id === docId && (
                <button
                  className="icon-button"
                  onClick={() => void remove(f)}
                  disabled={busy}
                  aria-label={`Delete ${f.name}`}
                  title="Delete for good"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {usage && (
        <div className="page-info-space">
          <div
            className="page-info-space-bar"
            role="meter"
            aria-label="Your space for pictures and files"
            aria-valuemin={0}
            aria-valuemax={usage.quota_bytes}
            aria-valuenow={usage.used_bytes}
          >
            <span style={{ width: `${share}%` }} />
          </div>
          <small>
            {fileSize(usage.used_bytes)} of {fileSize(usage.quota_bytes)} used
            across your pages.
          </small>
          <details>
            <summary>Storage details</summary>
            <p>
              Removed pictures free space after 30 days. Trash keeps files until
              emptied.
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
