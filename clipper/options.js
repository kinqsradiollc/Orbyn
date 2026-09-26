import {
  CLIP_TYPES,
  DEFAULT_API,
  orbyn,
  saveSettings,
  settings,
} from "./shared.js";

const $ = (id) => document.getElementById(id);
let rules = [];

function renderRules() {
  const list = $("rules");
  list.replaceChildren();
  rules.forEach((rule, i) => {
    const li = document.createElement("li");
    const host = document.createElement("input");
    host.placeholder = "example.edu";
    host.value = rule.host ?? "";
    host.setAttribute("aria-label", "Site");
    const path = document.createElement("input");
    path.placeholder = "/path (optional)";
    path.value = rule.path ?? "";
    path.setAttribute("aria-label", "Starting with");
    const type = document.createElement("select");
    type.setAttribute("aria-label", "Clip as");
    for (const [id, label] of Object.entries(CLIP_TYPES)) {
      if (id === "highlights") continue;
      const o = document.createElement("option");
      o.value = id;
      o.textContent = label;
      type.append(o);
    }
    type.value = rule.type ?? "article";
    const remove = document.createElement("button");
    remove.className = "link-button";
    remove.textContent = "Remove";
    const keep = () => {
      rules[i] = {
        host: host.value.trim().toLowerCase(),
        ...(path.value.trim() ? { path: path.value.trim() } : {}),
        type: type.value,
      };
      void saveSettings({ rules: rules.filter((r) => r.host) });
    };
    host.onchange = keep;
    path.onchange = keep;
    type.onchange = keep;
    remove.onclick = () => {
      rules.splice(i, 1);
      void saveSettings({ rules });
      renderRules();
    };
    li.append(host, path, type, remove);
    list.append(li);
  });
}

async function start() {
  const s = await settings();
  $("api").value = s.api || DEFAULT_API;
  $("key").value = s.key;
  rules = s.rules ?? [];
  renderRules();
  $("add-rule").onclick = () => {
    rules.push({ host: "", type: "article" });
    renderRules();
  };
  $("restore").checked = await chrome.permissions.contains({
    origins: ["<all_urls>"],
  });
  $("restore").onchange = async (e) => {
    const on = e.target.checked;
    const ok = on
      ? await chrome.permissions.request({ origins: ["<all_urls>"] })
      : await chrome.permissions.remove({ origins: ["<all_urls>"] });
    if (!ok) e.target.checked = !on;
  };
  $("save").onclick = async () => {
    const status = $("status");
    const api = ($("api").value.trim() || DEFAULT_API).replace(/\/+$/, "");
    const key = $("key").value.trim();
    if (key && !key.startsWith("ocl_")) {
      status.textContent = "That isn't a Clipper key. It starts with ocl_.";
      status.className = "error";
      return;
    }
    // Another address than orbyn.dev needs the browser's say-so first.
    const origin = `${new URL(api).origin}/*`;
    if (!(await chrome.permissions.contains({ origins: [origin] })))
      if (!(await chrome.permissions.request({ origins: [origin] }))) {
        status.textContent =
          "The Clipper wasn't allowed to reach that address.";
        status.className = "error";
        return;
      }
    await saveSettings({ api, key });
    status.textContent = "Testing…";
    status.className = "muted";
    try {
      await orbyn("/clips/destinations");
      status.textContent = "Connected.";
      status.className = "done";
    } catch (err) {
      status.textContent = err.message;
      status.className = "error";
    }
  };
}

void start();
