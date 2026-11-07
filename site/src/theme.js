// Runs in <head> before first paint: apply the theme chosen in this browser.
// No stored choice means System, which the stylesheet resolves from the device.
try {
  let t = localStorage.getItem("orbyn-th");
  // The first release stored the choice as "orbyn-theme"; carry it over once.
  const old = localStorage.getItem("orbyn-theme");
  if (old !== null) { if (t === null && old) { t = old; localStorage.setItem("orbyn-th", old); } localStorage.removeItem("orbyn-theme"); }
  if (t === "light" || t === "dark" || t === "dim") document.documentElement.dataset.theme = t;
} catch {}
