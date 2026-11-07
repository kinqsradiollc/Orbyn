// orbyn.dev: the theme switch, the phone menu, the apps filter and the pricing
// period. The pages read fully without this script.
(() => {
  // Theme. System (no stored choice) follows the device live through CSS.
  const root = document.documentElement;
  const LABELS = { system: "System", light: "Light", dark: "Dark", dim: "Dim" };
  const current = () => root.dataset.theme || "system";
  const sync = () => {
    const t = current();
    document.querySelectorAll("[data-theme-choice]").forEach((el) => el.setAttribute("aria-checked", String(el.dataset.themeChoice === t)));
    const b = document.getElementById("theme-btn");
    if (b) b.setAttribute("aria-label", `Theme: ${LABELS[t]}`);
  };
  const applyTheme = (t) => {
    // Every surface changes colour together in 150 ms (Motion Designs "Theme switch").
    root.classList.add("th-anim");
    if (t === "system") delete root.dataset.theme; else root.dataset.theme = t;
    try { if (t === "system") localStorage.removeItem("orbyn-th"); else localStorage.setItem("orbyn-th", t); } catch {}
    sync();
    tellPreviews();
    setTimeout(() => root.classList.remove("th-anim"), 200);
  };
  sync();

  // Previews start loading once the page itself has loaded, and only when they
  // come within 400px of the viewport, so they never hold up the page's paint.
  // A preview in a hidden layout (desktop or phone only) never loads.
  // The home hero (loading="eager") starts at once if it is in a visible layout.
  const watch = (frames) => {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      e.target.src = e.target.dataset.src;
    }), { rootMargin: "400px 0px" });
    frames.forEach((f) => io.observe(f));
  };
  watch(document.querySelectorAll('iframe.pvf[data-src][loading="eager"]'));
  const startPreviews = () => watch(document.querySelectorAll('iframe.pvf[data-src][loading="lazy"]'));
  if (document.readyState === "complete") startPreviews(); else addEventListener("load", startPreviews, { once: true });

  // Previews (iframes) get the resolved theme: light, dark or dim.
  const darkMq = matchMedia("(prefers-color-scheme: dark)");
  const resolved = () => root.dataset.theme || (darkMq.matches ? "dark" : "light");
  const previews = () => document.querySelectorAll("iframe.pvf");
  const send = (f, m) => { try { f.contentWindow.postMessage(m, location.origin); } catch {} };
  const tellPreviews = () => previews().forEach((f) => send(f, { type: "orbyn-theme", value: resolved() }));
  document.addEventListener("load", (e) => { if (e.target instanceof HTMLIFrameElement && e.target.classList.contains("pvf")) send(e.target, { type: "orbyn-theme", value: resolved() }); }, true);
  darkMq.addEventListener("change", () => { if (!root.dataset.theme) tellPreviews(); });
  // A walkthrough under reduced motion shows captioned stills and reports their height.
  addEventListener("message", (e) => {
    const d = e.data;
    if (e.origin !== location.origin || !d || d.type !== "orbyn-height") return;
    previews().forEach((f) => {
      if (f.contentWindow !== e.source) return;
      const box = f.closest(".pvb");
      if (!box) return;
      if (d.value > 0) { box.style.aspectRatio = "auto"; box.style.height = `${Math.round(d.value)}px`; }
      else { box.style.aspectRatio = ""; box.style.height = ""; }
    });
  });

  const tbtn = document.getElementById("theme-btn");
  const tmenu = document.getElementById("theme-menu");
  if (tbtn && tmenu) {
    const items = [...tmenu.querySelectorAll(".mi")];
    const open = (focusIndex) => {
      tbtn.setAttribute("aria-expanded", "true");
      tmenu.classList.add("open");
      const i = focusIndex ?? Math.max(0, items.findIndex((x) => x.getAttribute("aria-checked") === "true"));
      items[i].focus();
    };
    const close = (refocus) => {
      tbtn.setAttribute("aria-expanded", "false");
      tmenu.classList.remove("open");
      if (refocus) tbtn.focus();
    };
    tbtn.addEventListener("click", () => (tbtn.getAttribute("aria-expanded") === "true" ? close(false) : open()));
    tbtn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(e.key === "ArrowUp" ? items.length - 1 : 0); }
    });
    items.forEach((it, i) => {
      it.addEventListener("click", () => { applyTheme(it.dataset.themeChoice); close(true); });
      it.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus(); }
        else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
        else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
        else if (e.key === "Escape") { e.preventDefault(); close(true); }
        else if (e.key === "Tab") close(false);
      });
    });
    document.addEventListener("click", (e) => { if (!tmenu.contains(e.target) && !tbtn.contains(e.target)) close(false); });
  }
  // Phone: the four-part switch in the menu sheet; the sheet stays open.
  document.querySelectorAll(".thseg [data-theme-choice]").forEach((b) => b.addEventListener("click", () => applyTheme(b.dataset.themeChoice)));
  // Another tab changed the theme.
  addEventListener("storage", (e) => { if (e.key === "orbyn-th") { if (e.newValue) root.dataset.theme = e.newValue; else delete root.dataset.theme; sync(); tellPreviews(); } });

  // Phone: tap a key screen to open it full size in a sheet that scrolls sideways
  // (Motion Designs "Phone bottom sheet": drag down past 25% to dismiss).
  const sheet = document.getElementById("pvsheet");
  if (sheet) {
    const panel = sheet.querySelector(".pvsheet");
    const holder = sheet.querySelector(".pvfull");
    const title = document.getElementById("pvsheet-title");
    let opener = null, closing = 0;
    const close = () => {
      if (!sheet.classList.contains("open")) return;
      sheet.classList.remove("open");
      const done = () => { closing = 0; sheet.hidden = true; holder.textContent = ""; };
      closing = setTimeout(done, matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 210);
      document.removeEventListener("keydown", onKey);
      if (opener) opener.focus();
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") {
        const f = [...sheet.querySelectorAll("button, [tabindex='0']")];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.querySelectorAll(".pvtap").forEach((btn) => btn.addEventListener("click", () => {
      if (sheet.classList.contains("open")) return;
      clearTimeout(closing); closing = 0;
      opener = btn;
      title.textContent = btn.dataset.title;
      const f = document.createElement("iframe");
      f.className = "pvf";
      f.src = `/previews/${btn.dataset.open}.html`;
      f.title = `${btn.querySelector("iframe").title}, full size`;
      f.tabIndex = -1;
      holder.replaceChildren(f);
      sheet.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add("open")));
      sheet.querySelector("button[data-close]").focus();
      document.addEventListener("keydown", onKey);
    }));
    sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
    // Drag the header down to dismiss.
    const head = sheet.querySelector(".pvsh2");
    let startY = null;
    head.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; startY = e.clientY; sheet.classList.add("drag"); head.setPointerCapture(e.pointerId); });
    head.addEventListener("pointermove", (e) => { if (startY === null) return; panel.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`; });
    const end = (e) => {
      if (startY === null) return;
      const moved = Math.max(0, e.clientY - startY);
      startY = null;
      sheet.classList.remove("drag");
      panel.style.transform = "";
      if (moved > panel.offsetHeight * 0.25) close();
    };
    head.addEventListener("pointerup", end);
    head.addEventListener("pointercancel", end);
  }

  const btn = document.querySelector(".menu-btn");
  const menu = document.getElementById("menu");
  if (btn && menu) {
    const set = (open) => {
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", open ? "Close menu" : "Menu");
      menu.classList.toggle("open", open);
    };
    btn.addEventListener("click", () => set(btn.getAttribute("aria-expanded") !== "true"));
    menu.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) set(false); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu.classList.contains("open")) { set(false); btn.focus(); }
    });
    matchMedia("(min-width: 641px)").addEventListener("change", (e) => { if (e.matches) set(false); });
  }

  const pills = document.querySelectorAll("[data-filter]");
  pills.forEach((pill) => pill.addEventListener("click", () => {
    const group = pill.dataset.filter;
    pills.forEach((p) => p.setAttribute("aria-pressed", String(p === pill)));
    document.querySelectorAll("#catalog [data-group]").forEach((card) => {
      card.hidden = group !== "All" && card.dataset.group !== group;
    });
  }));

  // Copy an address without a mailto link (designer spec: "Copied" for 2 s;
  // if the clipboard is blocked, select the address and say how to copy it).
  document.querySelectorAll("[data-copy]").forEach((b) => {
    const card = b.closest(".sec-card");
    const status = card.querySelector("[role=status]");
    const err = card.nextElementSibling?.classList.contains("copyerr") ? card.nextElementSibling : null;
    const addr = card.querySelector(".addr");
    let timer;
    b.addEventListener("click", async () => {
      clearTimeout(timer);
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        if (err) err.hidden = true;
        b.classList.add("done");
        status.textContent = "Address copied";
        timer = setTimeout(() => { b.classList.remove("done"); status.textContent = ""; }, 2000);
      } catch {
        b.classList.remove("done");
        const range = document.createRange();
        range.selectNodeContents(addr);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
        const key = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘C" : "Ctrl+C";
        const msg = `Couldn’t copy automatically. The address is selected, so press ${key}.`;
        if (err) { err.textContent = msg; err.hidden = false; }
        status.textContent = msg;
      }
    });
    card.addEventListener("focusout", (e) => { if (err && !card.contains(e.relatedTarget)) err.hidden = true; });
  });

  const seg = document.querySelector(".segx");
  if (seg) {
    seg.classList.add("js");
    const thumb = seg.querySelector(".thumb");
    const buttons = seg.querySelectorAll("button");
    const place = (b) => {
      thumb.style.width = b.offsetWidth + "px";
      thumb.style.transform = `translateX(${b.offsetLeft - 2}px)`;
    };
    const choose = (b) => {
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      place(b);
      const yearly = b.dataset.period === "year";
      document.querySelectorAll(".amt[data-month]").forEach((amt) => {
        amt.querySelector(".v").textContent = yearly ? amt.dataset.year : amt.dataset.month;
        const small = amt.querySelector("small");
        if (small.textContent) small.textContent = yearly ? "/ year" : "/ month";
      });
    };
    buttons.forEach((b) => b.addEventListener("click", () => choose(b)));
    const current = () => seg.querySelector('[aria-pressed="true"]');
    thumb.style.transition = "none";
    place(current());
    requestAnimationFrame(() => { thumb.style.transition = ""; });
    new ResizeObserver(() => place(current())).observe(seg);
  }
})();
