// orbyn.dev: the phone menu, the apps filter and the pricing period. The pages
// read fully without this script; it only adds these three interactions.
(() => {
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
