import {
  docContainerBlocks,
  docFoldsForTarget,
  docFragmentIndex,
  docOutline,
  EXPORT_FORMATS,
  EXPORT_LABELS,
  foldableHeadings,
  highlightCards,
  linkMarkdown,
  movedRange,
  newBlockId,
  pageFileType,
  parseAppLink,
  plainText,
  proposeEdit,
  serializeDoc,
  showsOutline,
  blocksToClipboard,
  withClozeLines,
  type Doc,
  type DocAiAction,
  type DocBlock,
  type DocSelection,
  type DocSuggestion,
  type ExportFormat,
  type LinkPill,
  type ObjectRef,
  docObjectLinks,
} from "@orbyn/core";
import {
  Check,
  Cloud,
  CloudOff,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  Star,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount } from "../../../app/account";
import { messageOf } from "../../../lib/resource";
import { navigate, useTitle } from "../../../lib/router";
import { client } from "../../../lib/session";
import {
  Button,
  Empty,
  ErrorNotice,
  IconButton,
  Loading,
  Menu,
  Pill,
  Segmented,
  useConfirm,
  useToast,
} from "../../../ui/kit";
import { MakeCards } from "../../study/MakeCards";
import { tasks } from "../../shared-task";
import { SaveTemplateDialog } from "../Templates";
import {
  canWriteDoc,
  goTo,
  loadLibrary,
  useLibraryState,
  starDoc,
  isStarred,
  dropDoc,
} from "../store";
import { DOC_MIME } from "../drag";
import { Ask } from "./Ask";
import { fileLink } from "./Blocks";
import { CommentsPanel } from "./Comments";
import { PageContext, pillKey, type PageLinks } from "./context";
import { HistoryPanel } from "./History";
import { InfoPanel } from "./InfoPanel";
import { Look, LookDialog } from "./Look";
import { LinkedHere } from "./LinkedHere";
import type { Mark } from "./marks";
import { MaintenanceDialog } from "./Maintenance";
import { MergeDialog, TemplateInsert } from "./PageActions";
import { Presenter } from "./Presenter";
import { PublicationDialog } from "./Publish";
import { Recorder, SummaryDialog } from "./Recorder";
import { SelectionBar, type Picked } from "./SelectionBar";
import { SourceWorkspace } from "./Source";
import { Suggestions } from "./Suggestions";
import {
  findLeaf,
  leafList,
  nodesFromSource,
  rootsOf,
  type Leaf,
} from "./tree";
import { usePage } from "./usePage";
import { Writer, type WriterHandle, type WriterMode } from "./Writer";
import { useViewers, Viewers } from "./Viewers";
import { Tags } from "./Tags";

const MODE_KEY = "orbyn-doc-mode";
const READ_KEY = "orbyn-pages-read-first";

