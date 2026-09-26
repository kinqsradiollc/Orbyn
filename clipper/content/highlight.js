// Highlights on a web page (CAP-04), injected by the Clipper when you
// highlight something, open the Clipper, or (if you allowed it) on every
// visit, so highlights come back when you return. Highlights are kept in
// the extension's own storage on this computer until you clip them.
(() => {
  if (window.__orbynClipper) return;
  window.__orbynClipper = true;

  const key = `hl:${location.href.split("#")[0]}`;
  const MARK = "orbyn-hl";

  const style = document.createElement("style");
  style.textContent = `mark.${MARK}{background:#e7f0ea;color:inherit;border-bottom:2px solid #376c51;padding:0 1px;border-radius:2px}
@media (prefers-color-scheme: dark){mark.${MARK}{background:#1e3327;border-bottom-color:#7cc49a}}`;
  (document.head || document.documentElement).appendChild(style);

  /** Wrap every text node a range touches in a mark with this id. */
  function wrap(range, id) {
    const root =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.currentNode; n; n = walker.nextNode())
      if (n.nodeType === Node.TEXT_NODE && range.intersectsNode(n))
        nodes.push(n);
    for (const node of nodes) {
      let start = node === range.startContainer ? range.startOffset : 0;
      let end =
        node === range.endContainer ? range.endOffset : node.textContent.length;
      if (end <= start || !node.textContent.slice(start, end).trim()) continue;
      let target = node;
      if (start > 0) {
        target = node.splitText(start);
        end -= start;
        start = 0;
      }
      if (end < target.textContent.length) target.splitText(end);
      const mark = document.createElement("mark");
      mark.className = MARK;
      mark.dataset.orbynHl = id;
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
    }
  }

  /** The first place the page says these words (spaces aside), as a range. */
  function find(text) {
    const want = text.replace(/\s+/g, " ").trim();
    if (!want) return null;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const nodes = [];
    let all = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentNode;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.nodeName))
        continue;
      nodes.push({ node: n, at: all.length });
      all += n.textContent;
    }
    // Compare with runs of space made one, keeping a map back to the page.
    let flat = "";
    const back = [];
    for (let i = 0; i < all.length; i++) {
      const space = /\s/.test(all[i]);
      if (space && flat.endsWith(" ")) continue;
      flat += space ? " " : all[i];
      back.push(i);
    }
    const hit = flat.indexOf(want);
    if (hit < 0) return null;
    const from = back[hit];
    const to = back[hit + want.length - 1] + 1;
    const at = (i) => {
      let found = nodes[0];
      for (const n of nodes) if (n.at <= i) found = n;
      return found;
    };
    const a = at(from);
    const b = at(to - 1);
    const range = document.createRange();
    range.setStart(a.node, from - a.at);
    range.setEnd(b.node, to - b.at);
    return range;
  }

  async function list() {
    return (await chrome.storage.local.get({ [key]: [] }))[key];
  }

  async function restore() {
    for (const h of await list()) {
      if (document.querySelector(`mark[data-orbyn-hl="${h.id}"]`)) continue;
      const range = find(h.text);
      if (range) wrap(range, h.id);
    }
  }

  async function highlight() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed)
      return { ok: false, reason: "Select some words first." };
    const range = sel.getRangeAt(0);
    const text = sel.toString().replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!text) return { ok: false, reason: "Select some words first." };
    const id = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    wrap(range, id);
    sel.removeAllRanges();
    const all = await list();
    all.push({ id, text, at: new Date().toISOString() });
    await chrome.storage.local.set({ [key]: all });
    return { ok: true, count: all.length };
  }

  async function remove(id) {
    for (const mark of document.querySelectorAll(`mark[data-orbyn-hl="${id}"]`))
      mark.replaceWith(...mark.childNodes);
    const all = (await list()).filter((h) => h.id !== id);
    if (all.length) await chrome.storage.local.set({ [key]: all });
    else await chrome.storage.local.remove(key);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "orbyn:highlight") {
      highlight().then(reply);
      return true;
    }
    if (msg?.type === "orbyn:unhighlight") {
      remove(String(msg.id)).then(() => reply({ ok: true }));
      return true;
    }
    return false;
  });

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => void restore());
  else void restore();
})();
