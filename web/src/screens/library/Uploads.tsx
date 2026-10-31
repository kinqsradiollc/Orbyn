import {
  IMPORT_ACCEPT,
  IMPORT_ACTIVE,
  IMPORT_LIMITS,
  importHint,
  importRefusal,
  importStatusLine,
  importTypeOf,
  type ImportCapabilities,
  type ImportJob,
} from "@orbyn/core";
import { FileUp, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { navigate } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  ErrorNotice,
  IconButton,
  Loading,
  useToast,
} from "../../ui/kit";
import { goTo, loadLibrary } from "./store";

type Uploads = {
  jobs: ImportJob[];
  caps: ImportCapabilities | null;
  busy: boolean;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  importFiles: (files: File[]) => Promise<void>;
  remove: (job: ImportJob) => Promise<void>;
};

const UploadsContext = createContext<Uploads | null>(null);

export function useUploads() {
  const uploads = useContext(UploadsContext);
  if (!uploads) throw new Error("useUploads needs UploadsProvider");
  return uploads;
}

export function UploadsProvider({
  projectId,
  projectTeamId,
  children,
}: {
  projectId?: string;
  projectTeamId?: string | null;
  children: ReactNode;
}) {
  const toast = useToast();
  const alive = useRef(true);
  const request = useRef(0);
  const uploading = useRef(false);
  const seen = useRef(new Set<string>());
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [caps, setCaps] = useState<ImportCapabilities | null>(null);
  const [starting, setStarting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const id = ++request.current;
    try {
      const list = await client.listImports();
      if (!alive.current || id !== request.current) return;
      const fresh = list.filter(
        (job) => job.status === "ready" && !seen.current.has(job.id),
      );
      list.forEach((job) => {
        if (job.status === "ready") seen.current.add(job.id);
      });
      if (fresh.length) void loadLibrary();
      setJobs(list);
      setError("");
    } catch (failure) {
      if (alive.current && id === request.current)
        setError(messageOf(failure, "Couldn't load imports."));
    } finally {
      if (alive.current && id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    client.importCapabilities().then(
      (next) => alive.current && setCaps(next),
      () => {},
    );
    return () => {
      alive.current = false;
      request.current++;
    };
  }, [refresh]);

  const active = jobs.some((job) => IMPORT_ACTIVE.includes(job.status));
  useEffect(() => {
    if (!active && !starting) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, starting, refresh]);

  const refuse = useCallback(
    (text: string) => toast({ text, error: true }),
    [toast],
  );

  const importFiles = useCallback(
    async (files: File[]) => {
      if (uploading.current) return;
      uploading.current = true;
      try {
        for (const file of files) {
          if (!alive.current) break;
          const refused = importRefusal(file.name, file.type);
          if (refused) {
            refuse(refused);
            continue;
          }
          const type = importTypeOf(file.name, file.type);
          if (caps && !caps.enabled) {
            refuse("Importing files isn't set up on this server yet.");
            return;
          }
          if ((type === "png" || type === "jpeg") && caps && !caps.photos) {
            refuse(
              `${file.name}: photos of notes can't be read on this server. Import a PDF or Word file instead.`,
            );
            continue;
          }
          if (file.size > IMPORT_LIMITS.maxBytes) {
            refuse(
              `${file.name} is over the ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB limit.`,
            );
            continue;
          }
          setStarting((count) => count + 1);
          let startedId: string | null = null;
          try {
            const { upload_path, import: started } = await client.createImport({
              file_name: file.name,
              bytes: file.size,
              mime: file.type || undefined,
              project_id: projectId,
              project_team_id: projectId ? projectTeamId : undefined,
            });
            startedId = started.id;
            await refresh();
            await client.uploadImportFile(upload_path, file, file.type);
          } catch (failure) {
            refuse(messageOf(failure, `Couldn't import ${file.name}.`));
            // The bytes never arrived, so nothing is left waiting for them.
            if (startedId) await client.removeImport(startedId).catch(() => {});
          } finally {
            if (alive.current) {
              setStarting((count) => count - 1);
              void refresh();
            }
          }
        }
      } finally {
        uploading.current = false;
      }
    },
    [caps, projectId, projectTeamId, refresh, refuse],
  );

  const remove = useCallback(
    async (job: ImportJob) => {
      try {
        await client.removeImport(job.id);
        setJobs((all) => all.filter((next) => next.id !== job.id));
        await refresh();
      } catch (failure) {
        refuse(messageOf(failure, "Couldn't remove this import."));
      }
    },
    [refresh, refuse],
  );

  const value = useMemo(
    () => ({
      jobs,
      caps,
      busy: starting > 0,
      loading,
      error,
      refresh,
      importFiles,
      remove,
    }),
    [jobs, caps, starting, loading, error, refresh, importFiles, remove],
  );
  return (
    <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>
  );
}

/** The import control: a real button over a hidden file input. */
export function ImportButton({
  variant = "secondary",
  label = "Import file",
}: {
  variant?: "primary" | "secondary" | "ghost";
  label?: string;
}) {
  const uploads = useUploads();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant={variant}
        disabled={uploads.busy}
        title="Import a PDF, Word file or photo of notes"
        onClick={() => input.current?.click()}
      >
        <FileUp /> {uploads.busy ? "Uploading…" : label}
      </Button>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept={IMPORT_ACCEPT}
        aria-label="Choose files to import"
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length) {
            goTo({ at: "uploads" });
            navigate("/app/docs");
            void uploads.importFiles(files);
          }
        }}
      />
    </>
  );
}

