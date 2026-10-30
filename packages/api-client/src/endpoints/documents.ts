import {
  maintainedPageRunStopResult,
  type ConnectionMap,
  type Doc,
  type DocAiAction,
  type DocAnswer,
  type DocAskSelection,
  docAskSelection,
  type DocBlock,
  type DocComment,
  type DocInfo,
  type DocKind,
  type DocSuggestion,
  type DocSummary,
  type DocTag,
  type DocVersion,
  type DocVersionChanges,
  type DocViewer,
  type EventNoteRef,
  type ExportFormat,
  type FadingDoc,
  type Favourite,
  type FavouriteKind,
  type Folder,
  type HeadingOption,
  type ImportCapabilities,
  type ImportJob,
  type Item,
  type LegalDoc,
  type LegalDocument,
  type LinkCard,
  type LinkedHereList,
  type LinkOption,
  type LinkPill,
  type Look,
  type LookInput,
  type MaintainedPageBinding,
  type MaintainedPageBindingInput,
  type MaintainedPageBindingUpdate,
  type MaintainedPageRunSummary,
  type ObjectRef,
  type OriginalsOverview,
  type PageFile,
  type PageFileInput,
  type PageFileLink,
  type PageFileUpload,
  type PageImportInput,
  type PagesImportSummary,
  type PageTemplate,
  type PageTemplateFromDoc,
  type PageTemplateInput,
  type PageTemplateUpdate,
  type PageTemplateUse,
  type Proposed,
  type PublishState,
  type RelatedPage,
  resolveRefs,
  type TrashedDoc,
  type UnlinkedMention,
  type VersionedDocContent,
  versionedDocRead,
  versionedDocSave,
} from "@orbyn/core";
import { RequestOptions } from "../client-contracts.js";
import type { OrbynClient } from "../client.js";

/**
 * The notes these events have, to mark them (`eventNoteFor` finds an
 * entry's). `from`/`to` keep a repeating event's class notes to the
 * times shown.
 */

export async function callEventNotes(
  this: OrbynClient,
  itemIds: string[],
  range: { from?: string; to?: string } = {},
): Promise<EventNoteRef[]> {
  const ids = [...new Set(itemIds)];
  // The server takes 200 events at a time.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  const found = await Promise.all(
    chunks.map((chunk) =>
      this.request<EventNoteRef[]>(
        `/docs/event-notes?${new URLSearchParams({
          items: chunk.join(","),
          ...(range.from ? { from: range.from } : {}),
          ...(range.to ? { to: range.to } : {}),
        })}`,
      ),
    ),
  );
  return found.flat();
}

/**
 * Turn a page's open checklist lines into tasks: every one that isn't a
 * task yet, or only the lines named in `blockIds` ("Make task").
 */

export function callDocToTasks(
  this: OrbynClient,
  id: string,
  blockIds?: string[],
) {
  return this.request<{
    created: number;
    items: Item[];
    /** The document as it now stands, with the new lines tied to tasks. */
    doc: Doc | null;
  }>(`/docs/${id}/tasks`, {
    method: "POST",
    ...(blockIds?.length ? { body: { block_ids: blockIds } } : {}),
  });
}

// Comments on a document

export function callListDocComments(this: OrbynClient, docId: string) {
  return this.request<DocComment[]>(`/docs/${docId}/comments`);
}

/**
 * `anchor` ties the remark to words in one block; without it, to the page.
 * `parent_id` makes it a reply, and `mentions` are the people named in it.
 */

export function callAddDocComment(
  this: OrbynClient,
  docId: string,
  body: string,
  anchor?: {
    block_id?: string;
    quote?: string;
    range_start?: number;
    range_end?: number;
    parent_id?: string;
    mentions?: string[];
  },
) {
  return this.request<DocComment>(`/docs/${docId}/comments`, {
    method: "POST",
    body: { body, ...anchor },
  });
}

