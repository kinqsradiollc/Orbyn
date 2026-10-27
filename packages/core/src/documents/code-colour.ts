/**
 * Code colouring (EDT-11): a code block's text split into tokens a page
 * colours with its own palette — keywords, strings, comments, numbers and
 * names — for the languages students and teams write most. It is a light
 * reading aid, not a parser: anything it doesn't know stays plain, and the
 * words are never changed.
 */

export type CodeTokenKind =
  "plain" | "keyword" | "string" | "comment" | "number" | "name";

export type CodeToken = { text: string; kind: CodeTokenKind };

type Grammar = {
  /** Line comments ("//", "#", "--"). */
  line: string[];
  /** Block comments, as open and close. */
  block: [string, string][];
  /** Quote characters strings start with. */
  quotes: string[];
  keywords: Set<string>;
  /** Keywords match without regard to case (SQL). */
  anyCase?: boolean;
  /** Markup: tags and attribute names are names. */
  markup?: boolean;
};

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const C_LIKE = words(`
  abstract as async await boolean break byte case catch char class const
  continue debugger default defer delete do double else enum export extends
  false final finally float fn for from func function go goto if impl
  implements import in instanceof int interface internal let long loop match
  mod module mut namespace new nil null override package private protected
  pub public readonly return self short static struct super switch this throw
  throws trait true try type typeof undefined union unsafe use using var void
  volatile where while with yield string number any unknown never bool
`);

const PYTHON = words(`
  and as assert async await break class continue def del elif else except
  False finally for from global if import in is lambda None nonlocal not or
  pass raise return True try while with yield self print len range
`);

const RUBY = words(`
  alias and begin break case class def defined do else elsif end ensure false
  for if in module next nil not or redo rescue retry return self super then
  true undef unless until when while yield puts require
`);

const SHELL = words(`
  if then else elif fi case esac for while until do done in function return
  export local echo cd exit set unset source
`);

const SQL = words(`
  select from where and or not insert into values update set delete create
  table drop alter add index primary key foreign references join left right
  inner outer full on group by order having limit offset as distinct union all
  null is in exists between like case when then else end count sum avg min max
  with returning default constraint unique check view begin commit rollback
`);

const GRAMMARS: Record<string, Grammar> = {
  c: {
    line: ["//"],
    block: [["/*", "*/"]],
    quotes: ['"', "'", "`"],
    keywords: C_LIKE,
  },
  python: {
    line: ["#"],
    block: [
      ['"""', '"""'],
      ["'''", "'''"],
    ],
    quotes: ['"', "'"],
    keywords: PYTHON,
  },
  ruby: { line: ["#"], block: [], quotes: ['"', "'"], keywords: RUBY },
  shell: { line: ["#"], block: [], quotes: ['"', "'"], keywords: SHELL },
  sql: {
    line: ["--"],
    block: [["/*", "*/"]],
    quotes: ["'", '"'],
    keywords: SQL,
    anyCase: true,
  },
  css: {
    line: [],
    block: [["/*", "*/"]],
    quotes: ['"', "'"],
    keywords: words("important media import from to"),
  },
  json: {
    line: [],
    block: [],
    quotes: ['"'],
    keywords: words("true false null"),
  },
  markup: {
    line: [],
    block: [["<!--", "-->"]],
    quotes: ['"', "'"],
    keywords: new Set(),
    markup: true,
  },
  yaml: {
    line: ["#"],
    block: [],
    quotes: ['"', "'"],
    keywords: words("true false null yes no"),
  },
};

/** The grammar a code block's language name uses, or null for plain text. */
function grammarOf(lang: string): Grammar | null {
  const l = lang.trim().toLowerCase();
  if (
    /^(js|javascript|jsx|ts|typescript|tsx|java|c|h|cpp|c\+\+|cc|cs|csharp|go|golang|rust|rs|swift|kotlin|kt|php|dart|scala|objc)$/.test(
      l,
    )
  )
    return GRAMMARS.c;
  if (/^(py|python|python3)$/.test(l)) return GRAMMARS.python;
  if (/^(rb|ruby)$/.test(l)) return GRAMMARS.ruby;
  if (/^(sh|bash|zsh|shell|console)$/.test(l)) return GRAMMARS.shell;
  if (/^(sql|psql|postgres|mysql|sqlite)$/.test(l)) return GRAMMARS.sql;
  if (/^(css|scss|less)$/.test(l)) return GRAMMARS.css;
  if (/^(json|jsonc)$/.test(l)) return GRAMMARS.json;
  if (/^(html|xml|svg|vue)$/.test(l)) return GRAMMARS.markup;
  if (/^(yaml|yml|toml)$/.test(l)) return GRAMMARS.yaml;
  return null;
}

