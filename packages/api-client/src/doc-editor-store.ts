import {
  acceptDocEditorSave,
  applyVersionedDocSource,
  docEditorSessionDirty,
  editDocEditorSession,
  isOfflineError,
  openDocEditorSession,
  prepareDocEditorSave,
  reconcileDocEditorSession,
  sourceDocEditorSession,
  titleDocEditorSession,
  type Doc,
  type DocContentOperation,
  type DocEditorSession,
  type VersionedDocContent,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";

export type DocEditorStoreState = Readonly<{
  doc: Doc | null;
  session: DocEditorSession | null;
  source: string | null;
  sourceInvalid: boolean;
  busy: boolean;
  error: unknown | null;
  conflict: boolean;
}>;

/** One complete page draft and one serialized save path for web and mobile. */
export class DocEditorStore {
  private epoch = 0;
  private edit = 0;
  private listeners = new Set<() => void>();
  private value: DocEditorStoreState = {
    doc: null,
    session: null,
    source: null,
    sourceInvalid: false,
    busy: false,
    error: null,
    conflict: false,
  };

  constructor(
    private readonly client: Pick<
      OrbynClient,
      "getDocForEditor" | "updateDocForEditor"
    >,
  ) {}

  get state() {
    return this.value;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<DocEditorStoreState>) {
    this.value = Object.freeze({ ...this.value, ...patch });
    for (const listener of this.listeners) listener();
  }

  close() {
    this.epoch++;
    this.edit++;
    this.publish({
      doc: null,
      session: null,
      source: null,
      sourceInvalid: false,
      busy: false,
      error: null,
      conflict: false,
    });
  }

  /** Accept a complete history restore only after the current draft was settled. */
  adopt(doc: Doc) {
    if (!doc.document)
      throw new Error("Complete restored ownership is missing.");
    if (this.value.session && doc.id !== this.value.session.saved.id)
      throw new Error("The restored page does not match this editor.");
    if (
      this.value.session &&
      (docEditorSessionDirty(this.value.session) || this.value.source !== null)
    )
      throw new Error("Save or discard your draft before restoring a version.");
    this.epoch++;
    this.edit++;
    this.publish({
      doc,
      session: openDocEditorSession({
        id: doc.id,
        version: doc.version,
        title: doc.title,
        document: doc.document,
      }),
      source: null,
      sourceInvalid: false,
      busy: false,
      error: null,
      conflict: false,
    });
  }

  async open(id: string, offlineCopy?: Doc) {
    this.close();
    const epoch = this.epoch;
    this.publish({ busy: true });
    try {
      const doc = await this.client.getDocForEditor(id);
      if (epoch !== this.epoch) return;
      if (!doc.document)
        throw new Error("Complete document ownership is missing.");
      const session = openDocEditorSession({
        id: doc.id,
        version: doc.version,
        title: doc.title,
        document: doc.document,
      });
      this.publish({ doc, session, busy: false, error: null });
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (
        isOfflineError(error) &&
        offlineCopy?.id === id &&
        offlineCopy.document
      ) {
        try {
          const session = openDocEditorSession({
            id: offlineCopy.id,
            version: offlineCopy.version,
            title: offlineCopy.title,
            document: offlineCopy.document,
          });
          this.publish({ doc: offlineCopy, session, busy: false, error: null });
          return;
        } catch {
          // A malformed cached owner is never replaced by flat blocks.
        }
      }
      this.publish({ busy: false, error });
    }
  }

  changeTitle(expected: string, title: string) {
    const session = this.value.session;
    if (!session || this.value.conflict) return;
    try {
      this.publish({
        session: titleDocEditorSession(session, expected, title),
        error: this.value.sourceInvalid ? this.value.error : null,
      });
      this.edit++;
    } catch (error) {
      this.publish({ error });
    }
  }

  changeSource(expected: VersionedDocContent, source: string) {
    const session = this.value.session;
    if (!session || this.value.conflict) return;
    this.edit++;
    try {
      const document = applyVersionedDocSource(
        session.document,
        expected,
        source,
        { projected: true },
      );
      this.publish({
        session: sourceDocEditorSession(session, expected, document),
        source,
        sourceInvalid: false,
        error: null,
      });
    } catch (error) {
      // Keep invalid source in the editor, but never send a guessed tree.
      this.publish({ source, sourceInvalid: true, error });
    }
  }

  changeOperation(
    expected: VersionedDocContent,
    operation: DocContentOperation,
  ) {
    const session = this.value.session;
    if (!session || this.value.conflict || this.value.error) return;
    try {
      this.publish({
        session: editDocEditorSession(session, expected, operation),
        source: null,
        sourceInvalid: false,
        error: null,
      });
      this.edit++;
    } catch (error) {
      this.publish({ error });
    }
  }

  /** Mobile may keep a failed network save in its durable outbox. */
  acknowledgeOfflineSave() {
    if (isOfflineError(this.value.error)) this.publish({ error: null });
  }

  /** Explicit user discard; keep the last saved revision until a fresh read succeeds. */
  async discardLocal() {
    const session = this.value.session;
    if (!session) return;
    this.edit++;
    this.publish({
      session: openDocEditorSession(session.saved),
      source: null,
      sourceInvalid: false,
      error: null,
      conflict: false,
    });
    await this.refresh();
  }

  /** A stale save receipt never replaces typing made while the request was in flight. */
  async save(options: { ticksFrom?: number } = {}) {
    const session = this.value.session;
    if (
      !session ||
      !docEditorSessionDirty(session) ||
      this.value.busy ||
      this.value.conflict ||
      this.value.error ||
      this.value.sourceInvalid
    )
      return;
    const epoch = this.epoch;
    const edit = this.edit;
    const ticket = prepareDocEditorSave(session);
    this.publish({ busy: true });
    try {
      const doc = await this.client.updateDocForEditor(
        ticket.id,
        {
          version: ticket.version,
          title: ticket.title,
          document: ticket.document,
        },
        options,
      );
      if (epoch !== this.epoch) return;
      if (!doc.document)
        throw new Error("Complete saved ownership is missing.");
      const current = this.value.session;
      if (!current) return;
      const next = acceptDocEditorSave(current, ticket, {
        id: doc.id,
        version: doc.version,
        title: doc.title,
        document: doc.document,
      });
      this.publish({
        doc,
        session: next,
        source: edit === this.edit ? null : this.value.source,
        sourceInvalid: edit === this.edit ? false : this.value.sourceInvalid,
        busy: false,
        error: edit === this.edit ? null : this.value.error,
      });
    } catch (error) {
      if (epoch !== this.epoch) return;
      if ((error as { statusCode?: number }).statusCode === 409) {
        await this.refresh();
        return;
      }
      this.publish({ busy: false, error });
    }
  }

  /** Merge a newer full revision; overlapping edits keep the local draft for review. */
  async refresh() {
    const session = this.value.session;
    if (!session) return;
    const epoch = this.epoch;
    this.publish({ busy: true });
    try {
      const doc = await this.client.getDocForEditor(session.saved.id);
      if (epoch !== this.epoch) return;
      if (!doc.document)
        throw new Error("Complete remote ownership is missing.");
      const current = this.value.session;
      if (!current) return;
      // An unparsed source buffer has no safe tree to merge. Keep it visible.
      if (this.value.source !== null && this.value.sourceInvalid) {
        this.publish({
          doc,
          busy: false,
          conflict: doc.version !== current.saved.version,
        });
        return;
      }
      // A typed source buffer describes the old tree. Never silently display it
      // beside a newer, independently merged preview.
      if (
        this.value.source !== null &&
        doc.version !== current.saved.version &&
        docEditorSessionDirty(current)
      ) {
        this.publish({ doc, busy: false, conflict: true });
        return;
      }
      const next = reconcileDocEditorSession(current, {
        id: doc.id,
        version: doc.version,
        title: doc.title,
        document: doc.document,
      });
      this.publish({
        doc,
        session: next,
        source:
          doc.version === current.saved.version ? this.value.source : null,
        sourceInvalid: false,
        busy: false,
        error: null,
        conflict: false,
      });
    } catch (error) {
      if (epoch === this.epoch)
        this.publish({
          busy: false,
          error,
          conflict: !isOfflineError(error),
        });
    }
  }
}
