#!/usr/bin/env node
// Builds orbyn.dev into dist/: plain HTML, one stylesheet, one small script and
// self-hosted fonts. No dependencies. All copy is taken from orbyn.dev Designs.
//
//   node scripts/build-site.mjs          build into dist/
//   node scripts/build-site.mjs --check  build into a temporary folder and verify it
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const out = check ? mkdtempSync(join(tmpdir(), "orbyn-site-")) : join(root, "dist");
const SITE = "https://orbyn.dev";

// ---------------------------------------------------------------------------
// Icons: the design's own symbols, only those the site uses.
const ICONS = {
  "i-calcheck": '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>',
  "i-note": '<path d="M6 4h9l3 3v13H6z"/><path d="M9 11h6M9 14.5h4"/>',
  "i-film": '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4"/>',
  "i-term": '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7.5 10l3 2-3 2M12.5 15h4"/>',
  "i-laptop": '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 18.5h18"/>',
  "i-lock": '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  "i-cloudoff": '<path d="M4 4l16 16M8 7.5A5.5 5.5 0 0 1 17.4 10 4 4 0 0 1 19.6 17M15 18H7.5a4 4 0 0 1-1.2-7.8"/>',
  "i-user": '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-3.5 3.8-5.5 7-5.5s6 2 7 5.5"/>',
  "i-agent": '<rect x="5" y="7.5" width="14" height="11" rx="3"/><path d="M12 4v3.5M9.5 12.5h.01M14.5 12.5h.01"/>',
  "i-check2": '<path d="M5.5 12.5l4 4 9-9"/>',
  "i-users": '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.5.6 2.6 2 3 4.2"/>',
  "i-list": '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  "i-x": '<path d="M7 7l10 10M17 7L7 17"/>',
  "i-right": '<path d="M9.5 6l6 6-6 6"/>',
  "i-phone": '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
  "i-globe": '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17"/>',
  "i-key": '<circle cx="8" cy="14" r="4"/><path d="M11 11l8.5-8.5M16 6l2.5 2.5"/>',
  "i-sun": '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  "i-moon": '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  "i-shield": '<path d="M12 3.5l7 2.8v5.4c0 4.3-3 7.5-7 8.8-4-1.3-7-4.5-7-8.8V6.3z"/>',
  "i-copy": '<rect x="8" y="8" width="11.5" height="11.5" rx="2"/><path d="M5 15.5V6a1.5 1.5 0 0 1 1.5-1.5H16"/>',
  "i-git": '<circle cx="12" cy="12" r="3"/><path d="M3.5 12H9M15 12h5.5"/>',
  "i-eye": '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
};
const ic = (id, cls = "ic sm", extra = "") => `<svg class="${cls}${extra}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>`;

