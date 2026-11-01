import { DocEditorStore, type DocNews } from "@orbyn/api-client";
import {
  docEditorSessionDirty,
  isOfflineError,
  mergeVersionedDocContent,
  parseVersionedDocContent,
  versionedDocContentKey,
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
import {
  client,
  getToken,
  getSessionVersion,
  onToken,
} from "../../../lib/session";
import { loadLibrary, patchDocs } from "../store";
import { watchPage } from "../streams";
import { leavesOf } from "./tree";
import {
  createBackupOwner,
  putBackup,
  clearOwnedBackups,
  retryBackupCleanup,
  readRecoveryCopies,
  retireRecoveryCopy,
  legacyBackupKey,
  type Backup,
  type BackupOwner,
  type RecoveryCopy,
} from "./backup";
import { readDraftCopy } from "./draft-copy";
import {
  readSourceDrafts,
  removeSourceDraft,
  writeSourceDraft,
  type LatexSourceDraft,
  type LatexSourceSelector,
} from "./source-draft";

const SAVE_AFTER_MS = 900;
const RETRY_MS = 12_000;

type RecoveryOwner = {
  writer: BackupOwner;
  offers: RecoveryCopy[];
  selected: string | null;
  loaded: boolean;
  request: number;
  readError: string;
  actionError: { key: string; message: string } | null;
};
type RecoveryView = {
  owner: RecoveryOwner;
  offers: RecoveryCopy[];
  selected: string | null;
  error: string;
};

const sameDocument = (a: VersionedDocContent, b: VersionedDocContent) =>
  versionedDocContentKey(a, { projected: true }) ===
  versionedDocContentKey(b, { projected: true });

/** Capture the store synchronously; React's debounced backup may be behind. */
function unsentBackup(state: DocEditorStore["state"]): Backup | null {
  const session = state.session;
  if (!session || (!docEditorSessionDirty(session) && !state.sourceInvalid))
    return null;
  return {
    version: session.saved.version,
    baseTitle: session.saved.title,
    title: session.title,
    base: session.saved.document,
    document: session.document,
    at: new Date().toISOString(),
    ...(state.sourceInvalid && state.source !== null
      ? { source: state.source }
      : {}),
  };
}
function savedBackup(state: DocEditorStore["state"], backup: Backup | null) {
  const session = state.session;
  return (
    !!session &&
    !!backup &&
    backup.source === undefined &&
    !state.sourceInvalid &&
    !docEditorSessionDirty(session) &&
    session.title === session.saved.title &&
    backup.title === session.saved.title &&
    sameDocument(session.document, session.saved.document) &&
    sameDocument(backup.document, session.saved.document)
  );
}

type SourceDraftOwner = {
  loaded: boolean;
  items: LatexSourceDraft[];
  active: {
    draft: LatexSourceDraft;
    origin?: LatexSourceDraft;
    applied: VersionedDocContent | null;
    persisted: LatexSourceDraft | null;
  } | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  memory: Map<
    string,
    { draft: LatexSourceDraft; persisted: LatexSourceDraft | null }
  >;
  writeError: string;
  actionError: { id: string; message: string } | null;
  readError: string;
};
type SourceDraftView = {
  owner: SourceDraftOwner;
  items: LatexSourceDraft[];
  active: LatexSourceDraft | null;
  pending: boolean;
  error: string;
};

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
  const token = getToken();
  const version = getSessionVersion();
  const activeIdentity = useRef({ id, userId, token, version });
  activeIdentity.current = { id, userId, token, version };
  const owns = useCallback(
    () =>
      !!token &&
      getToken() === token &&
      getSessionVersion() === version &&
      activeIdentity.current.id === id &&
      activeIdentity.current.userId === userId &&
      activeIdentity.current.token === token &&
      activeIdentity.current.version === version,
    [token, version, id, userId],
  );
  // The shared client reads the current token at dispatch. Guard both editor
  // operations so a conflict retry cannot dispatch under a different account.
  const store = useMemo(() => {
    const check = () => {
      if (
        !token ||
        getToken() !== token ||
        getSessionVersion() !== version ||
        activeIdentity.current.id !== id ||
        activeIdentity.current.userId !== userId
      )
        throw new Error("This page belongs to a previous editor session.");
    };
    return new DocEditorStore({
      getDocForEditor: (...args) => {
        check();
        return client.getDocForEditor(...args);
      },
      updateDocForEditor: (...args) => {
        check();
        return client.updateDocForEditor(...args);
      },
    });
  }, [id, userId, token, version]);
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.state,
  );
  const [gone, setGone] = useState<"trashed" | "forgotten" | null>(null);
  const [fieldsStamp, setFieldsStamp] = useState(0);
  const [tagsStamp, setTagsStamp] = useState(0);
  const recoveryOwner = useMemo<RecoveryOwner>(
    () => ({
      writer: createBackupOwner(userId, id),
      offers: [],
      selected: null,
      loaded: false,
      request: 0,
      readError: "",
      actionError: null,
    }),
    [store, userId, id],
  );
  const terminal = useMemo(
    () => ({
      kind: null as "trashed" | "forgotten" | null,
      draft: null as Backup | null,
    }),
    [recoveryOwner],
  );
  const [recoveryView, setRecoveryView] = useState<RecoveryView | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [news, setNews] = useState("");
  const latestBackup = useMemo(
    () => ({ current: null as Backup | null }),
    [recoveryOwner],
  );
  const leaving = useRef(false);
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;

  const publishRecovery = useCallback(() => {
    if (!owns() || leaving.current) return;
    const selected = recoveryOwner.offers.some(
      (offer) => offer.key === recoveryOwner.selected,
    )
      ? recoveryOwner.selected
      : (recoveryOwner.offers[0]?.key ?? null);
    recoveryOwner.selected = selected;
    setRecoveryView({
      owner: recoveryOwner,
      offers: [...recoveryOwner.offers],
      selected,
      error: [
        ...new Set(
          [
            recoveryOwner.writer.writeError,
            recoveryOwner.writer.cleanupError,
            recoveryOwner.readError,
            recoveryOwner.actionError?.message,
          ].filter(Boolean),
        ),
      ].join(" "),
    });
  }, [recoveryOwner, owns]);
  const writeBackup = useCallback(
    (backup: Backup | null) => {
      const result = backup
        ? putBackup(recoveryOwner.writer, backup)
        : clearOwnedBackups(recoveryOwner.writer);
      publishRecovery();
      return result.ok;
    },
    [recoveryOwner, publishRecovery],
  );
  const retryLocalDraft = useCallback(() => {
    if (
      !owns() ||
      leaving.current ||
      terminal.kind !== "trashed" ||
      !terminal.draft
    )
      return false;
    return writeBackup(terminal.draft);
  }, [owns, terminal, writeBackup]);
  const localDraft =
    owns() && terminal.kind === "trashed" ? terminal.draft : null;
  // An older-copy cleanup warning doesn't make the new durable snapshot unsafe
  // to leave. It remains in recoveryError without blocking an embedded Brief.
  const localDraftError = localDraft ? recoveryOwner.writer.writeError : "";

  const readRecoveries = useCallback(async () => {
    if (
      !owns() ||
      leaving.current ||
      terminal.kind ||
      !userId ||
      !store.state.session
    )
      return;
    const request = ++recoveryOwner.request;
    const current = () =>
      owns() &&
      !leaving.current &&
      !terminal.kind &&
      request === recoveryOwner.request;
    const found = await readRecoveryCopies(recoveryOwner.writer, current);
    if (!current() || found.cancelled) return;
    const offers = new Map(
      (found.error ? recoveryOwner.offers : []).map((offer) => [
        offer.key,
        offer,
      ]),
    );
    for (const offer of found.copies) offers.set(offer.key, offer);
    recoveryOwner.offers = [...offers.values()].sort((a, b) =>
      b.backup.at.localeCompare(a.backup.at),
    );
    recoveryOwner.loaded = true;
    recoveryOwner.readError = found.error;
    publishRecovery();
  }, [owns, userId, store, recoveryOwner, publishRecovery, terminal]);
  const openDraftCopy = useCallback(
    (raw: string) => {
      if (
        !owns() ||
        leaving.current ||
        terminal.kind ||
        !userId ||
        !store.state.session ||
        !canWriteRef.current
      )
        return "Open an editable page before reviewing a draft copy.";
      try {
        const backup = readDraftCopy(raw, userId, id);
        // The imported file remains external and untouched. Its browser copy
        // has a separate writer, so this editor's cleanup cannot remove it.
        const imported = createBackupOwner(userId, id);
        const saved = putBackup(imported, backup);
        if (!saved.ok) return saved.error;
        const key = imported.latestKey;
        if (!key) return "The draft copy couldn't be kept on this device.";
        recoveryOwner.request++;
        recoveryOwner.offers.push({
          key,
          storageKey: key,
          raw: JSON.stringify(backup),
          backup,
          legacy: false,
        });
        recoveryOwner.selected = key;
        recoveryOwner.actionError = null;
        publishRecovery();
        void readRecoveries();
        return "";
      } catch (failure) {
        return messageOf(failure, "Couldn't read this draft copy.");
      }
    },
    [
      owns,
      terminal,
      userId,
      id,
      store,
      recoveryOwner,
      publishRecovery,
      readRecoveries,
    ],
  );
  const retryRecovery = useCallback(async () => {
    if (!owns() || leaving.current) return;
    if (latestBackup.current) writeBackup(latestBackup.current);
    else {
      retryBackupCleanup(recoveryOwner.writer);
      publishRecovery();
    }
    await readRecoveries();
  }, [owns, writeBackup, recoveryOwner, publishRecovery, readRecoveries]);
  const chooseRecovery = useCallback(
    (key: string) => {
      if (
        !owns() ||
        leaving.current ||
        !recoveryOwner.offers.some((offer) => offer.key === key)
      )
        return;
      recoveryOwner.selected = key;
      publishRecovery();
    },
    [owns, recoveryOwner, publishRecovery],
  );
  const recoveryKey =
    recoveryView?.owner === recoveryOwner ? recoveryView.selected : null;
  const recoveryCopies =
    recoveryView?.owner === recoveryOwner ? recoveryView.offers : [];
  const recovery =
    recoveryCopies.find((offer) => offer.key === recoveryKey)?.backup ?? null;
  const recoveryOptions = recoveryCopies.map((offer) => ({
    key: offer.key,
    title: offer.backup.title,
    at: offer.backup.at,
    legacy: offer.legacy,
  }));
  const recoveryError =
    recoveryView?.owner === recoveryOwner ? recoveryView.error : "";

  useEffect(() => {
    leaving.current = false;
    void store.open(id);
  }, [store, id]);

  const session = state.session;
  const dirty =
    !!session && (docEditorSessionDirty(session) || state.sourceInvalid);
  const blocked =
    !canWrite || state.conflict || state.sourceInvalid || !!state.error;

  useEffect(() => {
    if (session && !recoveryOwner.loaded) void readRecoveries();
  }, [session, recoveryOwner, readRecoveries]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = (event: StorageEvent) => {
      const legacy = legacyBackupKey(userId, id);
      if (
        !owns() ||
        !event.key ||
        (event.key !== legacy && !event.key.startsWith(`${legacy}:`))
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => void readRecoveries(), 120);
    };
    window.addEventListener("storage", changed);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", changed);
    };
  }, [userId, id, owns, readRecoveries]);

  // Keep a copy of anything unsent; clear it the moment the server has it.
  useEffect(() => {
    if (!session || terminal.kind) return;
    if (!dirty) {
      // Only this visit's copy goes. One from an earlier visit waits to be offered.
      if (savedBackup(store.state, latestBackup.current)) {
        latestBackup.current = null;
        writeBackup(null);
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
      ...(state.sourceInvalid && state.source !== null
        ? { source: state.source }
        : {}),
    };
    const timer = window.setTimeout(
      () => writeBackup(latestBackup.current),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [
    session,
    dirty,
    writeBackup,
    state.sourceInvalid,
    state.source,
    store,
    terminal,
  ]);

  // Rejected LaTeX never enters DocEditorStore's Markdown-source backup.
  // This sidecar shares the page's authenticated owner and finalization points.
  const sourceOwner = useMemo<SourceDraftOwner>(
    () => ({
      loaded: false,
      items: [],
      active: null,
      timer: undefined,
      memory: new Map(),
      writeError: "",
      actionError: null,
      readError: "",
    }),
    [store, userId, id],
  );
  const [sourceView, setSourceView] = useState<SourceDraftView | null>(null);
  const publishSource = useCallback(() => {
    if (!owns() || leaving.current) return;
    setSourceView({
      owner: sourceOwner,
      items: [...sourceOwner.items],
      active: sourceOwner.active?.draft ?? null,
      pending: !!sourceOwner.active && !sourceOwner.active.applied,
      error: [
        ...new Set(
          [
            sourceOwner.writeError,
            sourceOwner.actionError?.message,
            sourceOwner.readError,
            [...sourceOwner.memory.values()].some(
              (copy) => copy.persisted !== copy.draft,
            )
              ? "Some source recovery changes are only in this view. Save source copies before leaving."
              : "",
          ].filter(Boolean),
        ),
      ].join(" "),
    });
  }, [sourceOwner, owns]);
  // Finalization deliberately uses the captured old user's key, even after a
  // token event. It never sends a request or reads the incoming account's data.
  const preserveSource = useCallback(() => {
    clearTimeout(sourceOwner.timer);
    sourceOwner.timer = undefined;
    const active = sourceOwner.active;
    let error = "";
    // Older accepted buffers can still have newer raw text than their stored
    // snapshot. Preserve those too; a retry must not downgrade them to disk.
    for (const copy of [
      ...(active ? [active] : []),
      ...sourceOwner.memory.values(),
    ]) {
      if (copy !== active && copy.persisted === copy.draft) continue;
      const result = writeSourceDraft(copy.draft);
      if (result.ok) copy.persisted = copy.draft;
      else error = result.error;
    }
    sourceOwner.writeError = error;
    publishSource();
  }, [sourceOwner, publishSource]);
  const readSourceCopies = useCallback(() => {
    if (!owns() || leaving.current || !store.state.session || !userId) return;
    const found = readSourceDrafts(userId, id);
    if (!owns() || leaving.current) return;
    sourceOwner.loaded = true;
    const copies = new Map(
      (found.error ? sourceOwner.items : []).map((draft) => [draft.id, draft]),
    );
    for (const draft of found.drafts) copies.set(draft.id, draft);
    for (const copy of sourceOwner.memory.values())
      copies.set(copy.draft.id, copy.draft);
    if (sourceOwner.active) copies.delete(sourceOwner.active.draft.id);
    sourceOwner.items = [...copies.values()].sort((a, b) =>
      b.at.localeCompare(a.at),
    );
    // A partial read is not an empty result and never clears the prior warning.
    sourceOwner.readError = found.error;
    publishSource();
  }, [owns, store, userId, id, sourceOwner, publishSource]);
  useEffect(() => {
    if (session && !sourceOwner.loaded) readSourceCopies();
  }, [session, sourceOwner, readSourceCopies]);
  const retrySource = useCallback(() => {
    if (!owns() || leaving.current || !store.state.session) return;
    preserveSource();
    if (!owns() || leaving.current) return;
    readSourceCopies();
  }, [owns, store, preserveSource, readSourceCopies]);

  const rememberSource = useCallback(
    (raw: string, selector: LatexSourceSelector) => {
      if (!owns() || leaving.current || !userId) return null;
      const current = store.state.session;
      if (!current) return null;
      let active = sourceOwner.active;
      if (!active || active.applied) {
        // An older accepted copy may still await a durable handoff. Keep it as
        // recovery data instead of overwriting it with a new source selection.
        const previous = active;
        if (previous) {
          sourceOwner.memory.set(previous.draft.id, {
            draft: previous.draft,
            persisted: previous.persisted,
          });
          sourceOwner.items = [
            previous.draft,
            ...sourceOwner.items.filter(
              (draft) => draft.id !== previous.draft.id,
            ),
          ];
        }
        active = {
          draft: {
            schema: 1,
            id: crypto.randomUUID(),
            userId,
            docId: id,
            selector,
            base: parseVersionedDocContent(current.document, {
              projected: true,
            }),
            version: current.saved.version,
            raw,
            at: new Date().toISOString(),
          },
          applied: null,
          persisted: null,
        };
      } else
        active = {
          ...active,
          draft: { ...active.draft, raw, at: new Date().toISOString() },
        };
      sourceOwner.active = active;
      clearTimeout(sourceOwner.timer);
      sourceOwner.timer = setTimeout(() => {
        if (owns() && !leaving.current) preserveSource();
      }, 250);
      publishSource();
      return active.draft;
    },
    [owns, userId, id, store, sourceOwner, preserveSource, publishSource],
  );

  const recoverSource = useCallback(
    (draftId: string) => {
      if (
        !owns() ||
        leaving.current ||
        (sourceOwner.active && !sourceOwner.active.applied)
      )
        return null;
      const draft = sourceOwner.items.find((item) => item.id === draftId);
      if (!draft || !store.state.session) return null;
      const previous = sourceOwner.active;
      if (previous) {
        sourceOwner.memory.set(previous.draft.id, {
          draft: previous.draft,
          persisted: previous.persisted,
        });
        sourceOwner.items = [
          previous.draft,
          ...sourceOwner.items.filter((item) => item.id !== previous.draft.id),
        ];
      }
      // A visit edits its own record. The old record remains until handoff or
      // explicit discard, so another tab's recovery can never be overwritten.
      const restored = {
        ...draft,
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
      };
      sourceOwner.active = {
        draft: restored,
        origin: draft,
        applied: null,
        persisted: null,
      };
      preserveSource();
      return restored;
    },
    [owns, sourceOwner, store, preserveSource],
  );

  const discardSource = useCallback(
    (draftId?: string) => {
      if (!owns() || leaving.current)
        return "This source belongs to a previous sign-in.";
      const active = sourceOwner.active;
      const chosen = draftId
        ? (sourceOwner.items.find((draft) => draft.id === draftId) ??
          (active?.draft.id === draftId ? active.draft : null))
        : active?.draft;
      if (!chosen) return "";
      const records =
        active?.draft.id === chosen.id && active.origin
          ? [chosen, active.origin]
          : [chosen];
      for (const draft of records) {
        const result = removeSourceDraft(
          active?.draft.id === draft.id
            ? (active.persisted ?? draft)
            : (sourceOwner.memory.get(draft.id)?.persisted ?? draft),
        );
        if (!result.ok) {
          sourceOwner.actionError = { id: chosen.id, message: result.error };
          publishSource();
          return result.error;
        }
      }
      const ids = new Set(records.map((draft) => draft.id));
      if (active && ids.has(active.draft.id)) {
        clearTimeout(sourceOwner.timer);
        sourceOwner.timer = undefined;
        sourceOwner.active = null;
      }
      sourceOwner.items = sourceOwner.items.filter(
        (draft) => !ids.has(draft.id),
      );
      for (const removed of ids) sourceOwner.memory.delete(removed);
      if (sourceOwner.actionError && ids.has(sourceOwner.actionError.id))
        sourceOwner.actionError = null;
      if (!sourceOwner.active && !sourceOwner.memory.size)
        sourceOwner.writeError = "";
      publishSource();
      return "";
    },
    [owns, sourceOwner, publishSource],
  );

  const acceptSource = useCallback(() => {
    if (!owns() || leaving.current || !sourceOwner.active) return;
    if (recovery) {
      sourceOwner.actionError = {
        id: sourceOwner.active.draft.id,
        message:
          "Restore or discard the page draft before applying this source.",
      };
      publishSource();
      return;
    }
    const current = store.state.session;
    if (!current) return;
    sourceOwner.active.applied = parseVersionedDocContent(current.document, {
      projected: true,
    });
    const backup: Backup = {
      version: current.saved.version,
      baseTitle: current.saved.title,
      title: current.title,
      base: current.saved.document,
      document: current.document,
      at: new Date().toISOString(),
    };
    // Accepted is not yet saved. Remove raw recovery only after an ordinary
    // backup was written synchronously, or a matching server receipt arrives.
    if (!docEditorSessionDirty(current) || writeBackup(backup)) {
      if (docEditorSessionDirty(current)) latestBackup.current = backup;
      discardSource();
    } else {
      preserveSource();
      sourceOwner.actionError = {
        id: sourceOwner.active.draft.id,
        message:
          "The page draft couldn't be backed up. Keep this view open until it saves, or save a source copy.",
      };
      publishSource();
    }
  }, [
    owns,
    sourceOwner,
    store,
    writeBackup,
    discardSource,
    preserveSource,
    publishSource,
    recovery,
  ]);
  useEffect(() => {
    const applied = sourceOwner.active?.applied;
    if (
      owns() &&
      applied &&
      session &&
      !dirty &&
      sameDocument(applied, session.saved.document)
    )
      discardSource();
  }, [sourceOwner, session, dirty, owns, discardSource]);
  const sourceDrafts = {
    items: sourceView?.owner === sourceOwner ? sourceView.items : [],
    active: sourceView?.owner === sourceOwner ? sourceView.active : null,
    pending: sourceView?.owner === sourceOwner ? sourceView.pending : false,
    error: sourceView?.owner === sourceOwner ? sourceView.error : "",
    remember: rememberSource,
    recover: recoverSource,
    discard: discardSource,
    accepted: acceptSource,
    retry: retrySource,
  };

  useEffect(() => {
    const hide = () => {
      preserveSource();
      if (latestBackup.current) writeBackup(latestBackup.current);
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (
        (sourceOwner.active && !sourceOwner.active.applied) ||
        (store.state.session &&
          (docEditorSessionDirty(store.state.session) ||
            store.state.sourceInvalid))
      ) {
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
  }, [writeBackup, store, sourceOwner, preserveSource]);

  const announce = useCallback(() => {
    if (!owns()) return;
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
  }, [store, owns]);

  const save = useCallback(
    async (retry = false) => {
      if (!owns() || terminal.kind || !canWriteRef.current) return;
      const before = store.state.doc?.version;
      if (retry) await store.retrySave();
      else await store.save();
      if (
        !terminal.kind &&
        owns() &&
        store.state.doc &&
        store.state.doc.version !== before
      )
        announce();
    },
    [store, announce, owns, terminal],
  );

  /** Keep saving until nothing is unsent or something needs a person. */
  const flush = useCallback(async () => {
    for (let turn = 0; turn < 6; turn++) {
      if (!owns() || terminal.kind) return false;
      const current = store.state;
      if (!current.session) return false;
      if (!docEditorSessionDirty(current.session) && !current.sourceInvalid)
        return true;
      if (current.conflict || current.sourceInvalid) return false;
      if (current.busy) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }
      await save(!!current.error);
      if (store.state.error) return false;
    }
    return (
      !terminal.kind &&
      !!store.state.session &&
      !store.state.sourceInvalid &&
      !docEditorSessionDirty(store.state.session)
    );
  }, [store, save, owns, terminal]);

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
    if (terminal.kind) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = () => {};
    const sync = (version: number) => {
      if (!owns() || terminal.kind) return;
      const current = store.state.session;
      if (!current || (version && version <= current.saved.version)) return;
      if (store.state.busy) {
        clearTimeout(timer);
        timer = setTimeout(() => sync(version), 350);
        return;
      }
      clearTimeout(timer);
      const edited = docEditorSessionDirty(current);
      void store.refresh().then(() => {
        if (!owns() || terminal.kind) return;
        announce();
        if (!store.state.conflict && !store.state.error)
          setNews(
            edited
              ? "Merged someone else's changes."
              : "Updated with someone else's changes.",
          );
      });
    };
    stop = watchPage(id, (version: number, event: DocNews) => {
      if (!owns() || terminal.kind) return;
      if (event.trashed || event.forgotten) {
        terminal.kind = event.forgotten ? "forgotten" : "trashed";
        clearTimeout(timer);
        stop();
        if (event.forgotten) {
          // Explicit forgetting keeps its existing clear/no-recovery semantics.
          latestBackup.current = null;
          writeBackup(null);
        } else {
          terminal.draft = unsentBackup(store.state);
          if (terminal.draft) {
            latestBackup.current = terminal.draft;
            writeBackup(terminal.draft);
          }
          preserveSource();
        }
        store.close();
        setGone(terminal.kind);
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
    if (terminal.kind) stop();
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [id, store, writeBackup, announce, owns, terminal, preserveSource]);

  useEffect(() => {
    if (!news) return;
    const timer = setTimeout(() => setNews(""), 6000);
    return () => clearTimeout(timer);
  }, [news]);

  // Token events arrive before React unmounts the old shell. Preserve the
  // opening user's draft, then invalidate pending receipts synchronously.
  useEffect(
    () =>
      onToken(() => {
        if (owns()) return;
        preserveSource();
        const current = store.state.session;
        if (
          current &&
          (docEditorSessionDirty(current) || store.state.sourceInvalid)
        ) {
          latestBackup.current = {
            version: current.saved.version,
            baseTitle: current.saved.title,
            title: current.title,
            base: current.saved.document,
            document: current.document,
            at: new Date().toISOString(),
            ...(store.state.sourceInvalid && store.state.source !== null
              ? { source: store.state.source }
              : {}),
          };
          writeBackup(latestBackup.current);
        }
        store.close();
      }),
    [store, writeBackup, owns, preserveSource],
  );

  // Leaving sends what is left; a failure keeps the local copy for next time.
  useEffect(
    () => () => {
      preserveSource();
      leaving.current = true;
      const actual = terminal.kind ? null : unsentBackup(store.state);
      if (actual) latestBackup.current = actual;
      const unsent = !!latestBackup.current;
      if (unsent) writeBackup(latestBackup.current);
      void flush().finally(() => {
        if (
          owns() &&
          !terminal.kind &&
          unsent &&
          savedBackup(store.state, latestBackup.current)
        )
          writeBackup(null);
        store.close();
        if (owns() && unsent) void loadLibrary();
      });
    },
    [store, writeBackup, flush, owns, preserveSource, terminal],
  );

  /** A failed save mustn't refuse the next keystroke, so clear it before editing. */
  const ready = useCallback(() => {
    if (!owns() || terminal.kind || !canWriteRef.current) return false;
    const current = store.state;
    if (current.conflict || current.sourceInvalid) return false;
    if (current.error) {
      if (isOfflineError(current.error)) store.acknowledgeOfflineSave();
      else void store.retrySave();
    }
    return !store.state.error;
  }, [store, owns, terminal]);

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

  /** Apply validated whole-tree changes without a lossy Markdown round trip. */
  const replaceDocument = useCallback(
    (document: VersionedDocContent) => {
      const current = store.state.session;
      if (!current || !ready()) return false;
      return store.changeDocument(current.document, document);
    },
    [store, ready],
  );

  const recover = useCallback(
    (use: boolean, expectedKey?: string | null) => {
      if (!owns() || leaving.current)
        return "This page belongs to a previous sign-in.";
      const selected = expectedKey ?? recoveryOwner.selected;
      if (!selected || selected !== recoveryOwner.selected)
        return "Choose this recovery copy again before continuing.";
      const offer = recoveryOwner.offers.find((copy) => copy.key === selected);
      if (!offer)
        return "This recovery copy is no longer available. Try again.";
      const fail = (message: string) => {
        recoveryOwner.actionError = { key: selected, message };
        publishRecovery();
        return message;
      };
      const retire = () => {
        const result = retireRecoveryCopy(recoveryOwner.writer, offer);
        if (!result.ok) return fail(result.error);
        recoveryOwner.offers = recoveryOwner.offers.filter(
          (copy) => copy.key !== offer.key,
        );
        if (recoveryOwner.actionError?.key === offer.key)
          recoveryOwner.actionError = null;
        publishRecovery();
        void readRecoveries();
        return "";
      };
      if (!use) return retire();
      const backup = offer.backup;
      const current = store.state.session;
      if (!current || !canWriteRef.current || store.state.conflict)
        return fail(
          "Open an editable version of this page before restoring the draft.",
        );
      if (store.state.sourceInvalid)
        return fail(
          "Resolve the open source draft before restoring this copy.",
        );
      if (
        backup.title !== backup.baseTitle &&
        current.title !== backup.baseTitle &&
        current.title !== backup.title
      )
        return fail(
          "The page title changed elsewhere. Save a draft copy before choosing which title to keep.",
        );
      try {
        if (backup.source !== undefined) {
          if (!sameDocument(backup.base, current.document))
            return fail(
              "The page changed elsewhere. Save a draft copy and compare it with the current source; the invalid draft cannot be merged safely.",
            );
          if (backup.title !== backup.baseTitle) setTitle(backup.title);
          store.changeSource(current.document, backup.source);
        } else {
          const merged = mergeVersionedDocContent(
            backup.base,
            backup.document,
            current.document,
          );
          if (!replaceDocument(merged))
            return fail("Resolve the open draft before restoring this copy.");
          if (backup.title !== backup.baseTitle) setTitle(backup.title);
        }
        if (!owns() || leaving.current)
          return "This page belongs to a previous sign-in.";
        const adopted = store.state.session;
        if (!adopted)
          return fail(
            "The page closed before its draft could be kept. The original recovery copy is still available.",
          );
        const retained: Backup = {
          version: adopted.saved.version,
          baseTitle: adopted.saved.title,
          title: adopted.title,
          base: adopted.saved.document,
          document: adopted.document,
          at: new Date().toISOString(),
          ...(store.state.sourceInvalid && store.state.source !== null
            ? { source: store.state.source }
            : {}),
        };
        latestBackup.current = retained;
        const onServer =
          !store.state.sourceInvalid && !docEditorSessionDirty(adopted);
        if (!writeBackup(retained) && !onServer)
          return fail(
            "The draft is in this view, but its recovery copy couldn't be saved. The original is still kept; save a draft copy or try again.",
          );
        return retire();
      } catch (failure) {
        return fail(
          messageOf(failure, "This page changed too much to merge your draft."),
        );
      }
    },
    [
      owns,
      recoveryOwner,
      publishRecovery,
      readRecoveries,
      store,
      setTitle,
      replaceDocument,
      writeBackup,
    ],
  );

  /** The open line's box holds its own words, so a new revision replaces it. */
  const [resetKey, setResetKey] = useState(0);
  const replacing = useRef(false);
  const discard = useCallback(async () => {
    if (!owns() || terminal.kind) return;
    latestBackup.current = null;
    writeBackup(null);
    replacing.current = true;
    await store.discardLocal();
    if (!owns()) return;
    setResetKey((n) => n + 1);
  }, [store, writeBackup, owns, terminal]);
  const adopt = useCallback(
    (doc: Doc) => {
      if (!owns()) return;
      replacing.current = true;
      store.adopt(doc);
      setResetKey((n) => n + 1);
      announce();
    },
    [store, announce, owns],
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
    localDraft,
    localDraftError,
    retryLocalDraft,
    news,
    fieldsStamp,
    tagsStamp,
    recovery,
    recoveryKey,
    recoveryOptions,
    chooseRecovery,
    recoveryError,
    retryRecovery,
    openDraftCopy,
    recover,
    sourceDrafts,
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
