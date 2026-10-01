/**
 * A Content-Disposition header value that any HTTP layer will accept. A name
 * may hold any characters a person typed — emoji, accents, non-Latin scripts —
 * but a header value may not: it is limited to ISO-8859-1, and Node throws
 * rather than send anything wider. So the name goes twice: once flattened to
 * ASCII for old or unusual clients, and once percent-encoded the way RFC 5987
 * `filename*` prescribes, which browsers decode back to the real name.
 */
export function contentDisposition(
  kind: "inline" | "attachment",
  name: string,
): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