// ---------------------------------------------------------------------------
// Content, from orbyn.dev Designs v4 and the Product Line and Monetization plans.
const PLATFORMS = {
  planner: "Web · Mac · Windows · iPhone · Android",
  notes: "Web · Mac · Windows · iPhone · Android",
  studio: "Mac · Windows",
  engineering: "Mac · Windows · Linux · Web",
};
const APPS = [
  { key: "planner", name: "Orbyn Planner", cls: "ap-pl", icon: "i-calcheck", line: "Tasks, lists, projects and calendar. Offline and encrypted end to end.", group: "Everyday",
    plan: "Planned plan: Free on one device, Plus to sync",
    features: [["Today", "Events and tasks for the day, in order."], ["Calendar", "Week, day, agenda and month, with your other calendars."], ["Projects", "Boards and lists for anything from a trip to a launch."], ["Booking", "Pages that read only your busy times. Planned."]] },
  { key: "notes", name: "Orbyn Notes", cls: "ap-no", icon: "i-note", line: "Encrypted notes and pages that link to your tasks and events.", group: "Everyday",
    plan: "Planned plan: Free on one device, Plus to sync",
    features: [["Notes and pages", "A plain, fast editor that works offline."], ["Links to tasks", "A task links to a note, and a note to an event."], ["Study", "Flashcards from your notes, reviewed on a schedule."], ["Clip and Journal", "Save pages to read later; keep a private daily page."]] },
  { key: "studio", name: "Orbyn Studio", cls: "ap-st", icon: "i-film", line: "Films, lyric videos, demos and social posts, made from code with your own agent.", group: "Makers",
    plan: "Planned plan: Free locally, Pro for storage and sharing",
    features: [["Lyric videos", "From a prompt and an audio file to a finished video."], ["Motion films and demos", "Made from code, rendered on your computer."], ["Social posts", "Written in your voice and previewed in a feed. You publish."], ["Your own agent", "Uses your Claude or Codex. We never resell models."]] },
  { key: "engineering", name: "Orbyn Engineering", cls: "ap-en", icon: "i-term", line: "A workspace for coding agents, with memory, review and the skills library built in.", group: "Builders",
    plan: "Planned plan: Free locally, Pro for remote access and sync",
    features: [["Threads and review", "Agents work in worktrees; a review gate checks each change."], ["Memory", "One memory for Claude, Codex and other agents, synced."], ["Skills library", "39 skills and the harness, built in."], ["Diagrams, audit and inspect", "From the code: diagrams, a security review, binaries."]] },
];
const PROMISES = [
  ["i-lock", "Private by design", "Encrypted on your device before upload. Advanced protection on every paid plan."],
  ["i-cloudoff", "Local first", "Works offline. Your device keeps everything, and you can export at any time."],
  ["i-user", "One account", "Sign in once. Every app joins the same subscription."],
  ["i-agent", "Agent ready", "A CLI and an MCP server per app, behind grants you control and can audit."],
];
// Yearly prices and the Teams line come from the Monetization Plan (relayed by
// the Orbyn Products Research session) until the Yearly state is drawn.
const PLANS = [
  { name: "Free", month: "$0", year: "$0", free: true, for: "For one device", sum: "Every app, on one device",
    items: ["Every app, on one device", "Engineering and Studio run locally", "Export any time"] },
  { name: "Plus", month: "$4", year: "$36", on: true, for: "For your own devices", sum: "Sync Planner and Notes on all your devices, with Advanced protection",
    items: ["Sync Planner and Notes everywhere", "Advanced protection", "Web access"] },
  { name: "Pro", month: "$12", year: "$108", for: "For makers and builders", sum: "Plus, with Engineering remote access and memory sync, and Studio storage and share links",
    items: ["Everything in Plus", "Engineering remote access and memory sync", "Studio storage and share links"] },
  { name: "Family", month: "$7", year: "$60", for: "For up to 6 people", sum: "Plus for up to 6 people, with shared family lists and calendar",
    items: ["Plus for everyone", "Shared family lists and calendar", "Each person’s own data stays private"] },
];
// Every contact goes through one address (owner's decision).
const CONTACT = "hello@orbyn.dev";
const TEAMS_PRICE = "$5, or $18 with Engineering, per person a month";

// ---------------------------------------------------------------------------
// Product previews, from orbyn.dev Designs v9: early designs in iframes, each
// labelled "Early design · may change" inside the preview file itself.
const TITLES = {
  "planner-today": "Orbyn Planner, Today", "planner-board": "Orbyn Planner, board", "planner-week": "Orbyn Planner, calendar week",
  "planner-task-notes": "Orbyn Planner, task panel with linked notes", "planner-booking": "Orbyn Planner, booking",
  "planner-phone-week": "Orbyn Planner on a phone, week", "planner-phone-task": "Orbyn Planner on a phone, task",
  "notes-editor": "Orbyn Notes, editor", "notes-linked-task": "Orbyn Notes, note linked to a Planner task", "notes-study": "Orbyn Notes, Study session",
  "notes-journal": "Orbyn Notes, Journal", "notes-phone": "Orbyn Notes on a phone",
  "studio-editor": "Orbyn Studio, canvas and timeline", "studio-storyboard": "Orbyn Studio, storyboard", "studio-export-queue": "Orbyn Studio, export queue",
  "studio-feed-preview": "Orbyn Studio, post composer with a LinkedIn feed preview", "studio-phone-queue": "Orbyn Studio on a phone, export queue",
  "eng-console": "Orbyn Engineering, console thread", "eng-diff": "Orbyn Engineering, side panel diff", "eng-memory": "Orbyn Engineering, Memory",
  "eng-gate": "Orbyn Engineering, review gate", "eng-tool-calls": "Orbyn Engineering, tool calls", "eng-phone": "Orbyn Engineering on a phone, thread",
  "account-protection": "Orbyn Account, protection level", "account-advanced-flow": "Orbyn Account, turning on Advanced protection",
  "walk-planner-quick-add": "Orbyn Planner, quick add: dentist friday 3pm to the calendar",
  "walk-notes-link-task": "Orbyn Notes, link a note to a Planner task",
  "walk-studio-lyric-video": "Orbyn Studio, from a prompt to an exported lyric video",
  "walk-eng-approve-gate": "Orbyn Engineering, approve a command, then the review gate findings",
};
const ratio = (f) => (/phone/.test(f) ? "arp" : f === "notes-study" ? "ars" : "arw");
const frame = (f, { eager = false, cls = "" } = {}) =>
  `<div class="pvb ${ratio(f)}${cls ? " " + cls : ""}"><iframe class="pvf" data-src="/previews/${f}.html" loading="${eager ? "eager" : "lazy"}" title="${esc(TITLES[f])}" tabindex="-1"></iframe></div>`;
