// The Clipper's popup: what this page will be saved as, where it goes, and
// Save. Orbyn cleans the page on its side; a dry run says first what it
// would make (reading time, a deadline it found), and nothing is saved
// until you press Save.
import {
  CLIP_TYPES,
  clipTypeFor,
  highlightsFor,
  orbyn,
  saveSettings,
  setHighlights,
  settings,
} from "./shared.js";

const $ = (id) => document.getElementById(id);
const state = {
  tab: null,
  page: null,
  type: "article",
  as: "quotes",
  highlights: [],
  destinations: null,
  settings: null,
};

const show = (el, on) => (el.hidden = !on);
const say = (text, tone = "") => {
  const m = $("message");
  m.textContent = text;
  m.className = tone;
};

/** The open page's HTML, selection and title (only when the popup asks). */
async function readPage(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      html: document.documentElement.outerHTML.slice(0, 2_000_000),
      selection: String(window.getSelection() || "")
        .trim()
        .slice(0, 20000),
      title: document.title,
    }),
  });
  return result?.result ?? { html: "", selection: "", title: "" };
}

function renderTypes() {
  const box = $("types");
  box.replaceChildren();
  for (const [id, label] of Object.entries(CLIP_TYPES)) {
    const b = document.createElement("button");
    b.textContent = label;
    b.setAttribute("aria-pressed", String(state.type === id));
    b.onclick = () => {
      state.type = id;
      renderTypes();
      render();
      void preview();
    };
    box.append(b);
  }
}

function renderHighlights() {
  const list = $("highlights");
  list.replaceChildren();
  for (const h of state.highlights) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = h.text;
    const remove = document.createElement("button");
    remove.className = "link-button";
    remove.textContent = "Remove";
    remove.setAttribute(
      "aria-label",
      `Remove highlight: ${h.text.slice(0, 40)}`,
    );
    remove.onclick = async () => {
      state.highlights = state.highlights.filter((x) => x.id !== h.id);
      await setHighlights(state.tab.url, state.highlights);
      chrome.tabs
        .sendMessage(state.tab.id, { type: "orbyn:unhighlight", id: h.id })
        .catch(() => {});
      renderHighlights();
    };
    li.append(text, remove);
    list.append(li);
  }
  if (!state.highlights.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent =
      "Select words on the page, then press Highlight selection (or Alt+Shift+H).";
    list.append(li);
  }
}

function renderWhere() {
  const select = $("where");
  select.replaceChildren();
  const d = state.destinations;
  const add = (value, label, group) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    (group ?? select).append(o);
    return o;
  };
  const group = (label) => {
    const g = document.createElement("optgroup");
    g.label = label;
    select.append(g);
    return g;
  };
  const cards = state.type === "highlights" && state.as === "cards";
  if (cards) {
    add("", "A new page of cards");
    if (d?.card_pages.length) {
      const g = group("Pages of cards");
      for (const p of d.card_pages) add(`doc:${p.id}`, p.title, g);
    }
  } else {
    add("", "Your own space");
    if (d?.teams.length) {
      const g = group("Teams");
      for (const t of d.teams) add(`team:${t.id}`, t.name, g);
    }
    if (
      state.type !== "assignment" &&
      state.type !== "read_later" &&
      d?.folders.length
    ) {
      const g = group("Folders");
      for (const f of d.folders) add(`folder:${f.id}`, f.name, g);
    }
    if (d?.projects.length) {
      const g = group("Projects");
      for (const p of d.projects) add(`project:${p.id}`, p.name, g);
    }
  }
  const last = state.settings.lastDestination;
  if (last && [...select.options].some((o) => o.value === last))
    select.value = last;
}

function render() {
  show($("highlight-card"), state.type === "highlights");
  show($("due-field"), state.type === "assignment");
  $("save").textContent =
    state.type === "highlights"
      ? state.as === "cards"
        ? "Save as study cards"
        : "Save highlights"
      : state.type === "assignment" || state.type === "read_later"
        ? "Save as a task"
        : "Save as a page";
  renderWhere();
}

