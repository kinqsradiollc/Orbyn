import { mathToText } from "./docs.js";

/**
 * Maths typeset on phones (EDT-12).
 *
 * The web draws LaTeX with KaTeX, which writes HTML and CSS. A phone app has
 * neither, and a web view per equation would be slow and would not work
 * offline, so the phone lays equations out itself from this tree: fractions
 * stacked over a rule, scripts raised and lowered, roots with their bar,
 * big operators with limits above and below, matrices in a grid.
 *
 * This is the pure part: LaTeX in, a layout tree out. It covers what notes
 * and imported slides use (the subset `pdftext` and `omml` write, and the
 * common commands people type); anything it cannot read comes back as the
 * plain-text reading every other screen uses, never as an error.
 */

export type MathFont = "italic" | "roman" | "bold" | "blackboard" | "script";

export type MathNode =
  /** One symbol or word. `op` symbols (+, =, →) get space either side. */
  | { k: "sym"; s: string; font: MathFont; op?: boolean }
  | { k: "row"; items: MathNode[] }
  | { k: "frac"; num: MathNode; den: MathNode; line: boolean }
  /** Scripts on a base. `limits`: above and below it (∑, lim), not beside. */
  | {
      k: "scripts";
      base: MathNode;
      sup: MathNode | null;
      sub: MathNode | null;
      limits: boolean;
    }
  | { k: "sqrt"; body: MathNode; index: MathNode | null }
  | { k: "accent"; body: MathNode; mark: MathAccent }
  | { k: "fence"; open: string; close: string; body: MathNode }
  | {
      k: "table";
      rows: MathNode[][];
      open: string;
      close: string;
      /** Cases and aligned lines read left to right; matrices centre. */
      align: "center" | "left";
    }
  | { k: "space"; em: number }
  /** A big operator: ∑, ∏, ∫. */
  | { k: "big"; s: string };

export type MathAccent =
  "bar" | "hat" | "vec" | "dot" | "ddot" | "tilde" | "under";

const GREEK: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
};

/** Symbols that sit between things, with space either side. */
const OPERATORS: Record<string, string> = {
  times: "×",
  cdot: "⋅",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  propto: "∝",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  leftrightarrow: "↔",
  iff: "⟺",
  implies: "⟹",
  mapsto: "↦",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  wedge: "∧",
  land: "∧",
  vee: "∨",
  lor: "∨",
  oplus: "⊕",
  otimes: "⊗",
  circ: "∘",
  ll: "≪",
  gg: "≫",
  perp: "⊥",
  parallel: "∥",
  mid: "∣",
  gets: "←",
};

/** Symbols that stand alone. */
const SYMBOLS: Record<string, string> = {
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  forall: "∀",
  exists: "∃",
  nexists: "∄",
  emptyset: "∅",
  varnothing: "∅",
  neg: "¬",
  lnot: "¬",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  angle: "∠",
  triangle: "△",
  degree: "°",
  prime: "′",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  lvert: "|",
  rvert: "|",
  vert: "|",
  Vert: "‖",
  "|": "‖",
  "{": "{",
  "}": "}",
  "%": "%",
  "&": "&",
  "#": "#",
  $: "$",
  _: "_",
  therefore: "∴",
  because: "∵",
  star: "⋆",
  ast: "∗",
  bullet: "∙",
  checkmark: "✓",
};

/** Big operators: limits go above and below. */
const BIG: Record<string, string> = {
  sum: "∑",
  prod: "∏",
  coprod: "∐",
  int: "∫",
  iint: "∬",
  iiint: "∭",
  oint: "∮",
  bigcup: "⋃",
  bigcap: "⋂",
  bigoplus: "⨁",
};

/** Named functions, set upright. The second set take limits (lim, max). */
const FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "sec",
  "csc",
  "cot",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "log",
  "ln",
  "lg",
  "exp",
  "det",
  "dim",
  "ker",
  "deg",
  "arg",
  "gcd",
  "Pr",
  "mod",
  "bmod",
]);
const LIMIT_FUNCTIONS = new Set([
  "lim",
  "max",
  "min",
  "sup",
  "inf",
  "limsup",
  "liminf",
  "argmax",
  "argmin",
]);

const SPACES: Record<string, number> = {
  ",": 0.17,
  ":": 0.22,
  ">": 0.22,
  ";": 0.28,
  " ": 0.25,
  "!": -0.17,
  quad: 1,
  qquad: 2,
  enspace: 0.5,
  thinspace: 0.17,
};

