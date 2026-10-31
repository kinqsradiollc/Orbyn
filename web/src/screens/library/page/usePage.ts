import { DocEditorStore, type DocNews } from "@orbyn/api-client";
import {
  docEditorSessionDirty,
  isOfflineError,
  mergeVersionedDocContent,
  parseVersionedDocContent,
  versionedDocContentKey,
  versionedDocSource,
  type Doc,
  type DocContentOperation,
  type VersionedDocContent,
} from "@orbyn/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import { loadLibrary, patchDocs } from "../store";
import { watchPage } from "../streams";
import { leavesOf } from "./tree";

const SAVE_AFTER_MS = 900;
const RETRY_MS = 12_000;

type Backup = {
  version: number;
  baseTitle: string;
  title: string;
  base: VersionedDocContent;
  document: VersionedDocContent;
  at: string;
};

const backupKey = (userId: string, id: string) =>
  `orbyn-page-draft:${userId}:${id}`;

function readBackup(key: string): Backup | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Backup;
    return {
      ...value,
      base: parseVersionedDocContent(value.base, { projected: true }),
      document: parseVersionedDocContent(value.document, { projected: true }),
    };
  } catch {
    return null;
  }
}
function writeBackup(key: string, value: Backup | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    // A full or refused store only loses the extra copy, not the open draft.
  }
}

const sameDocument = (a: VersionedDocContent, b: VersionedDocContent) =>
  versionedDocContentKey(a, { projected: true }) ===
  versionedDocContentKey(b, { projected: true });

export type SaveStatus =
  | "opening"
  | "unavailable"
  | "saving"
  | "saved"
  | "unsaved"
  | "offline"
  | "failed"
  | "invalid"
  | "conflict";

/**
 * One open page. The shared store owns the draft and the serialized save; this
 * adds the browser's part: autosave, reconnecting, the live stream, and a copy
 * of unsaved work that survives closing the tab.
 */
