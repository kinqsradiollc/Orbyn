import type { ReactNode } from "react";

/** Web addresses in plain text. */
const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** "example.com" from a link, or nothing when it isn't a valid URL. */
export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

/**
 * Plain text with its web addresses as links that open in a new tab (and
 * never hand this page to the site they open).
 */
export function Linkify({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    // Punctuation right after a link usually ends the sentence, not the link.
    const url = match[0].replace(/[.,;:!?)\]]+$/, "");
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a key={start} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    last = start + url.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
