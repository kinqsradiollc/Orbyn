import {
  newBlockId,
  mapDocContainerBlocks,
  type Doc,
  type PagePublication,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";
type Api = Pick<
  OrbynClient,
  | "getDocForEditor"
  | "updateDocForEditor"
  | "getPagePublication"
  | "publishPageSelection"
  | "revokePagePublication"
  | "getPublish"
  | "unpublish"
>;
export type PagePublicationState = {
  doc: Doc | null;
  publication: PagePublication | null;
  busy: boolean;
  error: string;
  selected: string[];
  mode: "snapshot" | "live";
  consent: boolean;
  expiryDays: 0 | 7 | 30;
  legacyPath: string | null;
  folderPath: string | null;
};
export class PagePublicationStore {
  private state: PagePublicationState = {
    doc: null,
    publication: null,
    busy: false,
    error: "",
    selected: [],
    mode: "snapshot",
    consent: false,
    expiryDays: 7,
    legacyPath: null,
    folderPath: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private identity: unknown;
  constructor(
    private api: Api,
    private id: string,
    private session: () => unknown,
    private changed: (doc: Doc) => void,
  ) {
    this.identity = session();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch = (value: Partial<PagePublicationState>) => {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((fn) => fn());
  };
  configure = (
    value: Partial<
      Pick<PagePublicationState, "selected" | "mode" | "expiryDays" | "consent">
    >,
  ) => {
    if (!this.state.busy)
      this.patch({
        ...value,
        ...(value.consent === undefined ? { consent: false } : {}),
      });
  };
  dispose = () => {
    this.generation++;
    this.state = { ...this.state, busy: false };
    this.listeners.clear();
  };
  private clearSession = () =>
    this.patch({
      doc: null,
      publication: null,
      selected: [],
      legacyPath: null,
      folderPath: null,
      consent: false,
      busy: false,
      error: "Reopen sharing after switching accounts.",
    });
  private async run(action: (current: () => void) => Promise<void>) {
    if (this.session() !== this.identity) {
      this.clearSession();
      return;
    }
    if (this.state.busy) return;
    const generation = this.generation;
    const current = () => {
      if (this.generation !== generation || this.session() !== this.identity)
        throw new Error("Page session changed.");
    };
    this.patch({ busy: true, error: "" });
    try {
      await action(current);
    } catch (error) {
      if (generation === this.generation && this.session() === this.identity)
        this.patch({
          error:
            error instanceof Error
              ? error.message
              : "Could not update sharing.",
        });
    } finally {
      if (generation === this.generation) {
        if (this.session() !== this.identity) this.clearSession();
        else this.patch({ busy: false });
      }
    }
  }
  prepare = () =>
    this.run(async (current) => {
      let doc = await this.api.getDocForEditor(this.id);
      current();
      let missing = false;
      const block = (b: Doc["content"][number]) => {
        if (b.id) return b;
        missing = true;
        return { ...b, id: newBlockId() };
      };
      const document =
        doc.document?.format === 2
          ? {
              format: 2 as const,
              nodes: mapDocContainerBlocks(doc.document.nodes, block, {
                projected: true,
              }),
            }
          : { format: 1 as const, blocks: doc.content.map(block) };
      if (missing) {
        doc = await this.api.updateDocForEditor(this.id, {
          version: doc.version,
          title: doc.title,
          document,
        });
        current();
        this.changed(doc);
      }
      const [publication, legacy] = await Promise.all([
        this.api.getPagePublication(this.id),
        this.api.getPublish("doc", this.id),
      ]);
      current();
      this.patch({
        doc,
        publication,
        legacyPath: legacy.published?.path ?? null,
        folderPath: legacy.via_folder?.path ?? null,
        selected:
          publication?.block_ids ??
          doc.content.flatMap((b) => (b.id ? [b.id] : [])),
        mode: publication?.mode ?? "snapshot",
        consent: false,
      });
    });
  save = () =>
    this.run(async (current) => {
      const s = this.state;
      if (!s.doc || !s.consent || !s.selected.length)
        throw new Error("Select content and confirm public sharing.");
      const publication = await this.api.publishPageSelection(this.id, {
        expected_doc_version: s.doc.version,
        expected_revision: s.publication?.revision ?? 0,
        block_ids: s.selected,
        mode: s.mode,
        consent: true,
        expires_at: s.expiryDays
          ? new Date(Date.now() + s.expiryDays * 86400000).toISOString()
          : null,
      });
      current();
      this.patch({ publication, consent: false });
    });
  revoke = () =>
    this.run(async (current) => {
      await this.api.revokePagePublication(this.id);
      current();
      this.patch({ publication: null, consent: false });
    });
  revokeLegacy = () =>
    this.run(async (current) => {
      await this.api.unpublish("doc", this.id);
      current();
      this.patch({ legacyPath: null });
    });
}