function rememberedMode(id: string): WriterMode | null {
  try {
    const saved = JSON.parse(localStorage.getItem(MODE_KEY) ?? "{}");
    const mode = saved[id];
    return mode === "read" || mode === "edit" || mode === "suggest"
      ? mode
      : null;
  } catch {
    return null;
  }
}
function rememberMode(id: string, mode: WriterMode) {
  try {
    const saved = JSON.parse(localStorage.getItem(MODE_KEY) ?? "{}");
    saved[id] = mode;
    localStorage.setItem(MODE_KEY, JSON.stringify(saved));
  } catch {
    // The mode lasts this visit without storage.
  }
}
function readsFirst() {
  try {
    const saved = localStorage.getItem(READ_KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {
    // Fall through to what the device is.
  }
  return window.matchMedia?.("(pointer: coarse)").matches;
}

const STATUS: Record<string, string> = {
  opening: "Opening…",
  unavailable: "Unavailable",
  saving: "Saving…",
  saved: "Saved",
  unsaved: "Unsaved",
  offline: "Offline. Kept here",
  failed: "Not saved",
  invalid: "Check the source",
  conflict: "Review changes",
};

type Panel = "comments" | "history" | "info" | "ask" | "outline" | null;
type Format = "note" | "markdown" | "latex";
type DialogName =
  | "publish"
  | "publication"
  | "updates"
  | "merge"
  | "template"
  | "look"
  | "present"
  | "record"
  | "cards"
  | null;

export function PageScreen({
  id,
  railToggle,
  heading,
  onWorkspaceWide,
}: {
  id: string;
  railToggle: ReactNode;
  /** Takes the crumb's place, for a page shown inside another screen. */
  heading?: ReactNode;
  onWorkspaceWide: (wide: boolean) => void;
}) {
  const { user } = useAccount();
  const { teams, stars } = useLibraryState();
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);
  const canWrite = teamId === undefined ? false : canWriteDoc(teams, teamId);
  const page = usePage(id, user?.id ?? "", canWrite);
  const doc = page.state.doc;
  useLayoutEffect(() => {
    if (doc) setTeamId(doc.team_id);
  }, [doc?.team_id, doc]); // eslint-disable-line react-hooks/exhaustive-deps
  useTitle(page.session?.title || (page.session ? "Untitled" : ""));
  // An agenda is read more than written, so it opens for reading.
  const openedKind = useRef(false);
  useEffect(() => {
    if (!doc || openedKind.current) return;
    openedKind.current = true;
    if (doc.kind === "agenda" && !rememberedMode(id)) setModeState("read");
  }, [doc, id]);
  const toast = useToast();
  const confirm = useConfirm();
  const report = useCallback(
    (failure: unknown, fallback = "Something went wrong.") =>
      toast({ text: messageOf(failure, fallback), error: true }),
    [toast],
  );

  const [mode, setModeState] = useState<WriterMode>(
    () => rememberedMode(id) ?? (readsFirst() ? "read" : "edit"),
  );
  const [panel, setPanel] = useState<Panel>(null);
  const [format, setFormat] = useState<Format>("note");
  const [dialog, setDialog] = useState<DialogName>(null);
  const [folds, setFolds] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [navError, setNavError] = useState("");
  const [suggestions, setSuggestions] = useState<DocSuggestion[]>([]);
  const [deciding, setDeciding] = useState(false);
  const [pendingComment, setPendingComment] = useState<{
    blockId: string;
    quote: string;
    range_start?: number;
    range_end?: number;
  } | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [commentMarks, setCommentMarks] = useState<Record<string, Mark[]>>({});
  const [pills, setPills] = useState(new Map<string, LinkPill>());
  const [pillRound, setPillRound] = useState(0);
  const [askSeed, setAskSeed] = useState<DocSelection | null>(null);
  const [summarising, setSummarising] = useState<{
    fileId: string;
    name: string;
  } | null>(null);
  const [insertAt, setInsertAt] = useState<Leaf | null>(null);
  const [splitStuck, setSplitStuck] = useState(false);
  const [barNarrow, setBarNarrow] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const writer = useRef<WriterHandle | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const filePlace = useRef<{ leaf: Leaf | null; images: boolean } | null>(null);
  const viewers = useViewers(id);
  const pageMutation = useRef(false);

  const reading = !canWrite ? mode !== "suggest" : mode === "read";
  const suggesting = mode === "suggest";
  const effectiveMode: WriterMode = canWrite
    ? mode
    : suggesting
      ? "suggest"
      : "read";
  const setMode = (next: WriterMode) => {
    writer.current?.settle();
    setModeState(next);
    rememberMode(id, next);
  };

  useEffect(() => {
    client.recordRecent("doc", id).catch(() => {});
    let live = true;
    client.docFolds(id).then(
      (result) => live && setFolds(new Set(result.block_ids)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [id]);

  const saveFolds = useCallback(
    (next: Set<string>) => {
      setFolds(next);
      client
        .setDocFolds(id, [...next])
        .catch((failure) => report(failure, "Couldn't save folded headings."));
    },
    [id, report],
  );

  const loadSuggestions = useCallback(() => {
    client
      .listDocSuggestions(id)
      .then(setSuggestions, (failure) =>
        report(failure, "Couldn't load proposed changes."),
      );
  }, [id, report]);
  useEffect(() => loadSuggestions(), [loadSuggestions]);

  // Link pills read their live titles and ticks.
  const refs = useMemo(() => {
    const seen = new Map<string, ObjectRef>();
    for (const link of docObjectLinks(page.leaves))
      if (link.ref.kind !== "date") seen.set(pillKey(link.ref), link.ref);
    return [...seen.values()];
  }, [page.leaves]);
  const refsKey = refs.map(pillKey).sort().join(",");
  useEffect(() => {
    if (!refs.length) return;
    let live = true;
    const chunks: (typeof refs)[] = [];
    for (let at = 0; at < refs.length; at += 60)
      chunks.push(refs.slice(at, at + 60));
    Promise.all(
      chunks.map((chunk) => client.resolveLinks(chunk as never)),
    ).then(
      (all) => {
        if (!live) return;
        const next = new Map<string, LinkPill>();
        all.flat().forEach((pill) => next.set(pillKey(pill), pill));
        setPills(next);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [refsKey, pillRound]); // eslint-disable-line react-hooks/exhaustive-deps

  // Menus render outside the pane, so the pane's own width is read here.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setBarNarrow(entry.contentRect.width <= 760),
    );
    observer.observe(element);
    return () => observer.disconnect();
  });

  /** Everything typed is saved, or the action doesn't go ahead. */
  const settled = useCallback(async () => {
    writer.current?.settle();
    const ok = await page.flush();
    if (!ok) setNavError("Save or resolve your draft first.");
    else setNavError("");
    return ok;
  }, [page]);

  const flashLine = (blockId: string | null | undefined) => {
    if (!blockId) return;
    setFlash(blockId);
    window.setTimeout(
      () => setFlash((was) => (was === blockId ? null : was)),
      1600,
    );
  };

  const goToFragment = useCallback(
    (fragment: string) => {
      const list = page.leaves;
      const at = docFragmentIndex(list, fragment);
      if (at === null) {
        if (fragment.startsWith("fn-")) {
          globalThis.document
            .getElementById(fragment)
            ?.scrollIntoView({ block: "center" });
          return;
        }
        setNavError("This heading or line is no longer in the page.");
        return;
      }
      setNavError("");
      const next = docFoldsForTarget(list, folds, at);
      if (next.size !== folds.size) saveFolds(next);
      const place = () =>
        body.current
          ?.querySelector<HTMLElement>(`[data-leaf-index="${at}"]`)
          ?.scrollIntoView({ block: "center" });
      requestAnimationFrame(() => {
        place();
        flashLine(list[at]?.id);
      });
      // Diagrams and pictures above it arrive later and push it down.
      const settle = [300, 900, 1800].map((delay) =>
        window.setTimeout(place, delay),
      );
      const stop = () => {
        settle.forEach(clearTimeout);
        body.current?.removeEventListener("wheel", stop);
        body.current?.removeEventListener("touchstart", stop);
      };
      body.current?.addEventListener("wheel", stop, { once: true });
      body.current?.addEventListener("touchstart", stop, { once: true });
    },
    [page.leaves, folds, saveFolds],
  );

  // #blockId deep links, on opening and when the hash changes.
  const hashDone = useRef("");
  useEffect(() => {
    const go = () => {
      const fragment = decodeURIComponent(location.hash.slice(1));
      if (!fragment || !page.leaves.length || hashDone.current === fragment)
        return;
      hashDone.current = fragment;
      goToFragment(fragment);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [page.leaves.length, goToFragment]);

  const openLink = useCallback(
    (url: string) => {
      const link = parseAppLink(url);
      if (link?.kind === "doc" && link.id === id && link.block)
        return goToFragment(link.block);
      void settled().then((ok) => {
        if (!ok) return;
        if (!link) return;
        if (link.kind === "doc")
          navigate(`/app/doc/${link.id}${link.block ? `#${link.block}` : ""}`);
        else if (link.kind === "task") tasks.open(link.id);
        else if (link.kind === "project") navigate(`/app/project/${link.id}`);
      });
    },
    [id, goToFragment, settled],
  );

  const links = useMemo<PageLinks>(
    () => ({
      docId: id,
      pills,
      onFragment: goToFragment,
      onOpen: openLink,
      projectId: doc?.project_id ?? null,
      onSummarise: (fileId, name) => setSummarising({ fileId, name }),
      onToggleTask: (task, done) => {
        client
          .updateItem(task, { status: done ? "done" : "todo" } as never)
          .then(
            () => setPillRound((n) => n + 1),
            (failure) => report(failure, "Couldn't change this task."),
          );
      },
      onRestoreDoc: (target) => {
        client.restoreDoc(target).then(
          () => setPillRound((n) => n + 1),
          (failure) => report(failure, "Couldn't restore this page."),
        );
      },
    }),
    [id, pills, goToFragment, openLink, doc?.project_id, report],
  );

  const marks = useMemo(() => {
    const out: Record<string, Mark[]> = { ...commentMarks };
    for (const suggestion of suggestions)
      if (suggestion.status === "open" && !suggestion.detached)
        (out[suggestion.block_id] = [...(out[suggestion.block_id] ?? [])]).push(
          {
            start: suggestion.range_start,
            end: Math.max(suggestion.range_end, suggestion.range_start + 1),
            proposed: true,
          },
        );
    return out;
  }, [commentMarks, suggestions]);

  /** A line needs a name before anything can point at it. */
  const nameLine = async (leaf: Leaf) => {
    if (leaf.block.id) return leaf.block.id;
    const session = page.store.state.session;
    const named = await client.anchorLine(
      id,
      leaf.index,
      "text" in leaf.block ? leaf.block.text : "",
      session?.saved.version,
    );
    await page.store.refresh();
    return named.block_id;
  };
  const leafOf = (blockId: string): Leaf | null => {
    const document = page.store.state.session?.document;
    if (!document) return null;
    const unnamed = /^index:(\d+)$/.exec(blockId);
    return unnamed
      ? (leafList(document)[Number(unnamed[1])] ?? null)
      : findLeaf(document, blockId);
  };

  const commentOn = async (
    leaf: Leaf,
    range?: { quote: string; start: number; end: number },
  ) => {
    if (!(await settled())) return;
    try {
      const blockId = await nameLine(leaf);
      setPendingComment({
        blockId,
        quote: (
          range?.quote ?? ("text" in leaf.block ? leaf.block.text : "")
        ).slice(0, 400),
        ...(range ? { range_start: range.start, range_end: range.end } : {}),
      });
      setActiveComment(blockId);
      setPanel("comments");
    } catch (failure) {
      report(failure, "Couldn't start a comment.");
    }
  };

  const linesToTasks = async (blockIds?: string[]) => {
    if (!(await settled())) return 0;
    const { created } = await client.docToTasks(id, blockIds);
    await page.store.refresh();
    page.announce();
    return created;
  };

  const taskFrom = async (leaf: Leaf, quote?: string) => {
    const title = plainText(
      quote ?? ("text" in leaf.block ? leaf.block.text : ""),
    )
      .trim()
      .slice(0, 200);
    if (!title) return;
    try {
      const blockId = newBlockId();
      const parent = leaf.path.slice(0, -1);
      page.edit({
        kind: "insert",
        owner: parent,
        index: leaf.path[leaf.path.length - 1] + 1,
        node:
          page.document?.format === 2
            ? {
                kind: "list",
                ordered: false,
                start: 1,
                delimiter: "-",
                loose: false,
                items: [
                  {
                    checked: false,
                    children: [
                      {
                        kind: "block",
                        block: { type: "paragraph", text: title, id: blockId },
                      },
                    ],
                  },
                ],
              }
            : {
                kind: "block",
                block: { type: "todo", text: title, done: false, id: blockId },
              },
      });
      const made = await linesToTasks([blockId]);
      toast({
        text: made ? `Added “${title}” to your tasks` : "Already a task",
      });
    } catch (failure) {
      report(failure, "Couldn't make a task.");
    }
  };

  const moveToPage = async (leaf: Leaf) => {
    if (page.document?.format !== 1 && leaf.path.length > 1) {
      toast({
        text: "Move the whole list or quote from its first line.",
        error: true,
      });
      return;
    }
    if (!(await settled())) return;
    try {
      const list = page.leaves;
      const { start, end } = movedRange(list, leaf.index);
      const ids = list
        .slice(start, end)
        .map((block) => block.id!)
        .filter(Boolean);
      const session = page.store.state.session;
      if (!session) return;
      const { doc: made, source } = await client.extractToPage(id, {
        block_ids: ids,
        version: session.saved.version,
      });
      page.adopt(source);
      void loadLibrary();
      toast({
        text: `Moved to “${made.title}”. A link to it is left here.`,
        action: { label: "Open", run: () => navigate(`/app/doc/${made.id}`) },
      });
    } catch (failure) {
      report(failure, "Couldn't move this to a new page.");
    }
  };

  const copyLineLink = async (leaf: Leaf) => {
    if (!(await settled())) return;
    const url = `${location.origin}/app/doc/${id}${leaf.block.id ? `#${leaf.block.id}` : ""}`;
    await navigator.clipboard.writeText(url).then(
      () => toast({ text: "Link to this line copied" }),
      () => toast({ text: "Couldn't copy the link", error: true }),
    );
  };

  const addFiles = async (
    files: File[],
    after: Leaf | null,
    replace: boolean,
  ) => {
    if (!files.length) return;
    toast({
      text:
        files.length === 1
          ? `Adding “${files[0].name}”…`
          : `Adding ${files.length} files…`,
    });
    const { scaledPicture } = await import("./files");
    const made: DocBlock[] = [];
    for (const file of files) {
      try {
        const mime = pageFileType(file.name, file.type);
        if (!mime)
          throw new Error(
            `“${file.name}” can't go in a page: pictures, PDF, Word, Excel, PowerPoint, text and CSV files can.`,
          );
        const picture = file.type.startsWith("image/");
        const data = picture
          ? await scaledPicture(file)
          : {
              blob: file as Blob,
              width: undefined,
              height: undefined,
              type: mime,
            };
        const { file: row, upload_path } = await client.createPageFile(id, {
          name: file.name.slice(0, 300) || "File",
          bytes: data.blob.size,
          mime: data.type || mime,
          ...(data.width ? { width: data.width, height: data.height } : {}),
        });
        await client.uploadPageFile(upload_path, data.blob, data.type || mime);
        made.push(
          row.kind === "image"
            ? { type: "image", file: row.id, text: "", id: newBlockId() }
            : { type: "file", file: row.id, text: row.name, id: newBlockId() },
        );
      } catch (failure) {
        report(failure, `Couldn't add ${file.name}.`);
      }
    }
    if (!made.length) return;
    const document = page.store.state.session?.document;
    if (!document) return;
    const roots = rootsOf(document);
    const emptyTarget =
      replace &&
      after &&
      after.block.type === "paragraph" &&
      !after.block.text.replace(/^\/\S*$/, "").trim();
    const owner = after ? after.path.slice(0, -1) : [];
    let index = after ? after.path[after.path.length - 1] + 1 : roots.length;
    if (emptyTarget && after) {
      page.edit({ kind: "remove", path: after.path });
      index -= 1;
    }
    made.forEach((block, offset) => {
      page.edit({
        kind: "insert",
        owner,
        index: index + offset,
        node: { kind: "block", block },
      });
    });
    toast({
      text:
        made.length === 1 ? "Added to the page" : `Added ${made.length} files`,
    });
  };

  const pickFiles = (leaf: Leaf | null, images: boolean) => {
    filePlace.current = { leaf, images };
    const input = fileInput.current;
    if (!input) return;
    input.accept = images ? "image/*" : "";
    input.click();
  };

  const propose = async (leaf: Leaf, before: string, after: string) => {
    try {
      const change = proposeEdit(await nameLine(leaf), before, after);
      if (!change) return;
      const made = await client.proposeDocChanges(id, [change]);
      setSuggestions((list) => [...list, ...made]);
      toast({ text: "Suggested. It waits for someone to take it." });
    } catch (failure) {
      report(failure, "Couldn't suggest this change.");
    }
  };

  const review = async (
    actions: { suggestion: DocSuggestion; take?: boolean }[],
  ) => {
    if (deciding) return;
    setDeciding(true);
    try {
      if (!(await settled())) return;
      for (const { suggestion, take } of actions) {
        if (take === undefined)
          await client.withdrawDocSuggestion(id, suggestion.id);
        else await client.decideDocSuggestion(id, suggestion.id, take);
      }
      await page.store.refresh();
      page.announce();
    } catch (failure) {
      report(failure, "Couldn't finish this review.");
    } finally {
      setDeciding(false);
      loadSuggestions();
    }
  };

  const assist = async (
    picked: Picked,
    action: DocAiAction,
    instruction = "",
  ) => {
    setDeciding(true);
    try {
      if (!(await settled())) return;
      const leaf = leafOf(picked.blockId);
      if (!leaf)
        throw new Error(
          "The selected text changed. Select it again before asking.",
        );
      const blockId = await nameLine(leaf);
      const session = page.store.state.session;
      if (!session) return;
      const made = await client.assistDoc(id, {
        block_id: blockId,
        range_start: picked.start,
        range_end: picked.end,
        action,
        instruction,
        quote: picked.quote,
        version: session.saved.version,
      });
      setSuggestions((list) => [...list, made]);
      toast({ text: "Suggested. Review it before accepting." });
    } catch (failure) {
      report(failure, "Couldn't ask the assistant.");
    } finally {
      setDeciding(false);
    }
  };

  const exportAs = async (type: ExportFormat) => {
    if (!(await settled())) return;
    try {
      const { blob, name } = await client.exportDoc(id, type, {
        version: page.store.state.session?.saved.version,
      });
      const url = URL.createObjectURL(blob);
      const link = globalThis.document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      report(failure, "Couldn't export this page.");
    }
  };

  const copyPage = async (rich: boolean) => {
    const list = page.leaves;
    try {
      if (rich) {
        const urls = new Map<string, string>();
        await Promise.all(
          list.flatMap((block) =>
            block.type === "image" || block.type === "file"
              ? [
                  fileLink(block.file).then(
                    (link) => urls.set(block.file, link.url),
                    () => {},
                  ),
                ]
              : [],
          ),
        );
        const { html, text } = blocksToClipboard(list, {
          fileUrl: (file) => urls.get(file) ?? null,
        });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
        toast({
          text: "Copied. It pastes with its headings, lists and links.",
        });
      } else {
        await navigator.clipboard.writeText(serializeDoc(list));
        toast({ text: "Copied as Markdown" });
      }
    } catch {
      toast({ text: "Couldn't copy the page", error: true });
    }
  };

  const runPage = async (work: () => Promise<void>, fallback: string) => {
    if (pageMutation.current) return;
    pageMutation.current = true;
    try {
      await work();
    } catch (failure) {
      report(failure, fallback);
    } finally {
      pageMutation.current = false;
    }
  };

  const remove = () =>
    runPage(async () => {
      if (!doc) return;
      const title = page.session?.title || "Untitled";
      if (doc.kind === "memory") {
        const ok = await confirm({
          title: `Forget “${title}”?`,
          body: "This permanently removes the Memory note and its source links. This cannot be undone.",
          action: "Forget",
          danger: true,
        });
        if (!ok) return;
        await client.forgetMemory(id);
        dropDoc(id);
        toast({ text: "Memory topic forgotten" });
        navigate("/app/memory");
        return;
      }
      if (!(await settled())) return;
      await client.deleteDoc(id);
      dropDoc(id);
      navigate("/app/docs");
      toast({
        text: `Moved “${title}” to Trash`,
        action: {
          label: "Undo",
          run: () =>
            void client.restoreDoc(id).then(
              (back) => {
                void loadLibrary();
                navigate(`/app/doc/${back.id}`);
              },
              (failure) => report(failure, "Couldn't restore this page."),
            ),
        },
      });
    }, "Couldn't delete this page.");

  const toggleArchive = () =>
    runPage(async () => {
      if (!doc) return;
      if (!(await settled())) return;
      const next = !doc.archived;
      await client.archiveDoc(id, next);
      await page.store.refresh();
      page.announce();
      void loadLibrary();
      toast({ text: next ? "Page archived." : "Page restored." });
    }, "Couldn't change this page.");

  const makeCards = () => {
    const document = page.store.state.session?.document;
    if (document?.format !== 1) return setDialog("cards");
    const lines = highlightCards(document.blocks);
    if (!lines.length) {
      toast({
        text: "Highlight the words to learn with ==, then make cards from them.",
      });
      return;
    }
    const next = withClozeLines(document.blocks, lines);
    page.replaceDocument({ format: 1, blocks: next });
    toast({
      text: `Added ${lines.length} card${lines.length === 1 ? "" : "s"} under Cards. Study shows them.`,
    });
  };

  const chooseFormat = async (next: Format) => {
    if (next === format) return;
    if (!(await settled())) return;
    setFormat(next);
    setPanel((was) => (next === "note" ? was : null));
    onWorkspaceWide(next !== "note");
  };
  useEffect(() => () => onWorkspaceWide(false), [onWorkspaceWide]);

  // Page-wide keys: Read/Edit, and dropping a page in as a link.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "r"
      ) {
        event.preventDefault();
        if (canWrite) setMode(mode === "read" ? "edit" : "read");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (page.gone)
    return (
      <div className="page-frame">
        <div className="page-bar">{railToggle}</div>
        <Empty
          title={
            page.gone === "forgotten"
              ? "This note was forgotten"
              : "This page moved to Trash"
          }
        >
          <p className="small">
            {page.gone === "trashed"
              ? "It can be restored from Trash."
              : "It can't be brought back."}
          </p>
          <Button onClick={() => navigate("/app/docs")}>Back to Library</Button>
        </Empty>
      </div>
    );

  if (!page.session || !page.document || !doc) {
    const status = (page.state.error as { statusCode?: number } | null)
      ?.statusCode;
    return (
      <div className="page-frame">
        <div className="page-bar">{railToggle}</div>
        <div className="page-center">
          {page.state.error ? (
            status === 404 || status === 403 ? (
              <Empty title="This page isn't here">
                <p className="small">
                  It may have moved to Trash, or it isn't yours to open.
                </p>
                <Button onClick={() => navigate("/app/docs")}>
                  Back to Library
                </Button>
              </Empty>
            ) : (
              <ErrorNotice
                message="Couldn't open this page."
                onRetry={() => void page.store.open(id)}
              />
            )
          ) : (
            <Loading label="Opening page" />
          )}
        </div>
      </div>
    );
  }

  const title = page.session.title;
  const starred = isStarred(stars, id);
  const outline = docOutline(page.leaves);
  const foldable = foldableHeadings(page.leaves);
  const anyOpen = foldable.some((one) => !folds.has(one));
  const dirtyBlocked = page.dirty || page.state.source !== null;
  const saveIcon =
    page.status === "saving" ? (
      <Loader2 className="doc-spin" aria-hidden="true" />
    ) : page.status === "saved" ? (
      <Check aria-hidden="true" />
    ) : page.status === "offline" ? (
      <CloudOff aria-hidden="true" />
    ) : (
      <Cloud aria-hidden="true" />
    );

  const blocksNow =
    page.document.format === 2
      ? docContainerBlocks(page.document.nodes, { projected: true })
      : page.document.blocks;
  void blocksNow;

  const titleArea =
    canWrite && mode === "edit" ? (
      <TitleField
        value={title}
        locked={page.state.conflict || page.state.sourceInvalid}
        onChange={page.setTitle}
        onEnter={() => {
          const first = body.current?.querySelector<HTMLElement>(
            ".doc-rendered[tabindex]",
          );
          first?.click();
        }}
      />
    ) : (
      <h1 className="page-title" dir="auto">
        {title || "Untitled"}
      </h1>
    );

  const writing = (
    <div
      className="page-scroll"
      ref={body}
      onDragOver={(event) => {
        if (!canWrite || reading) return;
        const types = [...event.dataTransfer.types];
        if (types.includes("Files") || types.includes(DOC_MIME))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (!canWrite || reading) return;
        const files = [...event.dataTransfer.files];
        const dropped = event.dataTransfer.getData(DOC_MIME);
        if (!files.length && !dropped) return;
        event.preventDefault();
        const list = leafList(page.store.state.session!.document);
        const after = [
          ...globalThis.document.elementsFromPoint(
            event.clientX,
            event.clientY,
          ),
        ]
          .map((element) => element.closest<HTMLElement>("[data-leaf-index]"))
          .find(Boolean);
        const leaf = after
          ? (list[Number(after.dataset.leafIndex)] ?? null)
          : (list[list.length - 1] ?? null);
        if (files.length) void addFiles(files, leaf, false);
        else if (dropped && dropped !== id) {
          const label = event.dataTransfer.getData("text/plain") || "Untitled";
          const document = page.store.state.session!.document;
          const roots = rootsOf(document);
          const text = linkMarkdown({ kind: "doc", id: dropped }, label);
          const owner = leaf ? leaf.path.slice(0, -1) : [];
          page.edit({
            kind: "insert",
            owner,
            index: leaf ? leaf.path[leaf.path.length - 1] + 1 : roots.length,
            node: {
              kind: "block",
              block: { type: "paragraph", text, id: newBlockId() },
            },
          });
        }
      }}
    >
      <article className="page-column">
        <Look doc={doc} />
        {titleArea}
        <div className="page-sub">
          <Tags page={page} doc={doc} canWrite={canWrite} />
          {doc.team_name && (
            <span className="small muted" dir="auto">
              {doc.team_name}
            </span>
          )}
          {doc.via_agent && <Pill>Written by {doc.via_agent}</Pill>}
          {doc.archived && <Pill tone="amber">Archived</Pill>}
          {doc.original && <OriginalLine doc={doc} />}
        </div>
        <Suggestions
          suggestions={suggestions}
          userId={user?.id}
          canDecide={canWrite}
          busy={deciding || page.state.busy || page.dirty}
          onDecide={(suggestion, take) => void review([{ suggestion, take }])}
          onWithdraw={(suggestion) => void review([{ suggestion }])}
          onDecideAll={(list, take) =>
            void review(list.map((suggestion) => ({ suggestion, take })))
          }
        />
        <Writer
          key={page.resetKey}
          page={page}
          mode={effectiveMode}
          canWrite={canWrite}
          linked={new Set(doc.linked_block_ids ?? [])}
          folds={folds}
          onFold={(block) => {
            const next = new Set(folds);
            if (next.has(block)) next.delete(block);
            else next.add(block);
            saveFolds(next);
          }}
          marks={marks}
          handle={writer}
          onComment={(leaf) => void commentOn(leaf)}
          onTask={(leaf) => void taskFrom(leaf)}
          onMoveToPage={(leaf) => void moveToPage(leaf)}
          onCopyLink={(leaf) => void copyLineLink(leaf)}
          onAddFiles={(files, after, replace) =>
            void addFiles(files, after, replace)
          }
          onPickFiles={pickFiles}
          onTemplate={setInsertAt}
          onTagsTyped={(names) => {
            client.addDocTags(id, names).then(
              () => void page.store.refresh(),
              (failure) => report(failure, "Couldn't add the tag."),
            );
          }}
          onPropose={(leaf, before, after) => void propose(leaf, before, after)}
          onOpenCode={() => void chooseFormat("latex")}
          flashId={flash}
        />
        <LinkedHere id={id} title={title} />
      </article>
    </div>
  );

  return (
    <PageContext.Provider value={links}>
      <div
        ref={frame}
        className="page-frame"
        data-format={format}
        data-panel={panel ?? undefined}
        data-stuck={splitStuck || undefined}
      >
        <header className="page-bar">
          {railToggle}
          {heading ?? (
            <span className="page-crumb small" dir="auto">
              {title || "Untitled"}
            </span>
          )}
          <Viewers viewers={viewers} />
          <span className={`page-status small is-${page.status}`} role="status">
            {saveIcon} {STATUS[page.status]}
          </span>
          {(page.status === "failed" || page.status === "offline") && (
            <Button variant="ghost" onClick={() => void page.save(true)}>
              Retry save
            </Button>
          )}
          {page.news && (
            <span className="small muted page-news">{page.news}</span>
          )}
          <span className="page-tools">
            <span className="page-wide-only">
              {canWrite ? (
                <Segmented
                  label="Page mode"
                  value={mode}
                  options={[
                    { value: "read", label: "Read" },
                    { value: "edit", label: "Edit" },
                    { value: "suggest", label: "Suggest" },
                  ]}
                  onChange={setMode}
                />
              ) : (
                <Segmented
                  label="Page mode"
                  value={suggesting ? "suggest" : "read"}
                  options={[
                    { value: "read", label: "Read" },
                    { value: "suggest", label: "Suggest" },
                  ]}
                  onChange={setMode}
                />
              )}
            </span>
            <span className="page-wide-only">
              <Segmented
                label="Document editing mode"
                value={format}
                options={[
                  { value: "note", label: "Note" },
                  { value: "markdown", label: "Markdown" },
                  { value: "latex", label: "LaTeX" },
                ]}
                onChange={(next) => void chooseFormat(next)}
              />
            </span>
            <IconButton
              label="Comments"
              aria-pressed={panel === "comments"}
              onClick={() => setPanel(panel === "comments" ? null : "comments")}
            >
              <MessageSquare />
            </IconButton>
            <IconButton
              label="Talk about this page"
              aria-pressed={panel === "ask"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setAskSeed(null);
                setPanel(panel === "ask" ? null : "ask");
              }}
            >
              <Sparkles />
            </IconButton>
            <Menu
              label="Page actions"
              trigger={(show, expanded) => (
                <IconButton
                  label="Page actions"
                  aria-expanded={expanded}
                  onClick={show}
                >
                  <MoreHorizontal />
                </IconButton>
              )}
            >
              {(close) => {
                const item = (
                  label: string,
                  run: () => void,
                  danger?: boolean,
                  disabled?: boolean,
                ) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    disabled={disabled}
                    className={danger ? "is-danger" : undefined}
                    onClick={() => {
                      close();
                      run();
                    }}
                  >
                    {label}
                  </button>
                );
                return (
                  <>
                    {barNarrow && (
                      <>
                        <p className="doc-menu-label small muted">Mode</p>
                        {canWrite && item("Edit", () => setMode("edit"))}
                        {item("Read", () => setMode("read"))}
                        {item("Suggest", () => setMode("suggest"))}
                        <p className="doc-menu-label small muted">Format</p>
                        {item("Note", () => void chooseFormat("note"))}
                        {item("Markdown", () => void chooseFormat("markdown"))}
                        {item("LaTeX", () => void chooseFormat("latex"))}
                      </>
                    )}
                    {item("Page history", () => setPanel("history"))}
                    {item("Page info", () => setPanel("info"))}
                    {showsOutline(outline) &&
                      item("Contents", () => setPanel("outline"))}
                    {item(
                      "Copy link",
                      () =>
                        void navigator.clipboard
                          .writeText(`${location.origin}/app/doc/${id}`)
                          .then(
                            () => toast({ text: "Link copied" }),
                            () =>
                              toast({
                                text: "Couldn't copy the link",
                                error: true,
                              }),
                          ),
                    )}
                    {item("Present", () => setDialog("present"))}
                    {item("Open in new window", () =>
                      window.open(`/app/doc/${id}`, "_blank", "noopener"),
                    )}
                    {item(
                      starred ? "Unstar" : "Star",
                      () =>
                        void starDoc(id, !starred).catch((failure) =>
                          report(failure, "Couldn't change favorites."),
                        ),
                    )}
                    {item("Show in library", () => {
                      goTo(
                        doc.archived
                          ? { at: "archived" }
                          : doc.folder_id
                            ? { at: "folder", id: doc.folder_id }
                            : { at: "unfiled" },
                      );
                      navigate(
                        doc.kind === "memory"
                          ? "/app/memory"
                          : doc.kind === "agent"
                            ? "/app/agent-notes"
                            : "/app/docs",
                      );
                    })}
                    {item("Refresh", () => void page.store.refresh())}
                    {canWrite &&
                      doc.kind !== "memory" &&
                      item("Cover and icon", () => setDialog("look"))}
                    {canWrite &&
                      doc.kind !== "agenda" &&
                      doc.kind !== "memory" &&
                      item(
                        doc.archived ? "Bring back from archive" : "Archive",
                        () => void toggleArchive(),
                      )}
                    {foldable.length > 0 &&
                      item(
                        anyOpen
                          ? "Collapse all headings"
                          : "Expand all headings",
                        () =>
                          saveFolds(anyOpen ? new Set(foldable) : new Set()),
                      )}
                    {canWrite &&
                      doc.kind === "doc" &&
                      !suggesting &&
                      item(
                        "Page updates…",
                        () =>
                          void settled().then(
                            (ok) => ok && setDialog("updates"),
                          ),
                      )}
                    {doc.kind !== "agenda" &&
                      doc.kind !== "memory" &&
                      item(
                        "Publish to web…",
                        () =>
                          void settled().then(
                            (ok) => ok && setDialog("publish"),
                          ),
                      )}
                    {doc.kind !== "memory" &&
                      item(
                        "Save as template",
                        () =>
                          void settled().then(
                            (ok) => ok && setDialog("template"),
                          ),
                      )}
                    {canWrite &&
                      !reading &&
                      item("Add a picture or file", () =>
                        pickFiles(null, false),
                      )}
                    {canWrite &&
                      !reading &&
                      !suggesting &&
                      item("Record audio", () => setDialog("record"))}
                    {canWrite &&
                      !reading &&
                      !suggesting &&
                      item(
                        "Merge into…",
                        () =>
                          void settled().then((ok) => ok && setDialog("merge")),
                      )}
                    {item("Make study cards", makeCards)}
                    {canWrite &&
                      !reading &&
                      !suggesting &&
                      item(
                        "Make tasks from checklist",
                        () =>
                          void linesToTasks().then(
                            (made) =>
                              toast({
                                text: made
                                  ? `${made} tasks added`
                                  : "Nothing new to add",
                              }),
                            (failure) =>
                              report(failure, "Couldn't make tasks."),
                          ),
                      )}
                    <p className="doc-menu-label small muted">Export</p>
                    {EXPORT_FORMATS.map((type) =>
                      item(
                        `Export ${EXPORT_LABELS[type].name}`,
                        () => void exportAs(type),
                      ),
                    )}
                    {doc.original &&
                      canWrite &&
                      item(
                        "Delete the original file",
                        () =>
                          void confirm({
                            title: "Delete the original file?",
                            body: doc.original!.file_name,
                            action: "Delete",
                            danger: true,
                          }).then((ok) => {
                            if (!ok) return;
                            void client.deleteOriginal(id).then(
                              () => void page.store.refresh(),
                              (failure) =>
                                report(
                                  failure,
                                  "Couldn't delete the original.",
                                ),
                            );
                          }),
                      )}
                    {item("Copy as Markdown", () => void copyPage(false))}
                    {item("Copy for another app", () => void copyPage(true))}
                    {canWrite &&
                      doc.kind !== "memory" &&
                      item("Move to Trash", () => void remove(), true)}
                    {canWrite &&
                      doc.kind === "memory" &&
                      item(
                        "Forget this Memory note…",
                        () => void remove(),
                        true,
                      )}
                  </>
                );
              }}
            </Menu>
            <IconButton
              label={starred ? "Unstar" : "Star"}
              aria-pressed={starred}
              onClick={() =>
                void starDoc(id, !starred).catch((failure) =>
                  report(failure, "Couldn't change favorites."),
                )
              }
            >
              <Star fill={starred ? "currentColor" : "none"} />
            </IconButton>
          </span>
        </header>

        {!canWrite && teamId !== undefined && (
          <p className="page-banner small">
            You can read this page{doc.team_name ? ` in ${doc.team_name}` : ""}.
            Comments and suggestions still work.
          </p>
        )}
        {page.recovery && (
          <div className="page-banner is-warn small" role="alert">
            <span>
              Unsaved changes from {new Date(page.recovery.at).toLocaleString()}{" "}
              were kept on this device.
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                const problem = page.recover(true);
                if (problem) report(new Error(problem));
              }}
            >
              Restore them
            </Button>
            <Button variant="ghost" onClick={() => page.recover(false)}>
              Discard
            </Button>
          </div>
        )}
        {page.state.conflict && <ConflictBanner page={page} doc={doc} />}
        {page.status === "failed" && !page.state.conflict && (
          <p className="page-banner is-warn small" role="alert">
            Couldn't save this page. Your draft is still here, and saving will
            try again.
          </p>
        )}
        {page.status === "offline" && (
          <p className="page-banner small" role="status">
            You're offline. Your draft stays on this device and saves when
            you're back.
          </p>
        )}
        {page.status === "invalid" && (
          <p className="page-banner is-warn small" role="alert">
            {page.state.error instanceof Error
              ? page.state.error.message
              : "This source can't be read yet."}
          </p>
        )}
        {navError && (
          <p className="page-banner is-warn small" role="status">
            {navError}
          </p>
        )}

        <div className="page-main">
          {format === "note" ? (
            writing
          ) : (
            <SourceWorkspace
              page={page}
              format={format}
              canWrite={canWrite && !reading}
              preview={writing}
              previewRoot={body}
              onStuck={setSplitStuck}
              onAsk={(selection) => {
                setAskSeed(selection);
                setPanel("ask");
              }}
            />
          )}
          {panel && format === "note" && (
            <aside className="page-panel" aria-label="Page panel">
              {panel === "comments" && (
                <CommentsPanel
                  docId={id}
                  blocks={page.leaves}
                  userId={user?.id}
                  pending={pendingComment}
                  onPending={setPendingComment}
                  active={activeComment}
                  onActive={setActiveComment}
                  onMarks={setCommentMarks}
                  onGoTo={goToFragment}
                  onClose={() => setPanel(null)}
                />
              )}
              {panel === "history" && (
                <HistoryPanel
                  page={page}
                  canWrite={canWrite}
                  settled={settled}
                  onClose={() => setPanel(null)}
                />
              )}
              {panel === "info" && (
                <InfoPanel
                  page={page}
                  doc={doc}
                  canWrite={canWrite}
                  onClose={() => setPanel(null)}
                />
              )}
              {panel === "ask" && (
                <Ask
                  docId={id}
                  blocks={page.leaves}
                  canWrite={canWrite}
                  seed={askSeed}
                  ensureSaved={settled}
                  version={() => page.store.state.session?.saved.version ?? 0}
                  onGoTo={goToFragment}
                  onSuggested={(made) =>
                    setSuggestions((list) => [...list, made])
                  }
                  onClose={() => setPanel(null)}
                />
              )}
              {panel === "outline" && (
                <div className="page-panel-body">
                  <div className="page-panel-head">
                    <h2>Contents</h2>
                    <Button variant="ghost" onClick={() => setPanel(null)}>
                      Close
                    </Button>
                  </div>
                  <ol className="page-outline">
                    {outline.map((entry) => (
                      <li
                        key={entry.index}
                        style={{ paddingInlineStart: (entry.level - 1) * 12 }}
                      >
                        <button
                          type="button"
                          dir="auto"
                          onClick={() =>
                            goToFragment(
                              page.leaves[entry.index]?.id ??
                                `h-${entry.index}`,
                            )
                          }
                        >
                          {entry.text}
                        </button>
                        {page.leaves[entry.index]?.id && (
                          <HeadingStar
                            docId={id}
                            blockId={page.leaves[entry.index].id!}
                            text={entry.text}
                          />
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </aside>
          )}
        </div>
        <SelectionBar
          root={body}
          page={page}
          canWrite={canWrite && !reading && !suggesting}
          disabled={deciding}
          onComment={(picked) => {
            const leaf = leafOf(picked.blockId);
            if (leaf)
              void commentOn(leaf, {
                quote: picked.quote,
                start: picked.start,
                end: picked.end,
              });
          }}
          onAssist={(picked, action, instruction) =>
            void assist(picked, action, instruction)
          }
          onTask={(picked) => {
            const leaf = leafOf(picked.blockId);
            if (leaf) void taskFrom(leaf, picked.quote);
          }}
          onAskPage={(selection) => {
            setAskSeed(selection);
            setPanel("ask");
          }}
        />
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          aria-label="Choose files to add"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            const place = filePlace.current;
            filePlace.current = null;
            void addFiles(files, place?.leaf ?? null, !!place?.leaf);
          }}
        />
        {dialog === "publish" && (
          <PublicationDialog
            id={id}
            onChanged={(next: Doc) => page.adopt(next)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "updates" && (
          <MaintenanceDialog
            id={id}
            onChanged={(next) => page.adopt(next)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "merge" && (
          <MergeDialog
            doc={doc}
            version={async () =>
              page.store.state.session?.saved.version ?? doc.version
            }
            onClose={() => setDialog(null)}
            onMerged={(into, relinked) => {
              dropDoc(id);
              toast({
                text: relinked
                  ? `Merged. ${relinked} links now point to “${into.title}”.`
                  : "Merged.",
              });
              navigate(`/app/doc/${into.id}`);
            }}
          />
        )}
        {dialog === "template" && (
          <SaveTemplateDialog doc={doc} onClose={() => setDialog(null)} />
        )}
        {dialog === "look" && (
          <LookDialog
            doc={doc}
            onClose={() => setDialog(null)}
            onSaved={() => void page.store.refresh()}
          />
        )}
        {dialog === "present" && (
          <Presenter
            title={title}
            blocks={page.leaves}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "record" && (
          <Recorder
            docId={id}
            onClose={() => setDialog(null)}
            onAdded={(block) => {
              const document = page.store.state.session?.document;
              if (!document) return;
              page.edit({
                kind: "insert",
                owner: [],
                index: rootsOf(document).length,
                node: { kind: "block", block },
              });
            }}
          />
        )}
        {summarising && (
          <SummaryDialog
            fileId={summarising.fileId}
            name={summarising.name}
            onClose={() => setSummarising(null)}
            onAdd={(lines) => {
              const document = page.store.state.session?.document;
              if (!document) return;
              const nodes = nodesFromSource(
                document,
                { type: "paragraph", text: "" },
                serializeDoc(lines),
              );
              let index = rootsOf(document).length;
              nodes.forEach((node) =>
                page.edit({ kind: "insert", owner: [], index: index++, node }),
              );
            }}
          />
        )}
        {dialog === "cards" && (
          <MakeCards
            docId={id}
            title={title || "Untitled"}
            onClose={() => {
              setDialog(null);
              void page.store.refresh();
            }}
          />
        )}
        {insertAt && (
          <TemplateInsert
            doc={doc}
            onClose={() => setInsertAt(null)}
            onPick={(lines) => {
              const document = page.store.state.session?.document;
              if (!document || !insertAt) return;
              const nodes = nodesFromSource(
                document,
                insertAt.block,
                serializeDoc(lines),
              );
              page.edit({ kind: "splice-leaf", path: insertAt.path, nodes });
            }}
          />
        )}
      </div>
    </PageContext.Provider>
  );
}

function HeadingStar({
  docId,
  blockId,
  text,
}: {
  docId: string;
  blockId: string;
  text: string;
}) {
  const { stars } = useLibraryState();
  const toast = useToast();
  const on = stars.some(
    (star) =>
      star.kind === "heading" &&
      star.target_id === docId &&
      star.block_id === blockId,
  );
  return (
    <IconButton
      label={on ? `Unstar ${text}` : `Star ${text}`}
      aria-pressed={on}
      onClick={() =>
        void client.setFavourite("heading", docId, !on, blockId).then(
          () => void loadLibrary(),
          (failure) =>
            toast({
              text: messageOf(failure, "Couldn't change favorites."),
              error: true,
            }),
        )
      }
    >
      <Star fill={on ? "currentColor" : "none"} />
    </IconButton>
  );
}

function TitleField({
  value,
  locked,
  onChange,
  onEnter,
}: {
  value: string;
  locked: boolean;
  onChange: (title: string) => void;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const observer = new ResizeObserver(() => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      dir="auto"
      className="page-title page-title-input"
      aria-label="Page title"
      placeholder="Untitled"
      maxLength={200}
      value={value}
      readOnly={locked}
      onChange={(event) =>
        onChange(event.currentTarget.value.replace(/\n/g, " "))
      }
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

function OriginalLine({ doc }: { doc: Doc }) {
  const toast = useToast();
  const original = doc.original;
  if (!original) return null;
  return (
    <button
      type="button"
      className="small doc-textlink"
      onClick={() =>
        void client.downloadOriginal(doc.id).then(
          ({ blob, name }) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = name;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          },
          (failure) =>
            toast({
              text: messageOf(failure, "Couldn't download the original."),
              error: true,
            }),
        )
      }
    >
      Original: {original.file_name}
    </button>
  );
}

/** Nothing is overwritten. The draft stays until a person chooses. */
function ConflictBanner({
  page,
  doc,
}: {
  page: ReturnType<typeof usePage>;
  doc: Doc;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const keepCopy = async () => {
    const session = page.store.state.session;
    if (!session) return;
    setBusy(true);
    try {
      const body = serializeDoc(
        session.document.format === 2
          ? docContainerBlocks(session.document.nodes, { projected: true })
          : session.document.blocks,
      );
      const made = await client.createDoc({
        title: `${session.title || "Untitled"} (my copy)`,
        team_id: doc.team_id,
        content: [{ type: "paragraph", text: body }],
      });
      await page.discard();
      void loadLibrary();
      toast({
        text: "Your draft is saved as a new page.",
        action: { label: "Open", run: () => navigate(`/app/doc/${made.id}`) },
      });
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't save your copy."),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-banner is-warn small" role="alert">
      <span>This page changed elsewhere. Your draft is still here.</span>
      <Button variant="ghost" busy={busy} onClick={() => void keepCopy()}>
        Save my draft as a new page
      </Button>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => void page.store.refresh()}
      >
        Try merging again
      </Button>
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() =>
          void confirm({
            title: "Discard this draft?",
            body: "Your unsaved changes are removed and the latest page opens.",
            action: "Discard",
            danger: true,
          }).then((ok) => ok && void page.discard())
        }
      >
        Discard my draft
      </Button>
    </div>
  );
}