const ACCENTS: Record<string, MathAccent> = {
  bar: "bar",
  overline: "bar",
  hat: "hat",
  widehat: "hat",
  vec: "vec",
  overrightarrow: "vec",
  dot: "dot",
  ddot: "ddot",
  tilde: "tilde",
  widetilde: "tilde",
  underline: "under",
};

const FENCES: Record<string, string> = {
  "(": "(",
  ")": ")",
  "[": "[",
  "]": "]",
  "|": "|",
  ".": "",
  "\\{": "{",
  "\\}": "}",
  "\\langle": "⟨",
  "\\rangle": "⟩",
  "\\lvert": "|",
  "\\rvert": "|",
  "\\|": "‖",
  "\\Vert": "‖",
  "\\lfloor": "⌊",
  "\\rfloor": "⌋",
  "\\lceil": "⌈",
  "\\rceil": "⌉",
  "/": "/",
};

const MATRICES: Record<string, [string, string]> = {
  matrix: ["", ""],
  smallmatrix: ["", ""],
  pmatrix: ["(", ")"],
  bmatrix: ["[", "]"],
  Bmatrix: ["{", "}"],
  vmatrix: ["|", "|"],
  Vmatrix: ["‖", "‖"],
  array: ["", ""],
};

const BLACKBOARD: Record<string, string> = {
  R: "ℝ",
  N: "ℕ",
  Z: "ℤ",
  Q: "ℚ",
  C: "ℂ",
  P: "ℙ",
  E: "𝔼",
  H: "ℍ",
};

class Unreadable extends Error {}

/** The pieces LaTeX is written in: commands, braces, scripts and characters. */
function tokenize(tex: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    if (c === "\\") {
      const rest = tex.slice(i + 1);
      const word = /^[A-Za-z]+/.exec(rest);
      if (word) {
        out.push("\\" + word[0]);
        i += 1 + word[0].length;
      } else if (rest[0] === "\\") {
        out.push("\\\\");
        i += 2;
      } else {
        out.push("\\" + (rest[0] ?? ""));
        i += 2;
      }
    } else if (/\s/.test(c)) {
      // Kept (as one space) only for \text{…}; maths itself ignores it.
      if (out[out.length - 1] !== " ") out.push(" ");
      i++;
    } else {
      out.push(c);
      i++;
    }
  }
  return out;
}

const row = (items: MathNode[]): MathNode =>
  items.length === 1 ? items[0] : { k: "row", items };

class Parser {
  i = 0;
  constructor(private t: string[]) {}

  /** Spaces between tokens mean nothing outside \text{…}. */
  private skip() {
    while (this.t[this.i] === " ") this.i++;
  }
  peek() {
    this.skip();
    return this.t[this.i];
  }
  next() {
    this.skip();
    return this.t[this.i++];
  }
  done() {
    this.skip();
    return this.i >= this.t.length;
  }

  /** A run of atoms up to one of `stops` (not taken) or the end. */
  list(stops: string[] = []): MathNode {
    const items: MathNode[] = [];
    while (!this.done() && !stops.includes(this.peek())) {
      if (this.peek() === "}") throw new Unreadable("stray }");
      const atom = this.atom();
      if (atom) items.push(this.scripts(atom));
    }
    return row(items);
  }

  /** What `^` or `_` takes: one group or one symbol. */
  argument(): MathNode {
    if (this.done()) throw new Unreadable("missing argument");
    if (this.peek() === "{") return this.group();
    const atom = this.atom();
    if (!atom) throw new Unreadable("missing argument");
    return atom;
  }

  group(): MathNode {
    if (this.next() !== "{") throw new Unreadable("expected {");
    const inner = this.list(["}"]);
    if (this.next() !== "}") throw new Unreadable("unclosed {");
    return inner;
  }

  /** The letters inside {…}, as written (for \text and \mathbb). */
  rawGroup(): string {
    if (this.next() !== "{") throw new Unreadable("expected {");
    let depth = 1;
    let text = "";
    while (this.i < this.t.length) {
      const tok = this.t[this.i++];
      if (tok === "{") depth++;
      if (tok === "}" && --depth === 0) return text;
      text +=
        tok === "\\ "
          ? " "
          : tok.startsWith("\\") && tok.length === 2
            ? tok[1]
            : tok;
      // Words kept apart in the source keep a space between them.
      if (/^\\[A-Za-z]+$/.test(tok) && this.t[this.i] !== " ") text += " ";
    }
    throw new Unreadable("unclosed {");
  }

