import { z } from "zod";
import { linkMarkdown } from "./links.js";

/**
 * Bringing another app's export into Orbyn (DATA-08): Markdown files (a
 * folder of notes, zipped, with [[links]]), a Notion export, and tasks from
 * Todoist and TickTick. Every import shows a dry run first — what would come
 * in, and what would be left out — and only then writes.
 *
 * Everything here is pure: reading the files and deciding what they become.
 * Unzipping and writing happen on the server.
 */

// ------------------------------------------------------------------- CSV

/** A small RFC 4180 CSV reader: quotes, commas and newlines in fields. */
export function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV rows keyed by their header, lower-cased; empty rows dropped. */
export function csvRecords(
  table: string[][],
  headerAt = 0,
): Record<string, string>[] {
  const header = table[headerAt];
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return table
    .slice(headerAt + 1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) =>
      Object.fromEntries(keys.map((k, n) => [k, (r[n] ?? "").trim()])),
    );
}

// ----------------------------------------------------------------- tasks

/** A task as another app's export describes it. */
export type ImportedTask = {
  title: string;
  notes: string;
  status: "todo" | "done";
  priority: "low" | "medium" | "high";
  /** ISO time, or null. */
  due_at: string | null;
  /** The list it goes in (a Todoist section, a TickTick list). */
  list: string | null;
  tags: string[];
};

/** A date another app wrote, as an ISO time; a bare day is 9:00 local. */
export function importDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const d = day ? new Date(`${t}T09:00:00`) : new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const pick = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (r[k]) return r[k];
  return "";
};

/**
 * Todoist's CSV export: TYPE task/section/note, CONTENT, DESCRIPTION,
 * PRIORITY (1 is the most urgent), DATE. A section names the list the tasks
 * after it go in; a note joins the task before it; an indented task keeps
 * its place as its own task.
 */
export function todoistTasks(text: string): ImportedTask[] {
  const rows = csvRecords(parseCsvTable(text));
  const out: ImportedTask[] = [];
  let section: string | null = null;
  for (const r of rows) {
    const type = pick(r, "type").toLowerCase();
    const content = pick(r, "content", "title", "name");
    if (type === "section") {
      section = content.slice(0, 80) || null;
      continue;
    }
    if (type === "note") {
      const last = out[out.length - 1];
      if (last && content)
        last.notes = [last.notes, content].filter(Boolean).join("\n\n");
      continue;
    }
    if (type && type !== "task") continue;
    if (!content) continue;
    // Labels are written into the task as @label.
    const tags = [...content.matchAll(/(?:^|\s)@([\p{L}\p{N}_-]+)/gu)].map(
      (m) => m[1],
    );
    const title = content
      .replace(/(?:^|\s)@[\p{L}\p{N}_-]+/gu, "")
      .trim()
      .slice(0, 200);
    const p = Number(pick(r, "priority"));
    out.push({
      title: title || content.slice(0, 200),
      notes: pick(r, "description"),
      status: "todo",
      priority:
        p === 1 ? "high" : p === 2 ? "high" : p === 4 ? "low" : "medium",
      due_at: importDate(pick(r, "date", "due date", "deadline")),
      list: section,
      tags,
    });
  }
  return out;
}

/**
 * TickTick's CSV backup: a few lines about the backup, then a table with
 * "List Name", "Title", "Content", "Tags", "Due Date", "Priority" (0 none,
 * 1 low, 3 medium, 5 high) and "Status" (0 open, 1 or 2 done).
 */