const fig = (f, cap, { cls = "", open = "" } = {}) =>
  `<figure class="pvfig${cls ? " " + cls : ""}">${open ? `<button class="pvtap" type="button" data-open="${f}" data-title="${esc(open)}" aria-label="Open ${esc(open)} full size">${frame(f).replace("<iframe ", '<iframe aria-hidden="true" ')}</button>` : frame(f)}<figcaption>${cap}</figcaption></figure>`;
const b = (bold, rest) => `<b>${bold}</b> ${rest}`;

const PREVIEWS = {
  planner: {
    hero: "planner-today", card: "planner-today", phone: ["planner-phone-week", "Week on a phone. Early design."],
    walk: ["walk-planner-quick-add", "Quick add: type “dentist friday 3pm” and it lands on your calendar."],
    gallery: [["planner-today", "Today", "Events and tasks, in order."], ["planner-board", "Board", "Projects as columns."], ["planner-week", "Calendar week", "Events, overlaps and what is due."], ["planner-task-notes", "Task and notes", "A task panel with linked notes."], ["planner-booking", "Booking", "Pages that read only your busy times."]],
    phones: [["planner-phone-week", "Week"], ["planner-phone-task", "Task"]],
    phoneLast: ["planner-phone-task", "A task with its linked notes."],
    strip: [["planner-task-notes", "A task with its linked notes."], ["planner-week", "Week view with your other calendars."], ["planner-board", "Boards for projects."]],
  },
  notes: {
    hero: "notes-editor", card: "notes-editor", phone: ["notes-phone", "Notes on a phone. Early design."],
    walk: ["walk-notes-link-task", "Link a note to a task: type [[ and pick it."],
    gallery: [["notes-editor", "Editor", "Headings, to-dos and links to tasks."], ["notes-linked-task", "Linked task", "The task shows the note it links."], ["notes-study", "Study session", "Flashcards, reviewed on a schedule."], ["notes-journal", "Journal", "A private page for each day."]],
    phones: [["notes-phone", "Notes"]],
    strip: [["notes-linked-task", "A note linked to a Planner task."], ["notes-study", "Study sessions from your notes."], ["notes-journal", "A private daily Journal."]],
  },
  studio: {
    hero: "studio-editor", card: "studio-editor", phone: ["studio-phone-queue", "Export queue on a phone. Early design."],
    walk: ["walk-studio-lyric-video", "From a prompt and a song to an exported lyric video."],
    gallery: [["studio-storyboard", "Storyboard", "Scenes proposed; nothing renders until you approve."], ["studio-editor", "Canvas and timeline", "Edit lines and timing."], ["studio-export-queue", "Export queue", "Renders while you keep editing."], ["studio-feed-preview", "Feed preview", "See a post in the feed. You publish."]],
    phones: [["studio-phone-queue", "Export queue"]],
    strip: [["studio-storyboard", "A storyboard you approve."], ["studio-editor", "Canvas and timeline."], ["studio-export-queue", "Exports run on your Mac."]],
  },
  engineering: {
    hero: "eng-console", card: "eng-console", phone: ["eng-phone", "Thread on a phone. Early design."],
    walk: ["walk-eng-approve-gate", "Approve a command, then read the review gate’s findings."],
    gallery: [["eng-console", "Console thread", "An agent at work; it asks before it acts."], ["eng-diff", "Side panel diff", "Changes beside the conversation."], ["eng-memory", "Memory", "Lessons you approve, kept for any agent."], ["eng-gate", "Review gate", "Findings ranked before a commit."], ["eng-tool-calls", "Tool calls", "Every command and edit, in rows."]],
    phones: [["eng-phone", "Thread"]],
    strip: [["eng-console", "A thread with a side panel."], ["eng-memory", "One memory for your agents."], ["eng-gate", "A review gate before each commit."]],
  },
};

// ---------------------------------------------------------------------------
// Pieces
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const building = '<span class="st info"><i class="sd"></i>Building</span>';
const planned = '<span class="st planned"><i class="sd"></i>Planned</span>';
const NAV = [["Apps", "/apps/"], ["Pricing", "/pricing/"], ["Security", "/security/"]];

// Theme: the button and menu from orbyn.dev Designs "Theme switch".
const THEMES = [["system", "System", "i-laptop", "Follows this device"], ["light", "Light", "i-sun", ""], ["dark", "Dark", "i-moon", ""], ["dim", "Dim", "i-moon", "Softer dark"]];
function themeControl() {
  const items = THEMES.map(([v, label, icon, note], i) =>
    `<button class="mi" type="button" role="menuitemradio" data-theme-choice="${v}" aria-checked="${i === 0}" tabindex="-1">${ic(icon)}<span class="grow">${label}</span>` +
    `${note ? `<small class="t4">${note}</small>` : ""}<span class="tick">${ic("i-check2")}</span></button>`).join("");
  return `<button class="icb thbtn" type="button" id="theme-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="theme-menu" aria-label="Theme: System">` +
    THEMES.map(([v, , icon]) => ic(icon, "ic sm", ` th-${v}`)).join("") + `</button>` +
    `<div class="menu thmenu" id="theme-menu" role="menu" aria-label="Theme"><div class="mh2" aria-hidden="true">Theme</div>${items}</div>`;
}

