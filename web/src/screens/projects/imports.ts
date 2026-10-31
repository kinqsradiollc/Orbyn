import {
  IMPORT_ACTIVE,
  IMPORT_LIMITS,
  importRefusal,
  importTypeOf,
  type ImportCapabilities,
  type ImportJob,
} from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";

/** Files turned into a project's pages. A failed upload leaves no waiting job. */
export function useImports(
  report: (message: string) => void,
  onReady: () => void,
  projectId: string,
  projectTeamId: string | null,
) {
  const alive = useRef(true);
  const uploading = useRef(false);
  const seen = useRef(new Set<string>());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [starting, setStarting] = useState(0);
  const [caps, setCaps] = useState<ImportCapabilities | null>(null);
  const [loadError, setLoadError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const list = await client.listImports();
      if (!alive.current) return;
      const fresh = list.filter(
        (j) => j.status === "ready" && !seen.current.has(j.id),
      );
      for (const job of list)
        if (job.status === "ready") seen.current.add(job.id);
      if (fresh.length) onReadyRef.current();
      setJobs(list);
      setLoadError("");
    } catch (failure) {
      if (alive.current) setLoadError(messageOf(failure, "Files unavailable."));
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void client.importCapabilities().then(
      (next) => alive.current && setCaps(next),
      () => undefined,
    );
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  const active = jobs.some((j) => IMPORT_ACTIVE.includes(j.status));
  useEffect(() => {
    if (!active && !starting) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, starting, refresh]);
  const importFiles = async (files: File[]) => {
    if (uploading.current) return;
    uploading.current = true;
    try {
      for (const file of files) {
        const refused = importRefusal(file.name, file.type);
        if (refused) {
          report(refused);
          continue;
        }
        const type = importTypeOf(file.name, file.type);
        if (caps && !caps.enabled)
          return report("Importing files isn't set up on this server yet.");
        if ((type === "png" || type === "jpeg") && caps && !caps.photos) {
          report(
            `${file.name}: photos of notes can't be read on this server. Import a PDF or Word file instead.`,
          );
          continue;
        }
        if (file.size > IMPORT_LIMITS.maxBytes) {
          report(
            `${file.name} is over the ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB limit.`,
          );
          continue;
        }
        setStarting((n) => n + 1);
        let started: string | null = null;
        try {
          const made = await client.createImport({
            file_name: file.name,
            bytes: file.size,
            mime: file.type || undefined,
            project_id: projectId,
            project_team_id: projectTeamId,
          });
          started = made.import.id;
          await refresh();
          await client.uploadImportFile(made.upload_path, file, file.type);
        } catch (failure) {
          report(messageOf(failure, `Couldn't add ${file.name}.`));
          if (started)
            await client.removeImport(started).catch(() => undefined);
        } finally {
          if (alive.current) {
            setStarting((n) => n - 1);
            void refresh();
          }
        }
      }
    } finally {
      uploading.current = false;
    }
  };
  return { jobs, importFiles, busy: starting > 0, loadError, refresh };
}