/** What Orbyn would make, for the line under the page's title. */
function body(dryRun) {
  const where = $("where").value;
  const [kind, id] = where.split(":");
  const due = $("due").value;
  return {
    type: state.type,
    url: state.tab.url,
    title: state.page.title.slice(0, 200),
    ...(state.type === "article" ||
    state.type === "paper" ||
    state.type === "assignment" ||
    state.type === "read_later"
      ? { html: state.page.html }
      : {}),
    ...(state.page.selection && state.type !== "highlights"
      ? { selection: state.page.selection }
      : {}),
    ...(state.type === "highlights"
      ? {
          highlights: state.highlights.map((h) => ({ text: h.text })),
          highlights_as: state.as,
        }
      : {}),
    folder_id: kind === "folder" ? id : null,
    project_id: kind === "project" ? id : null,
    team_id: kind === "team" ? id : null,
    doc_id: kind === "doc" ? id : null,
    ...(state.type === "assignment" && due
      ? { due_at: new Date(due).toISOString() }
      : {}),
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dry_run: dryRun,
  };
}

async function preview() {
  const p = $("preview");
  if (state.type === "highlights") {
    p.textContent = state.highlights.length
      ? `${state.highlights.length} highlight${state.highlights.length === 1 ? "" : "s"}`
      : "";
    return;
  }
  p.textContent = "Reading the page…";
  try {
    const r = await orbyn("/clips", body(true));
    const bits = [];
    if (r.reading_minutes) bits.push(`About ${r.reading_minutes} min to read`);
    if (r.lines && (state.type === "article" || state.type === "paper"))
      bits.push(`${r.lines} lines`);
    p.textContent = bits.join(" · ");
    if (state.type === "assignment") {
      if (r.due_at && !$("due").value) {
        const at = new Date(r.due_at);
        const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000);
        $("due").value = local.toISOString().slice(0, 16);
      }
      $("due-note").textContent =
        r.due_note ??
        (r.due_at ? "Read from the page. Change it if it's wrong." : "");
    }
  } catch (e) {
    p.textContent = e.message;
  }
}

async function save() {
  const button = $("save");
  button.disabled = true;
  say("Saving…");
  try {
    const where = $("where").value;
    await saveSettings({ lastDestination: where });
    const r = await orbyn("/clips", body(false));
    const web = state.settings.api.replace(/\/api\/?$/, "");
    say("");
    const done = document.createElement("span");
    done.className = "done";
    done.textContent = "Saved to Orbyn. ";
    const open = document.createElement("a");
    open.href = `${web}/app/${r.made.kind === "task" ? "task" : "doc"}/${r.made.id}`;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "Open it";
    $("message").append(done, open);
    if (state.type === "highlights") {
      // Clipped highlights are done with; the page is left as it was.
      for (const h of state.highlights)
        chrome.tabs
          .sendMessage(state.tab.id, { type: "orbyn:unhighlight", id: h.id })
          .catch(() => {});
      state.highlights = [];
      await setHighlights(state.tab.url, []);
      renderHighlights();
    }
  } catch (e) {
    say(e.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function start() {
  state.settings = await settings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  $("open-options").onclick = () => chrome.runtime.openOptionsPage();
  $("settings").onclick = () => chrome.runtime.openOptionsPage();
  if (!state.settings.key) {
    show($("connect"), true);
    return;
  }
  show($("clip"), true);
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    say("Only web pages can be clipped.", "error");
    $("save").disabled = true;
    return;
  }
  $("page-host").textContent = new URL(tab.url).hostname.replace(/^www\./, "");
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/highlight.js"],
    });
    state.page = await readPage(tab.id);
  } catch {
    state.page = { html: "", selection: "", title: tab.title ?? "" };
  }
  $("page-title").textContent = state.page.title || tab.title || tab.url;
  state.highlights = await highlightsFor(tab.url);
  state.type = state.highlights.length
    ? "highlights"
    : clipTypeFor(tab.url, state.settings.rules);
  for (const b of document.querySelectorAll("#as button"))
    b.onclick = () => {
      state.as = b.dataset.as;
      for (const x of document.querySelectorAll("#as button"))
        x.setAttribute("aria-pressed", String(x === b));
      render();
    };
  $("add-highlight").onclick = async () => {
    const res = await chrome.tabs
      .sendMessage(tab.id, { type: "orbyn:highlight" })
      .catch(() => null);
    if (!res?.ok)
      say(res?.reason ?? "Select some words on the page first.", "error");
    else say("");
    state.highlights = await highlightsFor(tab.url);
    renderHighlights();
    void preview();
  };
  $("save").onclick = () => void save();
  renderTypes();
  renderHighlights();
  render();
  try {
    state.destinations = await orbyn("/clips/destinations");
    renderWhere();
  } catch (e) {
    say(e.message, "error");
  }
  void preview();
}

void start();
