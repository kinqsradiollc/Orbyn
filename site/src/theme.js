// Runs in <head> before first paint: apply the theme chosen in this browser.
// No stored choice means System, which the stylesheet resolves from the device.
try {
  const t = localStorage.getItem("orbyn-theme");
  if (t === "light" || t === "dark" || t === "dim") document.documentElement.dataset.theme = t;
} catch {}
