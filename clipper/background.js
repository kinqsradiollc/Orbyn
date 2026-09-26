// The Clipper's service worker: the right-click menu, the keyboard command,
// and bringing highlights back on pages you return to (only if you allowed
// it in the options).
const HIGHLIGHTER = "content/highlight.js";

async function withHighlighter(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [HIGHLIGHTER],
  });
}

async function highlightIn(tab) {
  if (!tab?.id) return;
  try {
    await withHighlighter(tab.id);
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: "orbyn:highlight",
    });
    if (res?.ok)
      await chrome.action.setBadgeText({
        tabId: tab.id,
        text: String(res.count),
      });
  } catch {
    // Pages the browser keeps to itself (settings, stores) can't be marked.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "orbyn-highlight",
    title: "Highlight for Orbyn",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "orbyn-clip",
    title: "Clip this page to Orbyn…",
    contexts: ["page", "selection"],
  });
  chrome.action.setBadgeBackgroundColor({ color: "#376c51" });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "orbyn-highlight") void highlightIn(tab);
  if (info.menuItemId === "orbyn-clip") void chrome.action.openPopup?.();
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "highlight") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  void highlightIn(tab);
});

// "Keep highlights when I come back": with the permission granted in the
// options, the highlighter runs on every page to put them back.
async function syncRestore() {
  const granted = await chrome.permissions.contains({
    origins: ["<all_urls>"],
  });
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: ["orbyn-restore"],
  });
  if (granted && !registered.length)
    await chrome.scripting.registerContentScripts([
      {
        id: "orbyn-restore",
        matches: ["<all_urls>"],
        js: [HIGHLIGHTER],
        runAt: "document_idle",
      },
    ]);
  if (!granted && registered.length)
    await chrome.scripting.unregisterContentScripts({ ids: ["orbyn-restore"] });
}
chrome.permissions.onAdded.addListener(() => void syncRestore());
chrome.permissions.onRemoved.addListener(() => void syncRestore());
chrome.runtime.onStartup.addListener(() => void syncRestore());