/**
 * Ask the assistant for words in place of a stretch of a page. What comes
 * back is a proposal like any other — nothing changes until it is taken.
 */

export function callAssistDoc(
  this: OrbynClient,
  docId: string,
  body: {
    block_id: string;
    range_start: number;
    range_end: number;
    action: DocAiAction;
    instruction?: string;
    version?: number;
    quote?: string;
  },
) {
  return this.request<DocSuggestion>(`/docs/${docId}/assist`, {
    method: "POST",
    body,
  });
}

/** Ask a question about one page, answered from that page alone. */

export function callAskDoc(
  this: OrbynClient,
  docId: string,
  question: string,
  selection?: DocAskSelection,
) {
  return this.request<DocAnswer>(`/docs/${docId}/ask`, {
    method: "POST",
    body: {
      question,
      ...(selection ? { selection: docAskSelection.parse(selection) } : {}),
    },
  });
}

// Proposed changes to a document

export function callListDocSuggestions(this: OrbynClient, docId: string) {
  return this.request<DocSuggestion[]>(`/docs/${docId}/suggestions`);
}

/** Propose changes. Anyone who can read the document may propose. */

export function callProposeDocChanges(
  this: OrbynClient,
  docId: string,
  changes: Proposed[],
  note = "",
) {
  return this.request<DocSuggestion[]>(`/docs/${docId}/suggestions`, {
    method: "POST",
    body: { changes, note },
  });
}

/** Take a proposal into the page, or leave it. Returns the page if taken. */

export function callDecideDocSuggestion(
  this: OrbynClient,
  docId: string,
  id: string,
  take: boolean,
) {
  return this.request<{ doc: Doc | null }>(`/docs/${docId}/suggestions/${id}`, {
    method: "POST",
    body: { take },
  });
}

export function callWithdrawDocSuggestion(
  this: OrbynClient,
  docId: string,
  id: string,
) {
  return this.request<void>(`/docs/${docId}/suggestions/${id}`, {
    method: "DELETE",
  });
}

/** "Keep the original": the setting, the space used, and the files. */

export function callOriginals(this: OrbynClient) {
  return this.request<OriginalsOverview>("/me/originals");
}

export function callSetKeepOriginals(this: OrbynClient, keep: boolean) {
  return this.request<{ keep: boolean }>("/me/originals", {
    method: "PUT",
    body: { keep },
  });
}

/** A page's kept original, as a file to save. */

export async function callDownloadOriginal(this: OrbynClient, docId: string) {
  const response = await this.raw(`/docs/${docId}/original`);
  const disposition = response.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/.exec(disposition)?.[1];
  return {
    blob: await response.blob(),
    name: star ? decodeURIComponent(star) : (plain ?? "original"),
  };
}

export function callDeleteOriginal(this: OrbynClient, docId: string) {
  return this.request<void>(`/docs/${docId}/original`, { method: "DELETE" });
}

export function callDocPeople(this: OrbynClient, docId: string) {
  return this.request<{ id: string; name: string; email: string }[]>(
    `/docs/${docId}/people`,
  );
}

export function callResolveDocComment(
  this: OrbynClient,
  docId: string,
  commentId: string,
  resolved: boolean,
  expectedRevision?: number,
) {
  return this.request<DocComment>(`/docs/${docId}/comments/${commentId}`, {
    method: "PUT",
    body: {
      resolved,
      ...(expectedRevision === undefined
        ? {}
        : { expected_revision: expectedRevision }),
    },
  });
}

export function callDeleteDocComment(
  this: OrbynClient,
  docId: string,
  commentId: string,
) {
  return this.request<void>(`/docs/${docId}/comments/${commentId}`, {
    method: "DELETE",
  });
}

// Folders and favourites

export function callListFolders(this: OrbynClient) {
  return this.request<Folder[]>("/folders");
}

export function callCreateFolder(
  this: OrbynClient,
  input: { name: string; team_id?: string | null },
) {
  return this.request<Folder>("/folders", { method: "POST", body: input });
}

