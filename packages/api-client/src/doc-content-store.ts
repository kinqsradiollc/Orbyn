import {
  parseVersionedDocSource,
  versionedDocSource,
  versionedDocRead,
  versionedDocContentKey,
  replaceVersionedDocLeaf,
  type DocBlock,
  type VersionedDocRead,
  type VersionedDocContent,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";
export type DocContentEditorState = {
  read: VersionedDocRead | null;
  draft: VersionedDocContent | null;
  source: string | null;
  dirty: boolean;
  busy: boolean;
  conflict: boolean;
  error: unknown | null;
  remote: VersionedDocRead | null;
  observationError: unknown | null;
};
const empty = (): DocContentEditorState => ({
  read: null,
  draft: null,
  source: null,
  dirty: false,
  busy: false,
  conflict: false,
  error: null,
  remote: null,
  observationError: null,
});

// Validated documents contain only JSON values. Freeze their nested ownership too,
// so a UI widget cannot mutate an accepted revision through a state reference.
function freezeDocument<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDocument(child);
    Object.freeze(value);
  }
  return value;
}

/** Shared full-format editor owner; stale loads/saves never replace another page or newer typing. */
export class DocContentStore {
  private epoch = 0;
  private edit = 0;
  private request: AbortController | null = null;
  private listeners = new Set<() => void>();
  private value = empty();
  constructor(
    private client: Pick<OrbynClient, "getDocContent" | "updateDocContent">,
  ) {}
  get state(): Readonly<DocContentEditorState> {
    return this.value;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(patch: Partial<DocContentEditorState>) {
    this.value = Object.freeze({
      ...this.value,
      ...patch,
      ...(patch.read ? { read: freezeDocument(patch.read) } : {}),
      ...(patch.draft ? { draft: freezeDocument(patch.draft) } : {}),
      ...(patch.remote ? { remote: freezeDocument(patch.remote) } : {}),
    });
    for (const listener of this.listeners) listener();
  }
  /** Dispose or switch owners; an observation failure never authorizes a write. */
  close() {
    ++this.epoch;
    this.request?.abort();
    this.request = null;
    this.value = empty();
    for (const listener of this.listeners) listener();
  }
  async open(id: string) {
    id = versionedDocRead.shape.id.parse(id).toLowerCase();
    this.close();
    const epoch = this.epoch,
      request = (this.request = new AbortController());
    this.publish({ busy: true });
    try {
      const read = versionedDocRead.parse(
        await this.client.getDocContent(id, { signal: request.signal }),
      );
      if (epoch !== this.epoch) return;
      if (read.id.toLowerCase() !== id)
        throw new Error("Unexpected document identity.");
      let source: string | null = null,
        error: unknown = null;
      try {
        source = versionedDocSource(read.document, { projected: true });
      } catch (cause) {
        error = cause;
      }
      // Source refusal keeps the complete visual document, never an empty fallback.
      this.publish({ read, draft: read.document, source, error, busy: false });
    } catch (error) {
      if (epoch === this.epoch) this.publish({ busy: false, error });
    }
  }
  /** Keep invalid typed source visible while retaining the last accepted typed ownership. */
  changeSource(source: string) {
    if (!this.value.draft || this.value.conflict) return;
    ++this.edit;
    try {
      const draft = parseVersionedDocSource(source, this.value.draft.format, {
        projected: true,
      });
      this.publish({ source, draft, dirty: true, error: null });
    } catch (error) {
      this.publish({ source, dirty: true, error });
    }
  }
  /** Replace one visual leaf without flattening its surrounding quote or list. */
  changeLeaf(id: string, block: DocBlock) {
    if (!this.value.draft || this.value.conflict) return;
    // Invalid source must be recovered explicitly before switching to visual edits.
    if (this.value.source !== null && this.value.error) return;
    try {
      const draft = replaceVersionedDocLeaf(this.value.draft, id, block, {
        projected: true,
      });
      ++this.edit;
      let source: string | null = null;
      try {
        source = versionedDocSource(draft, { projected: true });
      } catch {
        // Visual ownership is valid even when Markdown cannot represent it exactly.
      }
      this.publish({ draft, source, dirty: true, error: null });
    } catch (error) {
      this.publish({ error });
    }
  }
  /** Observe remote revisions; never discard local source or typing during the read. */
  async refresh() {
    const state = this.value;
    if (!state.read || state.busy || state.conflict) return;
    const epoch = this.epoch;
    this.publish({ busy: true, observationError: null });
    try {
      const read = versionedDocRead.parse(
        await this.client.getDocContent(state.read.id, {
          signal: this.request?.signal,
        }),
      );
      if (epoch !== this.epoch) return;
      if (
        read.id.toLowerCase() !== state.read.id.toLowerCase() ||
        read.version < state.read.version
      )
        throw new Error("Unexpected observed document revision.");
      const same =
        versionedDocContentKey(read.document, { projected: true }) ===
        versionedDocContentKey(state.read.document, { projected: true });
      if (read.version === state.read.version && !same)
        throw new Error("Document content changed without a new revision.");
      if (this.value.dirty) {
        if (same) this.publish({ read, busy: false });
        else this.publish({ remote: read, conflict: true, busy: false });
        return;
      }
      let source: string | null = null,
        error: unknown = null;
      try {
        source = versionedDocSource(read.document, { projected: true });
      } catch (cause) {
        error = cause;
      }
      this.publish({ read, draft: read.document, source, error, busy: false });
    } catch (observationError) {
      if (epoch === this.epoch) this.publish({ busy: false, observationError });
    }
  }
  /** Commit exactly one optimistic revision; later typing remains queued against the returned revision. */
  async save() {
    const state = this.value;
    if (
      !state.read ||
      !state.draft ||
      !state.dirty ||
      state.busy ||
      state.error ||
      state.conflict
    )
      return;
    const epoch = this.epoch,
      edit = this.edit;
    this.publish({ busy: true });
    try {
      const read = versionedDocRead.parse(
        await this.client.updateDocContent(
          state.read.id,
          state.read.version,
          state.draft,
          { signal: this.request?.signal },
        ),
      );
      if (epoch !== this.epoch) return;
      if (
        read.id.toLowerCase() !== state.read.id.toLowerCase() ||
        read.version !== state.read.version + 1
      )
        throw new Error("Unexpected saved document revision.");
      if (edit !== this.edit) {
        this.publish({ read, busy: false });
        return;
      }
      const same =
        versionedDocContentKey(read.document, { projected: true }) ===
        versionedDocContentKey(state.draft, { projected: true });
      let source = same ? state.source : null;
      let error: unknown = null;
      if (!same) {
        try {
          source = versionedDocSource(read.document, { projected: true });
        } catch (cause) {
          error = cause;
        }
      }
      this.publish({
        read,
        draft: read.document,
        source,
        dirty: false,
        busy: false,
        error,
      });
    } catch (error) {
      if (epoch !== this.epoch) return;
      const conflict =
        !!error &&
        typeof error === "object" &&
        "statusCode" in error &&
        error.statusCode === 409;
      this.publish({ busy: false, conflict, error });
    }
  }
}
