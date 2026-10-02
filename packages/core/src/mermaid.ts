/** Bounds shared by the isolated diagram renderer and its host. */
export const MERMAID_MAX_SOURCE = 65_536;
export const MERMAID_MAX_SVG = 2_097_152;

/** Keep diagram configuration owned by Orbyn; retain rejected text in the editor. */
export function prepareMermaidSource(source: string): string {
  if (source.length > MERMAID_MAX_SOURCE)
    throw new Error(
      "This diagram is too large. Split it into smaller diagrams.",
    );
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new Error("Add diagram source to draw a preview.");
  if (text.split("\n").length > 2_048)
    throw new Error(
      "This diagram has too many lines. Split it into smaller diagrams.",
    );
  if (/%%\s*\{/.test(text) || /^\s*---(?:\n|$)/.test(text))
    throw new Error(
      "Diagram configuration directives are not supported. Keep the diagram source without its configuration header.",
    );
  // Image/icon packs and CSS resources can fetch before SVG sanitization.
  // Preserve the rejected source, rather than granting diagrams network access.
  if (/@\{[^}]*\b(?:img|icon)\s*:/i.test(text) || /url\s*\(/i.test(text))
    throw new Error("External diagram resources are not supported.");
  return text;
}

/** Render bounded source through an application-owned engine; never bind diagram scripts. */
export async function renderBoundedMermaid(
  renderer: {
    render: (id: string, source: string) => Promise<{ svg: string }>;
  },
  id: string,
  source: string,
): Promise<string> {
  const prepared = prepareMermaidSource(source);
  const { svg } = await renderer.render(id, prepared);
  if (typeof svg !== "string" || svg.length > MERMAID_MAX_SVG)
    throw new Error("The rendered diagram is too large.");
  return svg;
}

/** Pin diagram families to the application's palette rather than Mermaid defaults. */
export function mermaidThemeVariables(palette: Record<string, string>) {
  const keys = [
    "background",
    "primaryColor",
    "primaryBorderColor",
    "primaryTextColor",
    "secondaryColor",
    "tertiaryColor",
    "lineColor",
    "textColor",
    "noteBkgColor",
    "noteTextColor",
  ];
  const vars: Record<string, string> = {};
  for (const key of keys) {
    const value = palette[key];
    if (
      !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value ?? "")
    )
      throw new Error("Invalid diagram theme.");
    vars[key] = value;
  }
  const series = [
    vars.primaryBorderColor,
    vars.lineColor,
    palette.highText || vars.primaryBorderColor,
    palette.mediumText || vars.lineColor,
    palette.lowText || vars.primaryBorderColor,
  ];
  for (const value of series)
    if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
      throw new Error("Invalid diagram theme.");
  vars.rowOdd = vars.secondaryColor;
  vars.rowEven = vars.primaryColor;
  vars.git0 = vars.secondaryColor;
  vars.gitBranchLabel0 = vars.textColor;
  vars.pieStrokeColor = vars.background;
  vars.pieOuterStrokeColor = vars.lineColor;
  vars.pieSectionTextColor = vars.textColor;
  for (let i = 0; i < 12; i++) {
    vars[`pie${i + 1}`] = series[i % series.length];
    vars[`cScale${i}`] = i % 2 ? vars.secondaryColor : vars.tertiaryColor;
    vars[`cScaleLabel${i}`] = vars.textColor;
    vars[`cScaleInv${i}`] = vars.primaryBorderColor;
  }
  return vars;
}

/** Keep chronological axis labels legible at their measured display width. */
export function visibleDiagramTicks(
  bounds: readonly { left: number; right: number }[],
): number[] {
  const valid = bounds
    .map((box, index) => ({ left: box.left, right: box.right, index }))
    .filter(
      (box) =>
        Number.isFinite(box.left) &&
        Number.isFinite(box.right) &&
        box.right > box.left,
    )
    .sort((a, b) => a.left - b.left);
  if (!valid.length) return [];
  const first = valid[0];
  const last = valid[valid.length - 1];
  const selected = [first.index];
  let right = first.right;
  for (const box of valid.slice(1, -1)) {
    if (box.left >= right + 8 && box.right + 8 <= last.left) {
      selected.push(box.index);
      right = box.right;
    }
  }
  if (last.index !== first.index && last.left >= right + 8)
    selected.push(last.index);
  return selected;
}

/** Family-specific fixes for Mermaid selectors that style both boxes and text. */
export function mermaidDiagramCss(palette: Record<string, string>): string {
  const vars = mermaidThemeVariables(palette);
  return `text.journey-section, text.journey-section tspan, text.task, text.task tspan { fill: ${vars.textColor} !important; } .mindmap-node rect, .mindmap-node circle, .mindmap-node polygon, .mindmap-node path { stroke: ${vars.primaryBorderColor}; stroke-width: 1.5px; } [class*="section-edge-"] { stroke: ${vars.primaryBorderColor} !important; stroke-width: 2px !important; }`;
}

/** Center a measured SVG label without assuming that its local origin is zero. */
export function diagramLabelTranslation(
  bounds: { x: number; y: number; width: number; height: number },
  center: { x: number; y: number },
): string | null {
  if (
    ![
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      center.x,
      center.y,
    ].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return null;
  return `translate(${center.x - bounds.x - bounds.width / 2}, ${center.y - bounds.y - bounds.height / 2})`;
}

/** Scale a diagram to its viewport or preserve readable natural dimensions. */
export function diagramDisplayScale(
  width: number,
  viewport: number,
  zoom: number,
  actualSize = false,
): number {
  const safeWidth = Number.isFinite(width)
    ? Math.max(120, Math.min(8192, width))
    : 320;
  const safeViewport = Number.isFinite(viewport)
    ? Math.max(120, Math.min(8192, viewport))
    : safeWidth + 24;
  const safeZoom = Number.isFinite(zoom) ? Math.max(0.5, Math.min(3, zoom)) : 1;
  return (
    (actualSize ? 1 : Math.min(1, (safeViewport - 24) / safeWidth)) * safeZoom
  );
}
