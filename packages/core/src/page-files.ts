/**
 * Pictures and files in pages (EDT-01).
 *
 * A picture or file is kept in Orbyn's own file store (never a third-party
 * object store), encrypted, for as long as the page it is on. The page holds
 * only a line pointing at it (`![caption](orbyn://file/<id>)`), so a page
 * stays plain Markdown. Uploading asks the API for a one-time link and sends
 * the bytes there; reading asks for a short-lived link to show or download
 * it. Each person has a quota of space.
 */
import { z } from "zod";

/** Pictures the page draws; anything else is a file card. */
export const PAGE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/** Files a page can hold, by type, with the words a card shows. */
export const PAGE_FILE_TYPES: Record<string, string> = {
  "image/png": "PNG picture",
  "image/jpeg": "JPEG picture",
  "image/gif": "GIF picture",
  "image/webp": "WebP picture",
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "Word document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "Excel sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PowerPoint slides",
  "text/plain": "Text",
  "text/csv": "CSV",
  "text/markdown": "Markdown",
};

const BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
};

/** The type a file is kept as, from its name (and the type it says it is). */
export function pageFileType(name: string, mime?: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  if (ext && BY_EXTENSION[ext]) return BY_EXTENSION[ext];
  const given = (mime ?? "").split(";")[0].trim().toLowerCase();
  return PAGE_FILE_TYPES[given] ? given : null;
}

/** Whether a type is drawn as a picture. */
export const isPageImage = (mime: string): boolean =>
  (PAGE_IMAGE_TYPES as readonly string[]).includes(mime);

/**
 * Whether a file's first bytes are what its type says: the magic numbers of
 * pictures, PDFs and Office files (zips), and no NUL byte in text. A file
 * that isn't what its name says is refused rather than stored.
 */
export function sniffPageFile(head: Uint8Array, mime: string): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  switch (mime) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        head[8] === 0x57 &&
        head[9] === 0x45 &&
        head[10] === 0x42 &&
        head[11] === 0x50
      );
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return starts(0x50, 0x4b, 0x03, 0x04);
    case "text/plain":
    case "text/csv":
    case "text/markdown":
      return !head.slice(0, 4096).includes(0);
    default:
      return false;
  }
}

/** A picture or file kept for a page. */
export type PageFile = {
  id: string;
  doc_id: string | null;
  name: string;
  mime: string;
  kind: "image" | "file";
  bytes: number;
  width: number | null;
  height: number | null;
  status: "waiting" | "ready" | "failed";
  /** An upload, or the original of an imported file. */
  source: "upload" | "import";
  created_at: string;
};

/** POST /docs/:id/files: a picture or file about to be uploaded. */
export const pageFileInput = z
  .object({
    name: z.string().trim().min(1).max(300),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(200 * 1024 * 1024),
    mime: z.string().max(200).optional(),
    width: z.number().int().min(1).max(100000).optional(),
    height: z.number().int().min(1).max(100000).optional(),
  })
  .strict();
export type PageFileInput = z.infer<typeof pageFileInput>;

/** Where to send the bytes: a path on the API's base URL, used once. */
export type PageFileUpload = {
  file: PageFile;
  upload_path: string;
  expires_at: string;
};

/** A short-lived link to show or download a file (GET /docs/files/:id). */
export type PageFileLink = {
  file: PageFile;
  /** A path on the API's base URL. */
  url_path: string;
  expires_at: string;
};

/** How much of your space pictures and files in pages take. */
export type PageFilesUsage = { used_bytes: number; quota_bytes: number };

/** "2.4 MB", for a file card or the space left. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / 1024 / 1024;
  return mb < 10
    ? `${mb.toFixed(1)} MB`
    : mb < 1024
      ? `${Math.round(mb)} MB`
      : `${(mb / 1024).toFixed(1)} GB`;
}

/** The longest side a picture is sent at: bigger photos are scaled first. */
export const IMAGE_MAX_SIDE = 2400;

/** How long a link to show a file lasts. */
export const FILE_LINK_MINUTES = 60;
