/** The page Download action owns export. An explicit embedded TeX source must
 * never silently fall back to a different document when its owner is unavailable. */
export async function routeDocumentDownload(
  format: string,
  embeddedLatex: boolean,
  sourcePdf: { current: (() => Promise<void>) | null },
  ready: () => boolean,
  canonical: () => Promise<void>,
): Promise<void> {
  if (!ready())
    throw new Error("Save or restore the current draft before downloading.");
  if (format === "pdf" && embeddedLatex) {
    if (!sourcePdf.current)
      throw new Error(
        "The selected LaTeX source is unavailable. Reopen it before downloading.",
      );
    await sourcePdf.current();
    return;
  }
  await canonical();
}
