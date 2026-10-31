import {
  docStats,
  fileSize,
  pageFreshness,
  type Doc,
  type DocInfo,
  type PageFile,
} from "@orbyn/core";
import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { navigate } from "../../../lib/router";
import { client } from "../../../lib/session";
import {
  Button,
  ErrorNotice,
  IconButton,
  Input,
  Loading,
  useConfirm,
  useToast,
} from "../../../ui/kit";
import { FieldsPanel } from "../../views/Fields";
import { when } from "../model";
import { loadLibrary } from "../store";
import type { Page } from "./usePage";

export function InfoPanel({
  page,
  doc,
  canWrite,
  onClose,
}: {
  page: Page;
  doc: Doc;
  canWrite: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [files, setFiles] = useState<PageFile[]>([]);
  const [aliases, setAliases] = useState(doc.aliases ?? []);
  const [alias, setAlias] = useState("");
  const version = page.session?.saved.version;
  useEffect(() => {
    let live = true;
    setError("");
    client.docInfo(doc.id).then(
      (next) => live && setInfo(next),
      (failure) =>
        live && setError(messageOf(failure, "Page info couldn't be loaded.")),
    );
    client.pageFiles(doc.id).then(
      (list) => live && setFiles(list),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [doc.id, version, attempt]);
  const stats = docStats(page.leaves);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [note, setNote] = useState("");
  const review = async (
    input:
      { verdict: "still_true" } | { verdict: "needs_update"; note: string },
  ) => {
    try {
      await client.reviewDoc(doc.id, input);
      setNeedsUpdate(false);
      setNote("");
      setAttempt((n) => n + 1);
      void loadLibrary();
      toast({
        text:
          input.verdict === "still_true"
            ? "Confirmed up to date."
            : "A task was added to update this page.",
      });
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't update this page."),
        error: true,
      });
    }
  };
  const saveAliases = (next: string[]) =>
    client.setDocAliases(doc.id, next).then(
      () => setAliases(next),
      (failure) =>
        toast({
          text: messageOf(failure, "Couldn't change other names."),
          error: true,
        }),
    );
  const fresh = info ? pageFreshness(info.updated_at, info.reviewed_at) : null;
  return (
    <div className="page-panel-body">
      <div className="page-panel-head">
        <h2>Info</h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="small muted">
        {stats.words} words · {stats.minutes} min read
      </p>
      {error && (
        <ErrorNotice message={error} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {!info && !error && <Loading label="Loading page info" />}
      {info && (
        <dl className="page-facts small">
          <dt>Space</dt>
          <dd dir="auto">{info.team ? info.team.name : "Only you"}</dd>
          {info.folder && (
            <>
              <dt>Folder</dt>
              <dd dir="auto">{info.folder.name}</dd>
            </>
          )}
          {info.project && (
            <>
              <dt>Project</dt>
              <dd>
                <button
                  type="button"
                  className="doc-textlink"
                  dir="auto"
                  onClick={() => navigate(`/app/project/${info.project!.id}`)}
                >
                  {info.project.name}
                </button>
              </dd>
            </>
          )}
          {info.event && (
            <>
              <dt>Event</dt>
              <dd dir="auto">{info.event.title}</dd>
            </>
          )}
          <dt>Changed</dt>
          <dd>{when(info.updated_at)}</dd>
          {fresh && fresh.state !== "fresh" && (
            <>
              <dt>Status</dt>
              <dd>Not confirmed for {fresh.days} days</dd>
            </>
          )}
          <dt>Linked here</dt>
          <dd>{info.linked_here}</dd>
          <dt>Versions</dt>
          <dd>{info.versions.count}</dd>
        </dl>
      )}
      {canWrite && info?.can_write && (
        <section className="page-fresh">
          <h3>Is this page still true?</h3>
          <div className="page-look-row">
            <Button onClick={() => void review({ verdict: "still_true" })}>
              Still true
            </Button>
            <Button
              variant="ghost"
              onClick={() => setNeedsUpdate(!needsUpdate)}
            >
              Needs updating
            </Button>
          </div>
          {needsUpdate && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void review({ verdict: "needs_update", note: note.trim() });
              }}
            >
              <Input
                aria-label="What's changed"
                placeholder="What's changed"
                value={note}
                onChange={(event) => setNote(event.currentTarget.value)}
              />
            </form>
          )}
        </section>
      )}
      <FieldsPanel
        target="page"
        targetId={doc.id}
        revision={page.fieldsStamp}
      />
      <section>
        <h3>Other names</h3>
        <div className="doc-tags">
          {aliases.map((one) => (
            <span key={one} className="lib-tag" dir="auto">
              {one}
              {canWrite && (
                <button
                  type="button"
                  aria-label={`Remove ${one}`}
                  onClick={() =>
                    void saveAliases(aliases.filter((other) => other !== one))
                  }
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
        {canWrite && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = alias.trim();
              if (!name || aliases.includes(name)) return;
              setAlias("");
              void saveAliases([...aliases, name]);
            }}
          >
            <Input
              aria-label="Add another name"
              placeholder="Add another name"
              value={alias}
              onChange={(event) => setAlias(event.currentTarget.value)}
            />
          </form>
        )}
      </section>
      {!!info?.sources.length && (
        <section>
          <h3>Sources</h3>
          <ul className="page-files">
            {info.sources.map((source) => (
              <li key={source.id}>
                <a
                  className="row-main small"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  dir="auto"
                >
                  {source.title || source.url}
                </a>
                {canWrite && (
                  <IconButton
                    label={`Remove ${source.title || "source"}`}
                    onClick={() =>
                      void client.removePageSource(doc.id, source.id).then(
                        () => setAttempt((n) => n + 1),
                        (failure) =>
                          toast({
                            text: messageOf(
                              failure,
                              "Couldn't remove this source.",
                            ),
                            error: true,
                          }),
                      )
                    }
                  >
                    <X />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {files.length > 0 && (
        <section>
          <h3>Files on this page</h3>
          <ul className="page-files">
            {files.map((file) => (
              <li key={file.id}>
                <span className="row-main small" dir="auto">
                  {file.name} · {fileSize(file.bytes)}
                </span>
                {canWrite && (
                  <IconButton
                    label={`Delete ${file.name}`}
                    onClick={() =>
                      void confirm({
                        title: "Delete this file for good?",
                        body: file.name,
                        action: "Delete",
                        danger: true,
                      }).then((ok) => {
                        if (!ok) return;
                        void client.deletePageFile(file.id).then(
                          () =>
                            setFiles((all) =>
                              all.filter((one) => one.id !== file.id),
                            ),
                          (failure) =>
                            toast({
                              text: messageOf(
                                failure,
                                "Couldn't delete this file.",
                              ),
                              error: true,
                            }),
                        );
                      })
                    }
                  >
                    <Trash2 />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
