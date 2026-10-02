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
  return text;
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
  return `text.journey-section, text.journey-section tspan { fill: ${vars.textColor} !important; } .mindmap-node rect, .mindmap-node circle, .mindmap-node polygon, .mindmap-node path { stroke: ${vars.primaryBorderColor}; stroke-width: 1.5px; }`;
}
