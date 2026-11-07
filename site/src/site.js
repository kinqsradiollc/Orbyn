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
    try { if (t === "system") localStorage.removeItem("orbyn-theme"); else localStorage.setItem("orbyn-theme", t); } catch {}
    sync();
    setTimeout(() => root.classList.remove("th-anim"), 200);
  };
  sync();

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
  addEventListener("storage", (e) => { if (e.key === "orbyn-theme") { if (e.newValue) root.dataset.theme = e.newValue; else delete root.dataset.theme; sync(); } });

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
