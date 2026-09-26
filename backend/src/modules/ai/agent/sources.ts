import type { AssistantSource } from "@orbyn/core";

/** Keep only references the assistant actually read and can show. */
export function finalizeSources(summary: string, read: AssistantSource[]) {
  const lower = summary.toLocaleLowerCase();
  const citedNumbers = new Set(
    [...summary.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])),
  );
  const sources = read
    .map((source) => ({
      ...source,
      used:
        source.number != null && citedNumbers.size > 0
          ? citedNumbers.has(source.number)
          : source.title.length >= 4 &&
            lower.includes(source.title.toLocaleLowerCase()),
    }))
    .sort((a, b) => Number(b.used) - Number(a.used))
    .slice(0, 8);
  const shownNumbers = new Set(sources.map((source) => source.number));
  return {
    summary: summary.replace(/\[(\d+)\]/g, (marker, raw: string) =>
      shownNumbers.has(Number(raw)) ? marker : "",
    ),
    sources,
  };
}