export function tickTickTasks(text: string): ImportedTask[] {
  const table = parseCsvTable(text);
  const headerAt = table.findIndex((r) =>
    r.some((c) => c.trim().toLowerCase() === "title"),
  );
  if (headerAt < 0) return [];
  const rows = csvRecords(table, headerAt);
  const out: ImportedTask[] = [];
  for (const r of rows) {
    const title = pick(r, "title");
    if (!title) continue;
    const p = Number(pick(r, "priority"));
    const status = pick(r, "status");
    out.push({
      title: title.slice(0, 200),
      notes: pick(r, "content"),
      status: status === "1" || status === "2" ? "done" : "todo",
      priority: p >= 5 ? "high" : p === 1 ? "low" : "medium",
      due_at: importDate(pick(r, "due date", "start date")),
      list: pick(r, "list name") || null,
      tags: pick(r, "tags")
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }
  return out;
}

// ----------------------------------------------------------------- pages

/** A task file's format, as the import's Format choice names it. */
export type TaskImportFormat = "orbyn" | "csv" | "todoist" | "ticktick";

/** Which app a CSV came from, by its header (DATA-08). */
export function csvFormat(text: string): TaskImportFormat {
  const head = text.slice(0, 2000).toLowerCase();
  if (/^\ufeff?"?type"?,"?content"?/.test(head)) return "todoist";
  if (head.includes('"list name"') || head.includes("list name,"))
    return "ticktick";
  return "csv";
}

export const PAGE_IMPORT_FORMATS = ["markdown", "notion"] as const;
export type PageImportFormat = (typeof PAGE_IMPORT_FORMATS)[number];

/** A file from the export: its path inside the zip, and its words. */
export type ImportFile = { path: string; text: string };

export type PlannedPage = {
  /** Its path in the export, to find links to it. */
  path: string;
  title: string;
  /** The folder it goes in (one level: the export's top folders). */
  folder: string;
  /** Its Markdown, links still as the export wrote them. */
  markdown: string;
};

export type PlannedProject = { name: string; tasks: ImportedTask[] };

export type PagesImportPlan = {
  folders: string[];
  pages: PlannedPage[];
  /** Notion databases: each becomes a project, its rows tasks. */
  projects: PlannedProject[];
  /** What was left out, in words ("3 pictures"). */
  left_out: string[];
};

export const PAGE_IMPORT_LIMITS = {
  /** The zip or file as sent, in bytes. */
  maxBytes: 20 * 1024 * 1024,
  maxFiles: 2000,
  /** Pages made by one import. */
  maxPages: 1000,
  /** One page's Markdown. */
  maxPageChars: 500_000,
} as const;

export const pageImportInput = z
  .object({
    format: z.enum(PAGE_IMPORT_FORMATS),
    /** The file's name: .zip, or one .md / .markdown / .txt file. */
    file_name: z.string().trim().min(1).max(200),
    /** The file, base64. */
    data: z
      .string()
      .min(1)
      .max(Math.ceil((PAGE_IMPORT_LIMITS.maxBytes * 4) / 3) + 8),
    /** The team it goes in; your own pages when left out. */
    team_id: z.uuid().nullable().optional(),
    /** Count what would come in, without writing anything. */
    dry_run: z.boolean().default(true),
  })
  .strict();
export type PageImportInput = z.input<typeof pageImportInput>;

export type PagesImportSummary = {
  pages: number;
  folders: number;
  projects: number;
  tasks: number;
  /** Links between the imported pages that now work in Orbyn. */
  links: number;
  sample: string[];
  left_out: string[];
  errors: string[];
  /** After a real import: the first folder made, to open. */
  folder_id?: string | null;
};

/** Notion adds " <32 hex>" to every file and folder name. */
const NOTION_ID = /\s+[0-9a-f]{32}$/i;

const baseName = (path: string) => path.split("/").pop() ?? path;
const stripExt = (name: string) =>
  name.replace(/\.(md|markdown|txt|csv)$/i, "");

export const cleanImportName = (name: string) =>
  stripExt(name).replace(NOTION_ID, "").trim();

/** Remove a leading "--- … ---" block (front matter). */
const withoutFrontMatter = (text: string) =>
  text.replace(/^﻿?---\n[\s\S]*?\n---\n?/, "");

/** A page's title: its first "# " line when it opens with one, else its name. */
function titleAndBody(path: string, text: string) {
  const body = withoutFrontMatter(text.replace(/\r\n?/g, "\n"));
  const m = /^\s*#\s+(.+)\n?/.exec(body);
  if (m)
    return {
      title: m[1].trim().slice(0, 200),
      markdown: body.slice(m[0].length).replace(/^\n+/, ""),
    };
  return {
    title: cleanImportName(baseName(path)).slice(0, 200),
    markdown: body,
  };
}

/**
 * The shape an export will take in Orbyn: pages in one level of folders
 * (the export's top folders; anything at the top goes in one named after
 * the file), Notion databases as projects with their rows as tasks.
 */
export function planPagesImport(
  files: ImportFile[],
  format: PageImportFormat,
  rootName: string,
): PagesImportPlan {
  const left: Record<string, number> = {};
  const leave = (what: string) => (left[what] = (left[what] ?? 0) + 1);
  const skip = (p: string) =>
    p.startsWith("__MACOSX/") || baseName(p).startsWith(".");
  let usable = files.filter((f) => !skip(f.path));
  // A zip of one folder: that folder is the export, not a folder in it.
  const tops = new Set(
    usable.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "")),
  );
  let prefix = "";
  if (tops.size === 1 && !tops.has("")) prefix = `${[...tops][0]}/`;
  usable = usable.map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
  const root = cleanImportName(rootName.replace(/\.zip$/i, "")) || "Imported";

  const projects: PlannedProject[] = [];
  const rowPages = new Map<string, ImportedTask>();
  if (format === "notion") {
    for (const f of usable.filter((x) => /\.csv$/i.test(x.path))) {
      // Notion writes "<db>.csv" and "<db>_all.csv"; one is enough.
      if (/_all\.csv$/i.test(f.path)) continue;
      const name = cleanImportName(baseName(f.path)) || "Database";
      const rows = csvRecords(parseCsvTable(f.text));
      const tasks: ImportedTask[] = [];
      for (const r of rows) {
        const keys = Object.keys(r);
        const title = (r.name || r.title || r.task || r[keys[0]] || "").slice(
          0,
          200,
        );
        if (!title) continue;
        const status = (r.status || r.done || r.complete || "").toLowerCase();
        const task: ImportedTask = {
          title,
          notes: "",
          status: /^(done|complete|completed|yes|true)$/.test(status)
            ? "done"
            : "todo",
          priority: /high|urgent/i.test(r.priority ?? "")
            ? "high"
            : /low/i.test(r.priority ?? "")
              ? "low"
              : "medium",
          due_at: importDate(
            (r.due || r["due date"] || r.deadline || r.date || "").replace(
              /\s*→.*$/,
              "",
            ),
          ),
          list: null,
          tags: (r.tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        };
        tasks.push(task);
        // The row's own page sits in a folder named after the database.
        const dir = f.path.replace(/\.csv$/i, "");
        rowPages.set(`${dir}/${title}`.toLowerCase(), task);
      }
      if (tasks.length) projects.push({ name: name.slice(0, 120), tasks });
    }
  }

  const pages: PlannedPage[] = [];
  const folders = new Set<string>();
  for (const f of usable) {
    if (/\.(md|markdown|txt)$/i.test(f.path)) {
      const { title, markdown } = titleAndBody(f.path, f.text);
      // A Notion database row: its words become its task's notes.
      const dir = f.path.includes("/")
        ? f.path.slice(0, f.path.lastIndexOf("/"))
        : "";
      const row = rowPages.get(`${dir}/${title}`.toLowerCase());
      if (row) {
        row.notes = markdown
          .replace(/^(?:[A-Z][\w ]*: .*\n)+/, "")
          .trim()
          .slice(0, 20_000);
        continue;
      }
      if (pages.length >= PAGE_IMPORT_LIMITS.maxPages) {
        leave("pages past the limit");
        continue;
      }
      const top = f.path.includes("/") ? f.path.split("/")[0] : "";
      const folder = (top ? cleanImportName(top) : root).slice(0, 120) || root;
      folders.add(folder);
      const pictures = (
        markdown.match(/!\[[^\]]*\]\((?!https?:)[^)]*\)/g) ?? []
      ).length;
      for (let n = 0; n < pictures; n++) leave("pictures");
      pages.push({
        path: f.path,
        title: title || "Untitled",
        folder,
        markdown: markdown.slice(0, PAGE_IMPORT_LIMITS.maxPageChars),
      });
    } else if (/\.csv$/i.test(f.path) && format === "notion") continue;
    else if (!f.path.endsWith("/")) leave("other files");
  }
  const words = (what: string, n: number) =>
    what === "pictures"
      ? `${n} picture${n === 1 ? "" : "s"} (add them to the pages after)`
      : what === "other files"
        ? `${n} other file${n === 1 ? "" : "s"}`
        : `${n} ${what}`;
  return {
    folders: [...folders],
    pages,
    projects,
    left_out: Object.entries(left).map(([what, n]) => words(what, n)),
  };
}