function nav(current) {
  const links = NAV.map(([label, href]) =>
    `<a class="lk" href="${href}"${current === label ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const rows = NAV.map(([label, href]) =>
    `<a class="mrow" href="${href}"${current === label ? ' aria-current="page"' : ""}><span>${label}</span>${ic("i-right", "ic")}</a>`).join("");
  const seg = THEMES.map(([v, label], i) => `<button type="button" role="radio" data-theme-choice="${v}" aria-checked="${i === 0}">${label}</button>`).join("");
  return `<header class="snav"><a class="brand" href="/"><span class="logo" aria-hidden="true"></span>Orbyn</a><nav class="links" aria-label="Main">${links}</nav><div class="end">${building}` +
    themeControl() +
    `<button class="icb menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="menu">${ic("i-list", "ic", " ic-list")}${ic("i-x", "ic", " ic-x")}</button></div>` +
    `<div class="mwrap" id="menu"><div class="mscrim" data-close></div><nav class="msheet" aria-label="Menu">${rows}` +
    `<div class="mrow theme-row"><span class="lbl">Theme</span><span class="thseg" role="radiogroup" aria-label="Theme">${seg}</span></div>` +
    `<div class="mrow foot">${building}Nothing is out yet</div></nav></div></header>`;
}

const appIcon = (a, sm = true) => `<span class="appi${sm ? " sm" : ""} ${a.cls}" aria-hidden="true">${ic(a.icon)}</span>`;

function appCard(a, { withPreview = true } = {}) {
  return `<a class="acard" href="/${a.key}/" data-group="${a.group}">${withPreview ? frame(PREVIEWS[a.key].card, { cls: "cardpv" }) : ""}` +
    `<div class="head"><h2>${appIcon(a)}${a.name}</h2><span class="end">${building}</span></div><p>${a.line}</p>` +
    `<div class="plat">${ic("i-laptop")}${PLATFORMS[a.key]}</div></a>`;
}

const promises = () => `<div class="prin">${PROMISES.map(([i, t, d]) => `<div><h2>${ic(i)}${t}</h2><p>${d}</p></div>`).join("")}</div>`;

function page({ path, title, description, current, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${path.startsWith("/404") || path === "/booking" ? "" : `<link rel="canonical" href="${SITE}${path}">\n`}<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f6f6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/geist-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/geist-latin-500-normal.woff2" as="font" type="font/woff2" crossorigin>
<script src="${ASSETS.theme}"></script>
<link rel="stylesheet" href="${ASSETS.css}">
<script src="${ASSETS.js}" defer></script>
</head>
<body>
<a class="skip btn" href="#main">Skip to content</a>
<div class="page">
${nav(current)}
<main id="main">
${body}
</main>
<footer class="sfoot"><div class="fbrandcol"><a class="fbrand" href="/"><span class="logo" aria-hidden="true"></span>Orbyn</a><span class="t3">Private apps that work offline.</span></div>
<nav class="frow flinks" aria-label="Footer">${NAV.map(([label, href]) => `<a class="flink" href="${href}">${label}</a>`).join("")}<a class="flink" href="https://github.com/orbyn-dev">${ic("i-git")}Source on GitHub</a></nav>
<div class="frow fend">${building}<span class="t4">© 2026 Anh Dang</span></div></footer>
${body.includes("pvtap") ? `<div class="pvsheetwrap" id="pvsheet" hidden><div class="pvscrim" data-close></div><div class="pvsheet" role="dialog" aria-modal="true" aria-labelledby="pvsheet-title"><div class="pvsh2"><span class="pvgrab" aria-hidden="true"></span><b id="pvsheet-title"></b><button class="icb" type="button" data-close aria-label="Close">${ic("i-x", "ic")}</button></div><div class="pvscroll" tabindex="0"><div class="pvb arw pvfull"></div></div><span class="pvhint t4">Full size. Scroll sideways to see all of it.</span></div></div>` : ""}
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Pages
const pages = [];

pages.push({ file: "index.html", path: "/", title: "Orbyn", current: "",
  description: "Orbyn is a family of local-first apps that sync end to end under one account. Nothing is out yet. Every app is still being built.",
  body: `<section class="hero">
<span class="eyebrow t3">One account · four apps</span>
<h1>Private apps that work offline and that agents can work in safely.</h1>
<p><span class="desk-only">Orbyn is a family of local-first apps that sync end to end under one account. Plan your week, keep your notes, make films and build software.</span><span class="phone-only">A family of local-first apps under one account.</span></p>
<div class="acts"><a class="btn lg" href="/apps/">See the apps</a><a class="ghost lg" href="/security/">How we protect your data</a></div>
<span class="note t4">Nothing is out yet. Every app is still being built.</span>
</section>
<div class="pvhero desk-only" role="group" aria-label="Orbyn Planner, Notes, Studio and Engineering on one account">
<div class="pvh h1">${frame("notes-editor", { eager: true })}</div><div class="pvh h2">${frame("planner-task-notes")}</div><div class="pvh h3">${frame("studio-editor")}</div><div class="pvh h4">${frame("eng-gate")}</div>
</div>
<p class="pvnote desk-only top8">A Planner task with the Notes note it links to, beside small Studio and Engineering screens. Early designs; they may change.</p>
<div class="pvstack phone-only">${fig("planner-phone-task", "A task with its linked notes. Early design.")}</div>
<div class="gap22 desk-only"></div>
<div class="cards c4 homecards">${APPS.map((a) => appCard(a)).join("")}</div>
<div class="desk-only">
<div class="gap30"></div><div class="pvblk"><div class="pvh2"><b>A look at each app</b><span class="t3">Early designs. Nothing is out yet.</span></div></div><div class="gap12"></div>
<div class="pvstrips">${APPS.map((a) => `<div class="pvstrip"><div class="pvsh">${appIcon(a)}<b>${a.name}</b>${building}</div><div class="pvgrid g3">${PREVIEWS[a.key].strip.map(([f, c]) => fig(f, c)).join("")}</div></div>`).join("")}</div>
</div>
${APPS.map((a) => `<div class="pvstack phone-only"><span class="pvsh">${appIcon(a)}<b>${a.name}</b></span>${fig(PREVIEWS[a.key].phone[0], PREVIEWS[a.key].phone[1])}</div>`).join("")}
<div class="gap34"></div>
${promises()}` });

pages.push({ file: "apps/index.html", path: "/apps/", title: "Apps · Orbyn", current: "Apps",
  description: "Four apps on one account: Orbyn Planner, Notes, Studio and Engineering. Every app is still being built.",
  body: `<section class="hero sub">
<h1>Apps</h1>
<p class="desk-only">Four apps on one account. We list only what works today and mark the rest honestly.</p>
<div class="pills" role="group" aria-label="Filter apps">${["All", "Everyday", "Makers", "Builders"].map((g, i) =>
    `<button class="pill" type="button" data-filter="${g}" aria-pressed="${i === 0}">${g}</button>`).join("")}</div>
</section>
<div class="cards c2" id="catalog">${APPS.map((a) => appCard(a)).join("")}</div>
<div class="legend t3">${building}Being built, not out yet${planned}On the roadmap, not started</div>` });

pages.push({ file: "download/index.html", path: "/download/", title: "Download · Orbyn", current: "",
  description: "Nothing to download yet. Every Orbyn app is still being built.",
  body: `<section class="hero sub dl">
<h1>Nothing to download yet</h1>
<p>Every Orbyn app is still being built. When one is ready, its download appears here, together with the launcher that installs, updates and signs in the rest.</p>
</section>
<div class="cards c4">${APPS.map((a) => `<div class="acard slim"><h2>${appIcon(a)}${a.name}</h2><span class="planned-for t3">Planned for ${PLATFORMS[a.key]}</span><div>${building}</div></div>`).join("")}</div>
<p class="foot t3">Phone and web versions are planned for Planner and Notes.</p>` });

pages.push({ file: "pricing/index.html", path: "/pricing/", title: "Pricing · Orbyn", current: "Pricing",
  description: "Nothing is for sale yet. These are the plans Orbyn intends to launch with: every app free on one device, and one subscription to sync.",
  body: `<section class="hero center pricing-hero">
<span class="desk-only">${planned}</span>
<div class="ttlrow"><h1><span class="desk-only">One plan for every app</span><span class="phone-only">Pricing</span></h1><span class="phone-only">${planned}</span></div>
<p><span class="desk-only">Nothing is for sale yet. These are the plans we intend to launch with: every app free on one device, and one subscription to sync.</span><span class="phone-only">Nothing is for sale yet. These are the plans we intend to launch with.</span></p>
<div class="segx" role="group" aria-label="Billing period"><span class="thumb" aria-hidden="true"></span><button type="button" data-period="month" aria-pressed="true">Monthly</button><button type="button" data-period="year" aria-pressed="false">Yearly</button></div>
</section>
<div class="cards c4 plans">${PLANS.map((p) => `<div class="price${p.on ? " on" : ""}"><div class="phd"><h2>${p.name}</h2>` +
    `<div class="amt" data-month="${p.month}" data-year="${p.year}"><span class="v">${p.month}</span><small>${p.free ? "" : "/ month"}</small></div></div>` +
    `<span class="for t3">${p.for}</span><span class="sum t3">${p.sum}</span>` +
    `<ul>${p.items.map((i) => `<li>${ic("i-check2")}${i}</li>`).join("")}</ul></div>`).join("")}</div>
<div class="teams t3"><span class="tl">${ic("i-users")}Teams ${planned}</span><span class="tp">${TEAMS_PRICE}</span><span class="fn">Planned prices in US dollars. They may change before launch.</span></div>` });

const SEC_ROWS = [
  ["Who holds the keys", "Your trusted devices, and a copy in Orbyn’s key service, kept in hardware security modules", "Only your trusted devices"],
  ["Can Orbyn read your data?", "Technically yes, for account recovery and server features such as reminder email. Staff access needs approval and is logged.", "No"],
  ["You lose every device", "Recover with your email, a trusted phone number and a waiting period", "Your recovery key or a recovery contact. Without them, the data is lost."],
  ["Adding a device", "Sign in, then approve with a code on a trusted device", "The same. The keys come from a trusted device, your recovery key or a recovery contact."],
  ["On the web", "Works after sign-in", "Off by default. Each sign-in is approved on a trusted device and lasts one hour."],
  ["Reminders", "On the device, plus push and email from the server", "On the device. The push says only when; the phone decrypts the text."],
  ["Search", "On the device", "On the device"],
  ["Shared lists and projects", "Standard", "End-to-end when everyone sharing uses Advanced"],
  ["Calendars other apps use", "Standard", "Standard, so calendar apps and invitations keep working"],
];
pages.push({ file: "security/index.html", path: "/security/", title: "Security · Orbyn", current: "Security",
  description: "How Orbyn protects your data. This is how Orbyn is being built. Nothing has launched yet, and details may change before it does.",
  body: `<div class="sec-page">
<section class="sec-hero">${building}<h1>How Orbyn protects your data</h1><p>This is how Orbyn is being built. Nothing has launched yet, and details may change before it does.</p></section>
<section class="sec-sec"><h2>Every device keeps everything</h2><p>Each phone, computer and browser keeps a full copy and works offline. Changes reach your other devices as soon as they’re online. You can export everything at any time.</p>
<div class="sec-flow"><div class="sec-devs">${[["i-phone", "Phone"], ["i-laptop", "Computer"], ["i-globe", "Browser"]].map(([i, n]) => `<div class="sec-dev">${ic(i)}<b>${n}</b><small>Keeps everything · works offline</small></div>`).join("")}</div>
<div class="sec-arrow"><span class="mono t3">encrypted records only</span></div>
<div class="sec-srv">${ic("i-lock")}<div><b>Orbyn servers</b><small>Store encrypted records and wake your devices when something changes</small></div></div></div></section>
<section class="sec-sec"><h2>Encrypted on your device before upload</h2><p>Under both protection levels, records are encrypted before they leave your device.</p>
<ol class="sec-steps"><li><b>Saved on the device</b><span>A new task is saved in the device’s own database at once, so it works with no signal.</span></li><li><b>Encrypted before it leaves</b><span>The device encrypts the record with its own key before uploading it.</span></li><li><b>Stored as ciphertext</b><span>The server keeps a new encrypted version and tells your other devices something changed, without saying what.</span></li><li><b>Decrypted on your devices</b><span>Each device fetches the change and decrypts it. If two devices edited the same thing, they merge field by field.</span></li></ol></section>
<section class="sec-sec"><h2>Standard or Advanced protection</h2><p>Every account has one of two levels. Sync and the apps work the same in both; what changes is who can hold the keys. Advanced will be in every paid plan.</p>
<div class="sec-table" role="table" aria-label="Standard and Advanced protection compared"><div class="sec-row sec-head" role="row"><span role="columnheader"><span class="sr">Question</span></span><span role="columnheader">Standard <span class="t4">(default)</span></span><span role="columnheader">Advanced</span></div>
${SEC_ROWS.map(([k, s, a]) => `<div class="sec-row" role="row"><b role="rowheader">${k}</b><span role="cell">${s}</span><span role="cell">${a}</span></div>`).join("\n")}</div></section>
<section class="sec-sec"><h2>What it looks like in your account</h2><p><span class="desk-only">Your protection level lives in your Orbyn account, and you can change it there. Early designs; they may change.</span><span class="phone-only">Early design; it may change.</span></p>
<div class="pvgrid g2 desk-only">${fig("account-protection", b("Protection", "Protection level: Standard or Advanced, and what each app encrypts."))}${fig("account-advanced-flow", b("Advanced, step 2 of 3", "Turning on Advanced: save your recovery key first."))}</div>
<div class="phone-only">${fig("account-protection", b("Protection", "Protection level: Standard or Advanced."))}</div></section>
<section class="sec-sec"><h2>Recovery key and recovery contacts</h2><div class="sec-two"><div class="sec-card"><b>${ic("i-key")} Recovery key</b><span class="t2">A long code only you keep. With Advanced, it is one of the only ways back in if you lose every device.</span></div><div class="sec-card"><b>${ic("i-users")} Recovery contact</b><span class="t2">Someone you trust can confirm it’s you. They can’t see your data.</span></div></div>
<p class="t3">Turning on Advanced needs a recovery key or a recovery contact first. Orbyn then deletes its copy of your keys.</p></section>
<section class="sec-sec"><h2>What Orbyn can always see</h2><p>Under both levels, the servers need a little information to sync and run your account:</p>
<ul class="sec-sees">${["Your email address", "Your devices", "Record ids and versions", "Record sizes", "When records change", "That an account was deleted, and on what day, for 400 days"].map((t) => `<li>${ic("i-eye")}${t}</li>`).join("")}</ul>
<p class="t3">Never the content of your tasks, notes, films or code under Advanced. After an account is deleted, Orbyn keeps only that an account was deleted and the day, with no email and no content.</p></section>
<section class="sec-sec"><h2>An engine you can audit</h2><p>The engine under every Orbyn app is being built in the open, so the privacy claims can be checked rather than trusted.</p>
<div class="sec-two"><div class="sec-card"><b>Device side</b><span class="t3">Encryption, keychain, sync client and planner rules</span><span class="lic">MIT or Apache-2.0</span><span class="t2">Anyone can read and audit the code that encrypts your data.</span></div><div class="sec-card"><b>Server side</b><span class="t3">Record store, key service, accounts and push</span><span class="lic">AGPL-3.0</span><span class="t2">Self-hosting stays free; a company running it as a service must publish its changes.</span></div></div>
<p class="t3">Licences as planned; the licence files land in the repository before release.</p></section>
<section class="sec-sec" id="report"><h2>Report a security issue</h2><p>Found something that could put people’s data at risk? Please tell us privately before sharing it anywhere else.</p>
<div class="sec-card report">${ic("i-shield", "ic")}<div class="rtext"><span class="t2">Email the details. Only the maintainers read this inbox.</span><span class="mono addr">${CONTACT}</span></div><button class="ghost copy" type="button" data-copy="${CONTACT}"><span class="cl a">${ic("i-copy")}Copy address</span><span class="cl b" aria-hidden="true">${ic("i-check2")}Copied</span></button><span class="sr" role="status" aria-live="polite"></span></div>
<p class="copyerr t2" hidden></p>
<span class="t3 rgh">For a problem in the code, you can also <a class="link" href="https://github.com/orbyn-dev/orbyn-engine/security/advisories/new">report it privately on GitHub</a>.</span></section>
</div>` });

for (const a of APPS) {
  const rest = APPS.filter((x) => x !== a);
  pages.push({ file: `${a.key}/index.html`, path: `/${a.key}/`, title: `${a.name} · Orbyn`, current: "Apps",
    description: `${a.line} Being built. There is nothing to install yet.`,
    body: `<section class="pvhdr"><div class="txt">
<span class="meta">${appIcon(a, false)}${building}<span class="t3 small">${a.group}</span></span>
<h1>${a.name}</h1>
<p class="line t3">${a.line}</p>
<span class="state t2">Being built. There is nothing to install yet.</span>
<span class="small t3">${a.plan}</span>
<span class="small t4">Planned for ${PLATFORMS[a.key]}</span>
</div><div class="desk-only">${frame(PREVIEWS[a.key].hero, { cls: "shadow" })}</div></section>
<div class="pvstack phone-only">
${fig(PREVIEWS[a.key].phone[0], PREVIEWS[a.key].phone[1])}
${fig(PREVIEWS[a.key].walk[0], b("Walkthrough", PREVIEWS[a.key].walk[1]), { cls: "pvwalk" }).replace('class="pvb', 'class="pvb pvw')}
<p class="pvopen">Tap a screen to open it full size</p>
${PREVIEWS[a.key].gallery.map(([f, t, c]) => fig(f, b(t, c), { open: t })).join("")}
${PREVIEWS[a.key].phoneLast ? fig(PREVIEWS[a.key].phoneLast[0], b("Phone", PREVIEWS[a.key].phoneLast[1])) : ""}
</div>
<div class="cards c4">${a.features.map(([t, d]) => `<div class="acard feat"><h2>${t}</h2><p>${d}</p></div>`).join("")}</div>
<div class="desk-only">
<div class="gap26"></div>
<div class="pvblk"><div class="pvh2"><b>See it work</b><span class="t3">Real screens from the design, played as a short walkthrough.</span></div>${fig(PREVIEWS[a.key].walk[0], b("Walkthrough", PREVIEWS[a.key].walk[1]), { cls: "pvwalk" }).replace('class="pvb', 'class="pvb pvw')}</div>
<div class="gap28"></div>
<div class="pvblk"><div class="pvh2"><b>Key screens</b><span class="t3">Early designs. They may change.</span></div><div class="pvgal"><div class="pvgrid g3">${PREVIEWS[a.key].gallery.map(([f, t, c]) => fig(f, b(t, c))).join("")}</div><div class="pvphones">${PREVIEWS[a.key].phones.map(([f, c]) => fig(f, b("Phone", c), { cls: "ph" })).join("")}</div></div></div>
</div>
<div class="gap28"></div>
${promises()}
<h2 class="family t3">The rest of the family</h2>
<div class="cards c3">${rest.map((r) => `<a class="acard slim" href="/${r.key}/"><div class="head"><h2>${appIcon(r)}${r.name}</h2><span class="end">${building}</span></div></a>`).join("")}</div>` });
}

const notFound = (line, button, path, file) => ({ file, path, title: "Not found · Orbyn", current: "",
  description: "This page doesn’t exist.",
  body: `<div class="public"><span class="t3 mono">404</span><h1>This page doesn’t exist</h1><p>${line}</p>
<div class="acts"><a class="btn" href="/apps/">${button}</a><a class="ghost" href="/">Go home</a></div></div>` });
pages.push(notFound("The link may be wrong, or the page may have moved.", "See the apps", "/404", "404.html"));
pages.push(notFound("Booking lives inside Orbyn Planner. It’s planned, not built yet.", "See all apps", "/booking", "booking/404.html"));

// ---------------------------------------------------------------------------
// Write
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 10);
const css = readFileSync(join(root, "site/src/styles.css"), "utf8");
const js = readFileSync(join(root, "site/src/site.js"), "utf8");
const theme = readFileSync(join(root, "site/src/theme.js"), "utf8");
const ASSETS = { css: `/assets/styles.${hash(css)}.css`, js: `/assets/site.${hash(js)}.js`, theme: `/assets/theme.${hash(theme)}.js` };
mkdirSync(join(out, "assets"));
writeFileSync(join(out, ASSETS.css), css);
writeFileSync(join(out, ASSETS.js), js);
writeFileSync(join(out, ASSETS.theme), theme);
cpSync(join(root, "site/fonts"), join(out, "fonts"), { recursive: true });
cpSync(join(root, "site/public"), out, { recursive: true });
cpSync(join(root, "site/previews"), join(out, "previews"), { recursive: true });
for (const p of pages) {
  mkdirSync(dirname(join(out, p.file)), { recursive: true });
  writeFileSync(join(out, p.file), page(p));
}

// ---------------------------------------------------------------------------
// Check: every page built, links resolve, no "Available", no download or buy action.
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); });
walk(out);
const problems = [];
const exists = (href, from) => {
  const p = href.replace(/[#?].*$/, "");
  const base = p.startsWith("/") ? out : dirname(from);
  const target = p.endsWith("/") ? join(base, p, "index.html") : join(base, p);
  try { return statSync(target).isFile(); } catch { return false; }
};
for (const f of files.filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(f, "utf8");
  for (const [, href] of html.matchAll(/(?:href|src|data-src)="([^"]+)"/g)) {
    if (href.startsWith("#") || href.startsWith("https://")) continue;
    if (!exists(href, f)) problems.push(`${relative(out, f)}: broken link ${href}`);
  }
  if (relative(out, f).startsWith("previews/") && /(?:href|src)="https?:\/\/(?!www\.w3\.org)/.test(html)) problems.push(`${relative(out, f)}: a preview loads something from another site`);
  if (!relative(out, f).startsWith("previews/") && /style="/.test(html)) problems.push(`${relative(out, f)}: inline style (blocked by the CSP)`);
  if (/<script>/.test(html)) problems.push(`${relative(out, f)}: inline script (blocked by the CSP)`);
  for (const word of ["Available", "Buy", "Subscribe", "Sign in</a>", "Waitlist", "Install now", "Get started"]) {
    if (html.includes(word)) problems.push(`${relative(out, f)}: says "${word}"`);
  }
  for (const [, href] of html.matchAll(/href="(https:\/\/github\.com\/[^"]+)"/g)) {
    if (!/^https:\/\/github\.com\/orbyn-dev(\/|$)/.test(href)) problems.push(`${relative(out, f)}: GitHub link outside orbyn-dev: ${href}`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(check ? `Checked ${pages.length} pages.` : `Built ${pages.length} pages into dist/.`);
if (check) rmSync(out, { recursive: true, force: true });