  /** Scripts after an atom: x^2, x_i, x_i^2, ∑_{i=1}^n. */
  scripts(base: MathNode): MathNode {
    let sup: MathNode | null = null;
    let sub: MathNode | null = null;
    while (this.peek() === "^" || this.peek() === "_" || this.peek() === "'") {
      const tok = this.next();
      if (tok === "'") {
        const prime: MathNode = { k: "sym", s: "′", font: "roman" };
        sup = sup ? row([sup, prime]) : prime;
      } else if (tok === "^") sup = this.argument();
      else sub = this.argument();
    }
    if (!sup && !sub) return base;
    const limits =
      (base.k === "big" && !/[∫∬∭∮]/.test(base.s)) ||
      (base.k === "sym" &&
        base.font === "roman" &&
        LIMIT_FUNCTIONS.has(base.s));
    return { k: "scripts", base, sup, sub, limits };
  }

  fence(): string {
    const tok = this.next();
    if (tok === undefined) throw new Unreadable("missing fence");
    if (tok in FENCES) return FENCES[tok];
    throw new Unreadable("unknown fence");
  }

  environment(name: string): MathNode {
    const matrix = MATRICES[name];
    const cases = name === "cases";
    const aligned = /^(aligned|align\*?|gathered|split|eqnarray\*?)$/.test(
      name,
    );
    if (!matrix && !cases && !aligned)
      throw new Unreadable("unknown environment");
    // array's column spec ({cc}) says nothing a phone needs.
    if (name === "array" && this.peek() === "{") this.rawGroup();
    const rows: MathNode[][] = [[]];
    const end = "\\end";
    while (!this.done() && this.peek() !== end) {
      const cell = this.list(["&", "\\\\", end]);
      rows[rows.length - 1].push(cell);
      const tok = this.peek();
      if (tok === "&") this.next();
      else if (tok === "\\\\") {
        this.next();
        rows.push([]);
      }
    }
    if (this.next() !== end) throw new Unreadable("unclosed environment");
    this.rawGroup();
    const kept = rows.filter((r) =>
      r.some((c) => !(c.k === "row" && !c.items.length)),
    );
    return {
      k: "table",
      rows: kept,
      open: cases ? "{" : (matrix?.[0] ?? ""),
      close: matrix?.[1] ?? "",
      align: cases || aligned ? "left" : "center",
    };
  }

