/**
 * "Keep the original": an optional setting that keeps a file imported into
 * Docs after it becomes a page, in Orbyn's own file service, encrypted. Off
 * by default; each person has a quota. An original lives as long as its
 * page (after Trash it goes too), comes with the full export, and can be
 * deleted on its own at any time.
 */

/** A kept original, as its page and Settings show it. */
export type KeptOriginal = {
  id: string;
  doc_id: string | null;
  file_name: string;
  file_type: string;
  bytes: number;
  created_at: string;
};

/** `GET /me/originals`: the setting, what's used of the quota, and the files. */
export type OriginalsOverview = {
  /** New imports keep their original unless the person says otherwise. */
  keep: boolean;
  used_bytes: number;
  quota_bytes: number;
  files: (KeptOriginal & { title: string | null })[];
};

/** "12.4 MB", "820 KB": a size in plain words. */
export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