/** Normalise a path with ./ and ../ in it. */
function resolvePath(from: string, target: string) {
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/**
 * A page's links made into Orbyn links, now the pages have ids: [[Name]]
 * (and [[Name|shown]], [[Name#Heading]]) by title, and a Markdown link to
 * another file in the export by its path. A link to something that did not
 * come in keeps its words. Returns the Markdown and how many links now work.
 */
export function linkImportedPage(
  page: PlannedPage,
  byPath: Map<string, string>,
  byTitle: Map<string, string>,
): { markdown: string; links: number } {
  let links = 0;
  let text = page.markdown.replace(
    /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g,
    (_m, name: string, shown?: string) => {
      const id = byTitle.get(cleanImportName(name.trim()).toLowerCase());
      const words = (shown ?? name).trim();
      if (!id) return words;
      links++;
      return linkMarkdown({ kind: "doc", id }, words);
    },
  );
  text = text.replace(
    /(!?)\[([^\]\n]*)\]\(([^)\s]+\.(?:md|markdown|txt))(?:#[^)]*)?\)/gi,
    (m, bang: string, words: string, href: string) => {
      if (bang || /^[a-z]+:/i.test(href)) return m;
      let target: string;
      try {
        target = decodeURIComponent(href);
      } catch {
        target = href;
      }
      const id = byPath.get(resolvePath(page.path, target).toLowerCase());
      if (!id) return words;
      links++;
      return linkMarkdown({ kind: "doc", id }, words || "page");
    },
  );
  // Pictures that stayed behind are left as their captions.
  text = text.replace(
    /!\[([^\]]*)\]\((?!https?:)[^)]*\)/g,
    (_m, alt: string) => (alt ? `(${alt})` : ""),
  );
  return { markdown: text, links };
}