  atom(): MathNode | null {
    const tok = this.next();
    if (tok === "{") {
      this.i--;
      return this.group();
    }
    if (tok === "&" || tok === "\\\\") return { k: "space", em: 1 };
    if (tok === "^" || tok === "_") {
      // A script with nothing before it (^2 on its own) hangs on an empty base.
      this.i--;
      return this.scripts({ k: "row", items: [] });
    }
    if (!tok.startsWith("\\")) {
      if (/[A-Za-z]/.test(tok)) return { k: "sym", s: tok, font: "italic" };
      if (/[0-9.]/.test(tok)) {
        // A number reads as one piece: 3.14, not 3 . 1 4.
        let s = tok;
        while (!this.done() && /^[0-9.]$/.test(this.peek())) s += this.next();
        return { k: "sym", s, font: "roman" };
      }
      if ("+-=<>".includes(tok))
        return {
          k: "sym",
          s: tok === "-" ? "−" : tok,
          font: "roman",
          op: true,
        };
      if (tok === "~") return { k: "space", em: 0.33 };
      return { k: "sym", s: tok, font: "roman" };
    }
    const name = tok.slice(1);
    if (name in SPACES) return { k: "space", em: SPACES[name] };
    if (name in GREEK)
      return {
        k: "sym",
        s: GREEK[name],
        font: /^[A-Z]/.test(name) ? "roman" : "italic",
      };
    if (name in OPERATORS)
      return { k: "sym", s: OPERATORS[name], font: "roman", op: true };
    if (name in SYMBOLS) return { k: "sym", s: SYMBOLS[name], font: "roman" };
    if (name in BIG) return { k: "big", s: BIG[name] };
    if (FUNCTIONS.has(name) || LIMIT_FUNCTIONS.has(name))
      return { k: "sym", s: name, font: "roman" };
    if (name in ACCENTS)
      return { k: "accent", body: this.argument(), mark: ACCENTS[name] };
    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac":
      case "cfrac":
        return {
          k: "frac",
          num: this.argument(),
          den: this.argument(),
          line: true,
        };
      case "binom":
      case "dbinom":
      case "tbinom":
        return {
          k: "fence",
          open: "(",
          close: ")",
          body: {
            k: "frac",
            num: this.argument(),
            den: this.argument(),
            line: false,
          },
        };
      case "sqrt": {
        let index: MathNode | null = null;
        if (this.peek() === "[") {
          this.next();
          index = this.list(["]"]);
          if (this.next() !== "]") throw new Unreadable("unclosed [");
        }
        return { k: "sqrt", body: this.argument(), index };
      }
      case "text":
      case "textrm":
      case "textup":
      case "mbox":
      case "mathrm":
      case "operatorname":
      case "textnormal":
        return { k: "sym", s: this.rawGroup(), font: "roman" };
      case "textbf":
      case "mathbf":
      case "boldsymbol":
      case "bm":
        return { k: "sym", s: this.rawGroup().trim(), font: "bold" };
      case "textit":
      case "mathit":
        return { k: "sym", s: this.rawGroup(), font: "italic" };
      case "mathbb": {
        const letters = this.rawGroup().trim();
        return {
          k: "sym",
          s: [...letters].map((l) => BLACKBOARD[l] ?? l).join(""),
          font: "blackboard",
        };
      }
      case "mathcal":
      case "mathscr":
        return { k: "sym", s: this.rawGroup().trim(), font: "script" };
      case "left": {
        const open = this.fence();
        const body = this.list(["\\right"]);
        if (this.next() !== "\\right")
          throw new Unreadable("\\left without \\right");
        return { k: "fence", open, close: this.fence(), body };
      }
      case "right":
        throw new Unreadable("\\right without \\left");
      case "big":
      case "Big":
      case "bigg":
      case "Bigg":
      case "bigl":
      case "bigr":
      case "Bigl":
      case "Bigr":
      case "displaystyle":
      case "textstyle":
      case "limits":
      case "nolimits":
        return null;
      case "tag":
        this.rawGroup();
        return null;
      case "begin":
        return this.environment(this.rawGroup().trim());
      case "not":
        return { k: "sym", s: "̸", font: "roman" };
      default:
        throw new Unreadable(`unknown \\${name}`);
    }
  }
}

/**
 * Lay out one equation. Something it cannot read comes back as its
 * plain-text reading, so an unusual command never leaves a gap.
 */
export function layoutMath(tex: string): MathNode {
  const source = tex.trim().replace(/^\$+|\$+$/g, "");
  try {
    const p = new Parser(tokenize(source));
    const out = p.list();
    if (!p.done()) throw new Unreadable("left over");
    return out;
  } catch {
    return { k: "sym", s: mathToText(source).trim(), font: "roman" };
  }
}

/** Whether `layoutMath` could read it all (a test aid, and for "Check"). */
export function mathReadable(tex: string): boolean {
  try {
    const p = new Parser(tokenize(tex.trim().replace(/^\$+|\$+$/g, "")));
    p.list();
    return p.done();
  } catch {
    return false;
  }
}

/** What a screen reader says for an equation: its plain reading. */
export function mathSpoken(node: MathNode): string {
  switch (node.k) {
    case "sym":
      return node.op ? ` ${node.s} ` : node.s;
    case "row":
      return node.items.map(mathSpoken).join("");
    case "frac":
      return node.line
        ? `(${mathSpoken(node.num)}) over (${mathSpoken(node.den)})`
        : `${mathSpoken(node.num)} choose ${mathSpoken(node.den)}`;
    case "scripts":
      return (
        mathSpoken(node.base) +
        (node.sub ? ` sub ${mathSpoken(node.sub)}` : "") +
        (node.sup ? ` to the ${mathSpoken(node.sup)}` : "")
      );
    case "sqrt":
      return node.index
        ? `root ${mathSpoken(node.index)} of (${mathSpoken(node.body)})`
        : `square root of (${mathSpoken(node.body)})`;
    case "accent":
      return `${mathSpoken(node.body)} ${node.mark}`;
    case "fence":
      return `${node.open}${mathSpoken(node.body)}${node.close}`;
    case "table":
      return node.rows.map((r) => r.map(mathSpoken).join(", ")).join("; ");
    case "space":
      return " ";
    case "big":
      return node.s;
  }
}