export function callRenameFolder(
  this: OrbynClient,
  id: string,
  input: { name?: string; position?: number },
) {
  return this.request<Folder>(`/folders/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteFolder(this: OrbynClient, id: string) {
  return this.request<void>(`/folders/${id}`, { method: "DELETE" });
}

export function callListFavourites(this: OrbynClient) {
  return this.request<Favourite[]>("/favourites");
}

export function callSetFavourite(
  this: OrbynClient,
  kind: FavouriteKind,
  targetId: string,
  starred: boolean,
  blockId?: string,
) {
  return this.request<void>("/favourites", {
    method: "PUT",
    body: {
      kind,
      target_id: targetId,
      starred,
      ...(blockId ? { block_id: blockId } : {}),
    },
  });
}

// Covers and icons (W6)
/** A page's cover and icon; null takes one off. Its version stays. */

export function callSetDocLook(
  this: OrbynClient,
  docId: string,
  look: LookInput,
) {
  return this.request<Look>(`/docs/${docId}/look`, {
    method: "PUT",
    body: look,
  });
}

// Archiving and tidying the library (SRCH-03, ORG-03)

export function callArchiveDoc(
  this: OrbynClient,
  id: string,
  archived: boolean,
) {
  return this.request<Doc>(`/docs/${id}/archive`, {
    method: "PUT",
    body: { archived },
  });
}

export function callArchiveFolder(
  this: OrbynClient,
  id: string,
  archived: boolean,
) {
  return this.request<{ id: string; archived_at: string | null }>(
    `/folders/${id}/archive`,
    { method: "PUT", body: { archived } },
  );
}

/** Move, archive or tag several pages at once. */

export function callBulkDocs(
  this: OrbynClient,
  input: {
    ids: string[];
    folder_id?: string | null;
    archived?: boolean;
    tag_id?: string;
  },
) {
  return this.request<{
    done: string[];
    skipped: { id: string; reason: string }[];
  }>("/docs/bulk", { method: "POST", body: input });
}

/** The Connections map around a page or project (CNV-02). */

export function callConnectionMap(
  this: OrbynClient,
  kind: "doc" | "project",
  id: string,
  depth: 1 | 2 = 1,
) {
  const q = new URLSearchParams({ kind, id, depth: String(depth) });
  return this.request<ConnectionMap>(`/links/map?${q}`);
}

/**
 * What the link picker offers for the words typed after [[: pages, tasks,
 * events, projects and people (dates are worked out by the app).
 */

export function callPickLinks(this: OrbynClient, q: string, limit?: number) {
  const params = new URLSearchParams({ q });
  if (limit !== undefined) params.set("limit", String(limit));
  return this.request<LinkOption[]>(`/links/pick?${params}`);
}

/** Link pills as they stand now: live titles, ticks, deadlines, deletions. */

export function callResolveLinks(this: OrbynClient, refs: ObjectRef[]) {
  if (!refs.length) return Promise.resolve([] as LinkPill[]);
  const params = new URLSearchParams({ refs: resolveRefs(refs) });
  return this.request<LinkPill[]>(`/links/resolve?${params}`);
}

/** "Linked here": the places that link to a page, task, project or person. */

export function callLinksHere(
  this: OrbynClient,
  kind: "doc" | "task" | "event" | "project" | "person",
  id: string,
) {
  const params = new URLSearchParams({ kind, id });
  return this.request<LinkedHereList>(`/links/here?${params}`);
}

/** A link's hover card: enough to tick, reschedule or open it (LNK-07). */

export function callLinkCard(
  this: OrbynClient,
  ref: {
    kind: "doc" | "task" | "event" | "project";
    id: string;
    block?: string;
  },
) {
  const params = new URLSearchParams({ kind: ref.kind, id: ref.id });
  if (ref.block) params.set("block", ref.block);
  return this.request<LinkCard>(`/links/card?${params}`);
}

/** Pages that say this page's or project's name without linking to it (LNK-06). */

export function callUnlinkedMentions(
  this: OrbynClient,
  kind: "doc" | "project",
  id: string,
) {
  const params = new URLSearchParams({ kind, id });
  return this.request<UnlinkedMention[]>(`/links/mentions?${params}`);
}

/** Pages that read like this one, not linked either way yet (LNK-06). */

export function callRelatedPages(this: OrbynClient, docId: string) {
  const params = new URLSearchParams({ kind: "doc", id: docId });
  return this.request<RelatedPage[]>(`/links/related?${params}`);
}

/** A page's headings (and, with words, lines) for [[Page# (LNK-04). */

export function callPageHeadings(this: OrbynClient, docId: string, q = "") {
  const params = new URLSearchParams({ doc: docId, q });
  return this.request<HeadingOption[]>(`/links/headings?${params}`);
}

/** Name a heading or line so a link can point at it. */

export function callAnchorLine(
  this: OrbynClient,
  docId: string,
  index: number,
  text: string,
  version?: number,
) {
  return this.request<{ block_id: string }>(`/docs/${docId}/anchor`, {
    method: "POST",
    body: { index, text, ...(version === undefined ? {} : { version }) },
  });
}

/** A heading's section of a page (or the page's first lines), to embed. */

export function callDocSection(
  this: OrbynClient,
  docId: string,
  block?: string | null,
) {
  const params = new URLSearchParams();
  if (block) params.set("block", block);
  return this.request<{
    doc_id: string;
    title: string;
    block_id: string | null;
    missing: boolean;
    more: boolean;
    blocks: DocBlock[];
    /** Authorized source-page definitions, including those outside the section. */
    references?: [string, string, string?][];
  }>(`/docs/${docId}/section${block ? `?${params}` : ""}`);
}

/** "Move to new page": these lines become a page, and a link takes their place. */

export function callExtractToPage(
  this: OrbynClient,
  docId: string,
  input: { block_ids: string[]; title?: string; version: number },
) {
  return this.request<{ doc: Doc; source: Doc }>(`/docs/${docId}/extract`, {
    method: "POST",
    body: input,
  });
}

/** "Merge into…": this page's lines go to the end of another. */

export function callMergeDoc(
  this: OrbynClient,
  docId: string,
  into: string,
  version: number,
) {
  return this.request<{ doc: Doc; relinked: number }>(`/docs/${docId}/merge`, {
    method: "POST",
    body: { into, version },
  });
}

/** The headings you folded on a page, on every device (EDT-14). */

export function callDocFolds(this: OrbynClient, docId: string) {
  return this.request<{ block_ids: string[] }>(`/docs/${docId}/folds`);
}

export function callSetDocFolds(
  this: OrbynClient,
  docId: string,
  blockIds: string[],
) {
  return this.request<{ block_ids: string[] }>(`/docs/${docId}/folds`, {
    method: "PUT",
    body: { block_ids: blockIds },
  });
}

/** A page's other names, such as a course code (LNK-03). */

export function callSetDocAliases(
  this: OrbynClient,
  docId: string,
  aliases: string[],
) {
  return this.request<{ aliases: string[] }>(`/docs/${docId}/aliases`, {
    method: "PUT",
    body: { aliases },
  });
}

// ---- pictures and files in pages (EDT-01) ----
/**
 * Add a picture or file to a page: its row, and where to send the bytes
 * (a path on this API's base URL, good for ten minutes and one upload).
 */

export function callCreatePageFile(
  this: OrbynClient,
  docId: string,
  input: PageFileInput,
) {
  return this.request<PageFileUpload>(`/docs/${docId}/files`, {
    method: "POST",
    body: input,
  });
}

/** Send a picture's or file's bytes to the link from `createPageFile`. */

export async function callUploadPageFile(
  this: OrbynClient,
  uploadPath: string,
  file: Blob | ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  return this.uploadImportFile(uploadPath, file, contentType);
}

/** A picture or file, with a link to show or download it for an hour. */

export function callPageFile(this: OrbynClient, fileId: string) {
  return this.request<PageFileLink>(`/docs/files/${fileId}`);
}

/** The pictures and files on a page. */

export function callPageFiles(this: OrbynClient, docId: string) {
  return this.request<PageFile[]>(`/docs/${docId}/files`);
}

/** Delete a picture or file for good. */

export function callDeletePageFile(this: OrbynClient, fileId: string) {
  return this.request<void>(`/docs/files/${fileId}`, { method: "DELETE" });
}

/**
 * A page as a file to keep. Comes back as a blob with the name the server
 * chose, so every client saves the same file under the same name.
 * An expected version rejects concurrent changes rather than silently exporting another revision.
 */

export async function callExportDoc(
  this: OrbynClient,
  docId: string,
  format: ExportFormat,
  options: { version?: number } = {},
) {
  const revision =
    options.version === undefined ? "" : `&version=${options.version}`;
  const response = await this.raw(
    `/docs/${docId}/export?format=${format}${revision}`,
  );
  const disposition = response.headers.get("content-disposition") ?? "";
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];
  return { blob: await response.blob(), name: named ?? `document.${format}` };
}

/** Compile an authorized document draft; source is retained by the owning editor. */

export async function callCompileDocLatex(
  this: OrbynClient,
  id: string,
  input: { source: string; version: number },
  signal?: AbortSignal,
) {
  const response = await this.raw(`/docs/${id}/latex/preview`, {
    method: "POST",
    body: input,
    signal,
  });
  return response.blob();
}

// Documents
/** Read full structured ownership with explicit format capability and fresh revision/visibility. */

export async function callGetDocContent(
  this: OrbynClient,
  id: string,
  options: { signal?: AbortSignal } = {},
) {
  id = versionedDocRead.shape.id.parse(id).toLowerCase();
  const result = versionedDocRead.parse(
    await this.request(`/docs/${id}/content`, {
      fresh: true,
      signal: options.signal,
      headers: { "x-orbyn-doc-formats": "1,2" },
    }),
  );
  if (result.id.toLowerCase() !== id)
    throw new Error("Unexpected document identity.");
  return result;
}

/** Save the complete content tree once; unsupported structure must not fall back to flat writes. */

export async function callUpdateDocContent(
  this: OrbynClient,
  id: string,
  version: number,
  document: VersionedDocContent,
  options: { signal?: AbortSignal; ticksFrom?: number } = {},
) {
  id = versionedDocRead.shape.id.parse(id).toLowerCase();
  const body = versionedDocSave.parse({ version, document });
  const result = versionedDocRead.parse(
    await this.request(`/docs/${id}/content`, {
      method: "PUT",
      body,
      signal: options.signal,
      headers: {
        "x-orbyn-doc-formats": "1,2",
        ...(options.ticksFrom !== undefined
          ? { "x-orbyn-ticks-from": String(options.ticksFrom) }
          : {}),
      },
    }),
  );
  if (result.id.toLowerCase() !== id || result.version !== version + 1)
    throw new Error("Unexpected saved document revision.");
  return result;
}

/** Every page you can see, newest edit first, optionally narrowed. */

export function callListDocs(
  this: OrbynClient,
  filter: {
    kind?: DocKind;
    project?: string;
    tag?: string;
    /** Archived pages: "include" lists them too, "only" nothing else. */
    archived?: "include" | "only";
  } = {},
) {
  const q = new URLSearchParams(
    Object.entries(filter).flatMap(([k, v]) => (v ? [[k, v]] : [])),
  ).toString();
  return this.request<DocSummary[]>(`/docs${q ? `?${q}` : ""}`);
}

/** Private ownership and schedules for selected page blocks. */

export function callListPageMaintenanceRuns(this: OrbynClient, docId: string) {
  return this.request<MaintainedPageRunSummary[]>(
    `/docs/${docId}/maintenance/runs`,
    { fresh: true },
  );
}

export async function callStopPageMaintenanceRun(
  this: OrbynClient,
  docId: string,
  runId: string,
) {
  return maintainedPageRunStopResult.parse(
    await this.request<unknown>(
      `/docs/${docId}/maintenance/runs/${runId}/stop`,
      { method: "POST", body: {} },
    ),
  );
}

export function callDecidePageMaintenanceRun(
  this: OrbynClient,
  docId: string,
  runId: string,
  waitingId: string,
  approved: boolean,
) {
  return this.request<{ state: "done" | "cancelled" }>(
    `/docs/${docId}/maintenance/runs/${runId}/decision`,
    { method: "POST", body: { waiting_id: waitingId, approved } },
  );
}

export function callListPageMaintenance(this: OrbynClient, docId: string) {
  return this.request<MaintainedPageBinding[]>(`/docs/${docId}/maintenance`);
}

export function callCreatePageMaintenance(
  this: OrbynClient,
  docId: string,
  body: MaintainedPageBindingInput,
) {
  return this.request<MaintainedPageBinding>(`/docs/${docId}/maintenance`, {
    method: "POST",
    body,
  });
}

export function callUpdatePageMaintenance(
  this: OrbynClient,
  docId: string,
  bindingId: string,
  body: MaintainedPageBindingUpdate,
) {
  return this.request<MaintainedPageBinding>(
    `/docs/${docId}/maintenance/${bindingId}`,
    { method: "PUT", body },
  );
}

export function callDeletePageMaintenance(
  this: OrbynClient,
  docId: string,
  bindingId: string,
  expectedRevision: number,
) {
  return this.request<{ ok: true }>(`/docs/${docId}/maintenance/${bindingId}`, {
    method: "DELETE",
    body: { expected_revision: expectedRevision },
  });
}

export function callGetDoc(
  this: OrbynClient,
  id: string,
  options: Pick<RequestOptions, "fresh" | "signal"> = {},
) {
  return this.request<Doc>(`/docs/${id}`, {
    ...options,
    headers: { "x-orbyn-doc-formats": "1,2" },
  });
}

/** A page's Info panel: what it belongs to, tags, links, versions. */

export function callDocInfo(this: OrbynClient, id: string) {
  return this.request<DocInfo>(`/docs/${id}/info`);
}

/** Take a source off a page (H6b); the source stays for other pages. */

export function callRemovePageSource(
  this: OrbynClient,
  docId: string,
  sourceId: string,
) {
  return this.request<void>(`/docs/${docId}/sources/${sourceId}`, {
    method: "DELETE",
  });
}

/** Put exactly these tags (by id) on a page. */

export function callSetDocTags(this: OrbynClient, id: string, tags: string[]) {
  return this.request<{ tags: DocTag[] }>(`/docs/${id}/tags`, {
    method: "PUT",
    body: { tags },
  });
}

/**
 * Add tags to a page by name, as typing "#physics" in a line does; a name
 * with no tag yet makes one. `added` says which names were new to it.
 */

export function callAddDocTags(this: OrbynClient, id: string, names: string[]) {
  return this.request<{ tags: DocTag[]; added: string[] }>(`/docs/${id}/tags`, {
    method: "POST",
    body: { names },
  });
}

export function callCreateDoc(
  this: OrbynClient,
  input: {
    title?: string;
    kind?: DocKind;
    team_id?: string | null;
    item_id?: string | null;
    folder_id?: string | null;
    project_id?: string | null;
    tags?: string[];
    content?: DocBlock[];
    /** Made inside this page (W5): its space's, it takes that page's folder. */
    parent_id?: string | null;
  },
) {
  return this.request<Doc>("/docs", { method: "POST", body: input });
}

/**
 * Save a page. An editor passes `ticksFrom`, the version of the page its
 * checklist ticks were taken from (the version it last read or saved when
 * the content was put together), so a tick made on a line as it now stands
 * counts, and one carried over from before doesn't count twice.
 */

export function callUpdateDoc(
  this: OrbynClient,
  id: string,
  input: {
    title?: string;
    content?: DocBlock[];
    folder_id?: string | null;
    project_id?: string | null;
    tags?: string[];
    /** The page it sits inside (W5), or null for its folder's top level. */
    parent_id?: string | null;
    /** Its place among the pages beside it after the move, 0 first. */
    position?: number;
    version: number;
  },
  options: { ticksFrom?: number } = {},
) {
  return this.request<Doc>(`/docs/${id}`, {
    method: "PUT",
    body: input,
    ...(options.ticksFrom
      ? { headers: { "X-Orbyn-Ticks-From": String(options.ticksFrom) } }
      : {}),
  });
}

/**
 * Move a page in the library's tree (W5): inside another page
 * (`parent_id`), to a folder's top level (`folder_id`, with `parent_id`
 * null), and/or to `position` among the pages there. Reads the page's
 * version first, so a list that is a moment old can still move it.
 */

export async function callMoveDoc(
  this: OrbynClient,
  id: string,
  to: {
    parent_id?: string | null;
    folder_id?: string | null;
    position?: number;
  },
) {
  const { version } = await this.getDoc(id);
  return this.updateDoc(id, { ...to, version });
}

/** Move a page to Trash. It can be restored for `TRASH_DAYS` days. */

export function callDeleteDoc(this: OrbynClient, id: string) {
  return this.request<void>(`/docs/${id}`, { method: "DELETE" });
}

/** Permanently forget a private Memory topic, including its source links. */

export function callForgetMemory(this: OrbynClient, id: string) {
  return this.request<{ forgotten: true }>(`/me/memory/${id}`, {
    method: "DELETE",
  });
}

/** Pages in Trash, most recently deleted first. */

export function callListTrash(this: OrbynClient) {
  return this.request<TrashedDoc[]>("/docs/trash");
}

/** Bring a page back from Trash, as it was. */

export function callRestoreDoc(this: OrbynClient, id: string) {
  return this.request<Doc>(`/docs/${id}/restore`, { method: "POST" });
}

/** Delete a page in Trash for good. There is no undo. */

export function callDeleteDocForever(this: OrbynClient, id: string) {
  return this.request<void>(`/docs/${id}/forever`, { method: "DELETE" });
}

/** Past states of a document, newest first, without their content. */

export function callListDocVersions(this: OrbynClient, id: string) {
  return this.request<DocVersion[]>(`/docs/${id}/versions`);
}

/** One past state, with its content. */

export function callGetDocVersion(
  this: OrbynClient,
  id: string,
  version: number,
) {
  return this.request<Required<DocVersion>>(`/docs/${id}/versions/${version}`, {
    headers: { "x-orbyn-doc-formats": "1,2" },
  });
}

/**
 * One past state for "Show changes": the version, the one kept before it,
 * and the sittings since (null when too many were kept since), in one read.
 */

export function callGetDocVersionChanges(
  this: OrbynClient,
  id: string,
  version: number,
) {
  return this.request<DocVersionChanges>(
    `/docs/${id}/versions/${version}/changes`,
  );
}

/**
 * Push one batch of CRDT updates for a page. The bytes are opaque here:
 * they are Yjs updates the editors on each side make sense of. Sent with
 * the editor id, so a reader can skip its own echo.
 */

export function callSendDocUpdates(
  this: OrbynClient,
  id: string,
  updates: string[],
): Promise<void> {
  return this.request<void>(`/docs/${id}/updates`, {
    method: "POST",
    body: { updates },
    headers: { "X-Orbyn-Editor": this.editorId },
  });
}

/** The page's CRDT updates past `since`, oldest first, as base64. */

export function callListDocUpdates(
  this: OrbynClient,
  id: string,
  since: number,
) {
  return this.request<{ updates: { seq: number; update: string }[] }>(
    `/docs/${id}/updates?since=${since}`,
  );
}

/** Your imports: everything still going, and the last week's. */

export function callListImports(this: OrbynClient) {
  return this.request<ImportJob[]>("/imports");
}

export function callGetImport(this: OrbynClient, id: string) {
  return this.request<ImportJob>(`/imports/${id}`);
}

/** What this server can read (scans, photos, equations), before an upload. */

export function callImportCapabilities(this: OrbynClient) {
  return this.request<ImportCapabilities>("/imports/capabilities");
}

/** Cancel an import still going, or clear a finished one from the list. */

export function callRemoveImport(this: OrbynClient, id: string) {
  return this.request<void>(`/imports/${id}`, { method: "DELETE" });
}

export function callLegalDocument(this: OrbynClient, doc: LegalDoc) {
  return this.request<LegalDocument>(`/legal/${doc}`, { anonymous: true });
}

export function callDocViewers(this: OrbynClient, docId: string) {
  return this.request<DocViewer[]>(`/docs/${docId}/presence`);
}

// ---- page templates ------------------------------------------------------

/** Your page templates, your teams', and the starters everyone has. */

export function callListPageTemplates(this: OrbynClient) {
  return this.request<PageTemplate[]>("/page-templates");
}

export function callCreatePageTemplate(
  this: OrbynClient,
  input: PageTemplateInput,
) {
  return this.request<PageTemplate>("/page-templates", {
    method: "POST",
    body: input,
  });
}

export function callUpdatePageTemplate(
  this: OrbynClient,
  id: string,
  input: PageTemplateUpdate,
) {
  return this.request<PageTemplate>(`/page-templates/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeletePageTemplate(this: OrbynClient, id: string) {
  return this.request<void>(`/page-templates/${id}`, { method: "DELETE" });
}

/** Save a page as a template: its words, folder and tags, boxes unticked. */

export function callSavePageAsTemplate(
  this: OrbynClient,
  docId: string,
  input: PageTemplateFromDoc = {},
) {
  return this.request<PageTemplate>(`/page-templates/from-doc/${docId}`, {
    method: "POST",
    body: input,
  });
}

/**
 * Make a page from a template, blanks filled in. With `make_tasks`, its
 * to-do lines become tasks (in the project, when one is chosen). For an
 * event that already has a note, that note comes back (`existing`) and
 * nothing new is made.
 */

export function callUsePageTemplate(
  this: OrbynClient,
  id: string,
  input: PageTemplateUse = {},
) {
  return this.request<{
    doc: Doc;
    tasks_created: number;
    existing: boolean;
  }>(`/page-templates/${encodeURIComponent(id)}/use`, {
    method: "POST",
    body: input,
  });
}

/** Pages nobody has changed or confirmed in months. */

export function callFadingDocs(this: OrbynClient, teamId?: string) {
  return this.request<FadingDoc[]>(
    `/docs/fading${teamId ? `?team_id=${teamId}` : ""}`,
  );
}

export function callGetPagePublication(this: OrbynClient, id: string) {
  return this.request<import("@orbyn/core").PagePublication | null>(
    `/docs/${id}/publication`,
    { fresh: true },
  );
}

export function callRevokePagePublication(this: OrbynClient, id: string) {
  return this.request(`/docs/${id}/publication`, { method: "DELETE" });
}

/** A page's own description for its card on the web. */

export function callSetWebDescription(
  this: OrbynClient,
  docId: string,
  description: string,
) {
  return this.request<PublishState>(`/docs/${docId}/web-description`, {
    method: "PUT",
    body: { description },
  });
}

/** A Markdown or Notion export into pages (DATA-08). Dry run by default. */

export function callImportPages(this: OrbynClient, input: PageImportInput) {
  return this.request<PagesImportSummary>("/imports/pages", {
    method: "POST",
    body: input,
  });
}