export function keepOriginalsLabel(keep: boolean) {
  return keep ? "Keep the original file" : "Original files aren't kept";
}

/** Files being read, and the switch for keeping what was imported. */
export function UploadsPanel() {
  const uploads = useUploads();
  const toast = useToast();
  const [keep, setKeep] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    client.originals().then(
      (next) => live && setKeep(next.keep),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  const shown = uploads.jobs.filter((job) => job.status !== "ready");
  return (
    <section className="lib-uploads" aria-label="Imports">
      <div className="lib-uploads-head">
        <p className="small muted">{importHint(uploads.caps)}</p>
        {keep !== null && (
          <label className="check small">
            <input
              type="checkbox"
              checked={keep}
              disabled={busy}
              onChange={(event) => {
                const next = event.currentTarget.checked;
                setBusy(true);
                client
                  .setKeepOriginals(next)
                  .then(
                    () => setKeep(next),
                    (failure) =>
                      toast({
                        text: messageOf(failure, "Couldn't change this."),
                        error: true,
                      }),
                  )
                  .finally(() => setBusy(false));
              }}
            />
            Keep the original
          </label>
        )}
      </div>
      {uploads.error && (
        <ErrorNotice
          message={uploads.error}
          onRetry={() => void uploads.refresh()}
        />
      )}
      {uploads.loading && !uploads.error && <Loading label="Loading imports" />}
      {shown.length > 0 && (
        <ul className="lib-joblist">
          {shown.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onRemove={() => void uploads.remove(job)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function JobRow({ job, onRemove }: { job: ImportJob; onRemove: () => void }) {
  const active = IMPORT_ACTIVE.includes(job.status);
  const share =
    job.status === "ocr" && job.ocr_pages
      ? Math.round((job.ocr_done / job.ocr_pages) * 100)
      : null;
  return (
    <li className="lib-job">
      <div className="row-main">
        <div className="row-title" dir="auto">
          {job.file_name}
        </div>
        <div
          className={`small ${job.status === "failed" ? "lib-job-error" : "muted"}`}
        >
          {job.status === "failed"
            ? job.error || "This file couldn't be read."
            : importStatusLine(job)}
        </div>
        {active && (
          <progress
            className="lib-progress"
            aria-label={`Importing ${job.file_name}`}
            value={share ?? undefined}
            max={share === null ? undefined : 100}
          />
        )}
      </div>
      {job.status === "failed" && (
        <ImportButton variant="ghost" label="Import again" />
      )}
      <IconButton
        label={
          active
            ? `Cancel importing ${job.file_name}`
            : `Remove ${job.file_name}`
        }
        onClick={onRemove}
      >
        <X />
      </IconButton>
    </li>
  );
}
