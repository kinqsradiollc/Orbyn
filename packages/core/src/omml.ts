import { toLatex } from "./pdftext.js";

/**
 * Word's equations (OMML, the `m:` elements in a .docx) as LaTeX. Word keeps
 * an equation's structure — a fraction is a numerator and a denominator, a
 * sum has its limits — so, unlike a PDF, this conversion is exact.
 */

export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

const decode = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&");

/** A small XML reader: elements, attributes and text. Enough for OMML. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const tag =
    /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|([^<]+)/g;
  for (const m of xml.matchAll(tag)) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      top.text += decode(m[5]);
      continue;
    }
    if (!m[2]) continue;
    if (m[1]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g))
      attrs[a[1]] = decode(a[2]);
    const node: XmlNode = { name: m[2], attrs, children: [], text: "" };
    top.children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

const child = (n: XmlNode | undefined, name: string) =>
  n?.children.find((c) => c.name === name);
const children = (n: XmlNode | undefined, name: string) =>
  n?.children.filter((c) => c.name === name) ?? [];
const val = (n: XmlNode | undefined) => n?.attrs["m:val"] ?? n?.attrs["w:val"];

const ACCENTS: Record<string, string> = {
  "̂": "\\hat",
  "^": "\\hat",
  "̄": "\\bar",
  "¯": "\\bar",
  "̇": "\\dot",
  "̈": "\\ddot",
  "⃗": "\\vec",
  "→": "\\vec",
  "̃": "\\tilde",
  "~": "\\tilde",
  "̌": "\\check",
  "̆": "\\breve",
};

const NARY: Record<string, string> = {
  "∑": "\\sum",
  "∏": "\\prod",
  "∐": "\\coprod",
  "∫": "\\int",
  "∬": "\\iint",
  "∭": "\\iiint",
  "∮": "\\oint",
  "⋃": "\\bigcup",
  "⋂": "\\bigcap",
  "⋁": "\\bigvee",
  "⋀": "\\bigwedge",
};

const FUNCTIONS =
  /^(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|arcsin|arccos|arctan|log|ln|exp|lim|max|min|sup|inf|det|dim|ker|deg|gcd|arg|Pr)$/;

const delim = (ch: string | undefined, side: "l" | "r") => {
  if (ch === undefined) return side === "l" ? "(" : ")";
  if (ch === "") return ".";
  if (ch === "{" || ch === "}") return "\\" + ch;
  if (ch === "|") return "|";
  if (ch === "‖") return "\\|";
  if (ch === "⟨" || ch === "〈") return "\\langle";
  if (ch === "⟩" || ch === "〉") return "\\rangle";
  if (ch === "⌊") return "\\lfloor";
  if (ch === "⌋") return "\\rfloor";
  if (ch === "⌈") return "\\lceil";
  if (ch === "⌉") return "\\rceil";
  return ch;
};

const group = (tex: string) => (tex.length === 1 ? tex : `{${tex}}`);

/** One OMML element (and what's inside it) as LaTeX. */
export function ommlToLatex(n: XmlNode | undefined): string {
  if (!n) return "";
  const inner = (name: string) => ommlToLatex(child(n, name));
  const all = () => n.children.map(ommlToLatex).join("");
  switch (n.name) {
    case "m:r": {
      const text = children(n, "m:t")
        .map((t) => t.text)
        .join("");
      const plain = child(child(n, "m:rPr"), "m:sty");
      if (FUNCTIONS.test(text.trim())) return `\\${text.trim()} `;
      const tex = toLatex(text);
      return val(plain) === "p" && /^[A-Za-z]{2,}$/.test(text)
        ? `\\mathrm{${text}}`
        : tex;
    }
    case "m:t":
      return toLatex(n.text);
    case "m:f": {
      const type = val(child(child(n, "m:fPr"), "m:type"));
      const num = inner("m:num");
      const den = inner("m:den");
      if (type === "lin") return `${group(num)}/${group(den)}`;
      if (type === "noBar") return `\\binom{${num}}{${den}}`;
      return `\\frac{${num}}{${den}}`;
    }
    case "m:sSup":
      return `${group(inner("m:e"))}^{${inner("m:sup")}}`;
    case "m:sSub":
      return `${group(inner("m:e"))}_{${inner("m:sub")}}`;
    case "m:sSubSup":
      return `${group(inner("m:e"))}_{${inner("m:sub")}}^{${inner("m:sup")}}`;
    case "m:sPre":
      return `{}_{${inner("m:sub")}}^{${inner("m:sup")}}${inner("m:e")}`;
    case "m:rad": {
      const hide = val(child(child(n, "m:radPr"), "m:degHide"));
      const deg = inner("m:deg");
      return hide === "1" || hide === "on" || !deg
        ? `\\sqrt{${inner("m:e")}}`
        : `\\sqrt[${deg}]{${inner("m:e")}}`;
    }
    case "m:nary": {
      const pr = child(n, "m:naryPr");
      const chr = val(child(pr, "m:chr")) ?? "∫";
      const op = NARY[chr] ?? toLatex(chr);
      const sub = inner("m:sub");
      const sup = inner("m:sup");
      return `${op}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""} ${inner("m:e")}`;
    }
    case "m:d": {
      const pr = child(n, "m:dPr");
      const beg = child(pr, "m:begChr")
        ? val(child(pr, "m:begChr"))
        : undefined;
      const end = child(pr, "m:endChr")
        ? val(child(pr, "m:endChr"))
        : undefined;
      const sep = val(child(pr, "m:sepChr")) ?? ",";
      const parts = children(n, "m:e").map(ommlToLatex);
      return `\\left${delim(beg, "l")} ${parts.join(sep === "|" ? " \\mid " : sep)} \\right${delim(end, "r")}`;
    }
    case "m:acc": {
      const chr = val(child(child(n, "m:accPr"), "m:chr")) ?? "̂";
      return `${ACCENTS[chr] ?? "\\hat"}{${inner("m:e")}}`;
    }
    case "m:bar": {
      const pos = val(child(child(n, "m:barPr"), "m:pos"));
      return `${pos === "top" ? "\\overline" : "\\underline"}{${inner("m:e")}}`;
    }
    case "m:groupChr": {
      const pr = child(n, "m:groupChrPr");
      const pos = val(child(pr, "m:pos"));
      return `${pos === "top" ? "\\overbrace" : "\\underbrace"}{${inner("m:e")}}`;
    }
    case "m:func":
      return `${inner("m:fName").trim()} ${inner("m:e")}`;
    case "m:limLow": {
      const e = inner("m:e").trim();
      return /^\\(lim|max|min|sup|inf)\s*$/.test(e)
        ? `${e}_{${inner("m:lim")}}`
        : `\\underset{${inner("m:lim")}}{${e}}`;
    }
    case "m:limUpp":
      return `\\overset{${inner("m:lim")}}{${inner("m:e")}}`;
    case "m:m": {
      const rows = children(n, "m:mr").map((r) =>
        children(r, "m:e").map(ommlToLatex).join(" & "),
      );
      return `\\begin{matrix} ${rows.join(" \\\\ ")} \\end{matrix}`;
    }
    case "m:eqArr":
      return `\\begin{aligned} ${children(n, "m:e")
        .map(ommlToLatex)
        .join(" \\\\ ")} \\end{aligned}`;
    case "m:box":
    case "m:borderBox":
    case "m:phant":
      return inner("m:e");
    // Properties and control data carry no content.
    case "m:rPr":
    case "m:ctrlPr":
    case "w:rPr":
    case "m:fPr":
    case "m:naryPr":
    case "m:dPr":
    case "m:radPr":
    case "m:accPr":
    case "m:barPr":
    case "m:funcPr":
    case "m:sSupPr":
    case "m:sSubPr":
    case "m:sSubSupPr":
    case "m:mPr":
    case "m:eqArrPr":
    case "m:limLowPr":
    case "m:limUppPr":
    case "m:groupChrPr":
    case "m:oMathParaPr":
      return "";
    default:
      return all();
  }
}

/** An `<m:oMath>` (or `<m:oMathPara>`) fragment as tidy LaTeX. */
export function ommlXmlToLatex(xml: string): string {
  return ommlToLatex(parseXml(xml))
    .replace(/\s+/g, " ")
    .replace(/\{ /g, "{")
    .replace(/ \}/g, "}")
    .trim();
}