export function usePage(id: string, userId: string, canWrite: boolean) {
  const store = useMemo(() => new DocEditorStore(client), [id]);
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.state,
  );
  const [gone, setGone] = useState<"trashed" | "forgotten" | null>(null);
  const [fieldsStamp, setFieldsStamp] = useState(0);
  const [tagsStamp, setTagsStamp] = useState(0);
  const [recovery, setRecovery] = useState<Backup | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [news, setNews] = useState("");
  const key = backupKey(userId, id);
  const leaving = useRef(false);
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;

  useEffect(() => {
    leaving.current = false;
    void store.open(id);
  }, [store, id]);

  const session = state.session;
  const dirty = !!session && docEditorSessionDirty(session);
  const blocked =
    !canWrite || state.conflict || state.sourceInvalid || !!state.error;

  // Offer back what a closed tab left behind, once, when the page has opened.
  const offered = useRef(false);
  useEffect(() => {
    if (!session || !canWrite || !userId || offered.current) return;
    offered.current = true;
    const backup = readBackup(key);
    if (!backup) return;
    if (
      backup.title === session.title &&
      sameDocument(backup.document, session.document)
    ) {
      writeBackup(key, null);
      return;
    }
    setRecovery(backup);
  }, [session, key, canWrite, userId]);

  // Keep a copy of anything unsent; clear it the moment the server has it.
  const latestBackup = useRef<Backup | null>(null);
  useEffect(() => {
    if (!session) return;
    if (!dirty) {
      // Only this visit's copy goes. One from an earlier visit waits to be offered.
      if (latestBackup.current) {
        latestBackup.current = null;
        writeBackup(key, null);
      }
      return;
    }
    latestBackup.current = {
      version: session.saved.version,
      baseTitle: session.saved.title,
      title: session.title,
      base: session.saved.document,
      document: session.document,
      at: new Date().toISOString(),
    };
    const timer = window.setTimeout(
      () => writeBackup(key, latestBackup.current),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [session, dirty, key]);

  useEffect(() => {
    const hide = () => {
      if (latestBackup.current) writeBackup(key, latestBackup.current);
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (store.state.session && docEditorSessionDirty(store.state.session)) {
        hide();
        event.preventDefault();
      }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("beforeunload", warn);
    };
  }, [key, store]);

  const announce = useCallback(() => {
    const doc = store.state.doc;
    if (!doc) return;
    patchDocs((row) =>
      row.id === doc.id
        ? {
            ...row,
            title: doc.title,
            updated_at: doc.updated_at,
            version: doc.version,
          }
        : row,
    );
  }, [store]);

  const save = useCallback(
    async (retry = false) => {
      const before = store.state.doc?.version;
      if (retry) await store.retrySave();
      else await store.save();
      if (store.state.doc && store.state.doc.version !== before) announce();
    },
    [store, announce],
  );

  /** Keep saving until nothing is unsent or something needs a person. */
  const flush = useCallback(async () => {
    for (let turn = 0; turn < 6; turn++) {
      const current = store.state;
      if (!current.session || !docEditorSessionDirty(current.session))
        return true;
      if (current.conflict || current.sourceInvalid) return false;
      if (current.busy) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }
      await save(!!current.error);
      if (store.state.error) return false;
    }
    return !!store.state.session && !docEditorSessionDirty(store.state.session);
  }, [store, save]);

  useEffect(() => {
    if (
      !session ||
      !dirty ||
      !canWrite ||
      state.busy ||
      state.error ||
      state.conflict
    )
      return;
    const timer = window.setTimeout(() => void save(), SAVE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [session, dirty, canWrite, state.busy, state.error, state.conflict, save]);

  // A failed save goes again by itself once it stands a chance of landing.
  useEffect(() => {
    const up = () => {
      setOnline(true);
      if (store.state.error && !store.state.conflict) void save(true);
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [store, save]);
  useEffect(() => {
    if (!dirty || !state.error || state.conflict || state.sourceInvalid) return;
    const status = (state.error as { statusCode?: number }).statusCode;
    if (status && status < 500 && status !== 408 && status !== 429) return;
    const timer = window.setTimeout(() => {
      if (navigator.onLine !== false) void save(true);
    }, RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, state.error, state.conflict, state.sourceInvalid, save]);

  // News about this page from anywhere else.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = (version: number) => {
      const current = store.state.session;
      if (!current || (version && version <= current.saved.version)) return;
      if (store.state.busy) {
        timer = setTimeout(() => sync(version), 350);
        return;
      }
      const edited = docEditorSessionDirty(current);
      void store.refresh().then(() => {
        announce();
        if (!store.state.conflict && !store.state.error)
          setNews(
            edited
              ? "Merged someone else's changes."
              : "Updated with someone else's changes.",
          );
      });
    };
    const stop = watchPage(id, (version: number, event: DocNews) => {
      if (event.trashed || event.forgotten) {
        latestBackup.current = null;
        writeBackup(key, null);
        store.close();
        setGone(event.forgotten ? "forgotten" : "trashed");
        void loadLibrary();
        return;
      }
      if (event.fields) {
        setFieldsStamp((n) => n + 1);
        return;
      }
      if (event.tags) {
        setTagsStamp((n) => n + 1);
        return;
      }
      sync(version);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [id, store, key, announce]);

  useEffect(() => {
    if (!news) return;
    const timer = setTimeout(() => setNews(""), 6000);
    return () => clearTimeout(timer);
  }, [news]);

  // Leaving sends what is left; a failure keeps the local copy for next time.
  useEffect(
    () => () => {
      leaving.current = true;
      const unsent = !!latestBackup.current;
      if (unsent) writeBackup(key, latestBackup.current);
      void flush().finally(() => {
        const current = store.state.session;
        if (unsent && (!current || !docEditorSessionDirty(current)))
          writeBackup(key, null);
        store.close();
        if (unsent) void loadLibrary();
      });
    },
    [store, key, flush],
  );

  /** A failed save mustn't refuse the next keystroke, so clear it before editing. */
  const ready = useCallback(() => {
    const current = store.state;
    if (current.conflict || current.sourceInvalid) return false;
    if (current.error) {
      if (isOfflineError(current.error)) store.acknowledgeOfflineSave();
      else void store.retrySave();
    }
    return !store.state.error;
  }, [store]);

  const edit = useCallback(
    (operation: DocContentOperation) => {
      if (!ready()) return false;
      const document = store.state.session?.document;
      if (!document) return false;
      store.changeOperation(document, operation);
      return !store.state.error;
    },
    [store, ready],
  );

  const setTitle = useCallback(
    (title: string) => {
      const current = store.state.session;
      if (!current || !ready()) return;
      store.changeTitle(current.title, title);
    },
    [store, ready],
  );

  /** Whole-tree changes the operations can't express go through parsed source. */
  const replaceDocument = useCallback(
    (document: VersionedDocContent) => {
      const current = store.state.session;
      if (!current || !ready()) return false;
      store.changeSource(
        current.document,
        versionedDocSource(document, { projected: true }),
      );
      return !store.state.sourceInvalid;
    },
    [store, ready],
  );

  const recover = useCallback(
    (use: boolean) => {
      const backup = recovery;
      setRecovery(null);
      if (!backup) return "";
      writeBackup(key, null);
      if (!use) return "";
      const current = store.state.session;
      if (!current) return "";
      try {
        const merged = mergeVersionedDocContent(
          backup.base,
          backup.document,
          current.document,
        );
        if (backup.title !== backup.baseTitle) setTitle(backup.title);
        replaceDocument(merged);
        return "";
      } catch (failure) {
        return messageOf(
          failure,
          "This page changed too much to merge your draft.",
        );
      }
    },
    [recovery, key, store, setTitle, replaceDocument],
  );

  /** The open line's box holds its own words, so a new revision replaces it. */
  const [resetKey, setResetKey] = useState(0);
  const replacing = useRef(false);
  const discard = useCallback(async () => {
    latestBackup.current = null;
    writeBackup(key, null);
    replacing.current = true;
    await store.discardLocal();
    setResetKey((n) => n + 1);
  }, [store, key]);
  const adopt = useCallback(
    (doc: Doc) => {
      replacing.current = true;
      store.adopt(doc);
      setResetKey((n) => n + 1);
      announce();
    },
    [store, announce],
  );
  useEffect(() => {
    replacing.current = false;
  }, [resetKey]);

  const document = session?.document ?? null;
  const leaves = useMemo(
    () => (document ? leavesOf(document) : []),
    [document],
  );

  const status: SaveStatus = !session
    ? state.busy
      ? "opening"
      : "unavailable"
    : state.conflict
      ? "conflict"
      : state.sourceInvalid
        ? "invalid"
        : state.error
          ? isOfflineError(state.error) || !online
            ? "offline"
            : "failed"
          : state.busy
            ? "saving"
            : dirty
              ? "unsaved"
              : "saved";

  return {
    id,
    store,
    state,
    session,
    document,
    leaves,
    dirty,
    blocked,
    status,
    gone,
    news,
    fieldsStamp,
    tagsStamp,
    recovery,
    recover,
    save,
    flush,
    edit,
    setTitle,
    replaceDocument,
    discard,
    adopt,
    replacing,
    resetKey,
    setGone,
    setNews,
    announce,
  };
}

export type Page = ReturnType<typeof usePage>;