/** Whether a code block's language is one that gets coloured. */
export const colourable = (lang: string): boolean => grammarOf(lang) !== null;

/** The longest code block that is coloured; longer ones stay plain. */
const MAX_COLOURED = 20_000;

/**
 * A code block's text as coloured tokens. Joined back together the tokens
 * are exactly the text.
 */
export function colourCode(text: string, lang: string): CodeToken[] {
  const g = grammarOf(lang);
  if (!g || text.length > MAX_COLOURED) return [{ text, kind: "plain" }];
  const out: CodeToken[] = [];
  const push = (t: string, kind: CodeTokenKind) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += t;
    else out.push({ text: t, kind });
  };
  let i = 0;
  let inTag = false;
  while (i < text.length) {
    const rest = text.slice(i);
    // Comments.
    const block = g.block.find(([open]) => rest.startsWith(open));
    if (block) {
      const end = text.indexOf(block[1], i + block[0].length);
      const stop = end < 0 ? text.length : end + block[1].length;
      push(text.slice(i, stop), g === GRAMMARS.python ? "string" : "comment");
      i = stop;
      continue;
    }
    const line = g.line.find((l) => rest.startsWith(l));
    if (line && !(g === GRAMMARS.shell && rest.startsWith("#!") && i > 0)) {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      push(text.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    // Markup tags: the tag's name and its attribute names are names.
    if (g.markup) {
      if (!inTag && /^<\/?[A-Za-z]/.test(rest)) {
        const m = /^<\/?[A-Za-z][\w:.-]*/.exec(rest)!;
        push(m[0], "keyword");
        i += m[0].length;
        inTag = true;
        continue;
      }
      if (inTag && (rest.startsWith(">") || rest.startsWith("/>"))) {
        const t = rest.startsWith("/>") ? "/>" : ">";
        push(t, "keyword");
        i += t.length;
        inTag = false;
        continue;
      }
      if (inTag) {
        const attr = /^[A-Za-z_:][\w:.-]*/.exec(rest);
        if (attr) {
          push(attr[0], "name");
          i += attr[0].length;
          continue;
        }
      } else {
        const textRun = /^[^<]+/.exec(rest);
        if (textRun) {
          push(textRun[0], "plain");
          i += textRun[0].length;
          continue;
        }
      }
    }
    // Strings, stopping at their closing quote (a backslash escapes it) or,
    // for anything but a template, at the end of the line.
    const quote = g.quotes.find((q) => rest.startsWith(q));
    if (quote) {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === quote) {
          j++;
          break;
        }
        if (text[j] === "\n" && quote !== "`") break;
        j++;
      }
      const s = text.slice(i, j);
      // A JSON key is a name, not a string.
      const isKey = g === GRAMMARS.json && /^\s*:/.test(text.slice(j));
      push(s, isKey ? "name" : "string");
      i = j;
      continue;
    }
    const num = /^(0x[0-9a-fA-F]+|\d+(\.\d+)?([eE][+-]?\d+)?)/.exec(rest);
    if (num && !/[\w$]/.test(text[i - 1] ?? "")) {
      push(num[0], "number");
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      const w = word[0];
      const key = g.anyCase ? w.toLowerCase() : w;
      if (g.keywords.has(key)) push(w, "keyword");
      // A name called like a function: `print(`, `render (`.
      else if (/^\s*\(/.test(text.slice(i + w.length))) push(w, "name");
      else push(w, "plain");
      i += w.length;
      continue;
    }
    push(text[i], "plain");
    i++;
  }
  return out.length ? out : [{ text, kind: "plain" }];
}
