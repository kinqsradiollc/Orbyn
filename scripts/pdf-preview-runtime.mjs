import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// Bundled, in-process worker: no worker URL, CDN, network or host DOM access.
globalThis.pdfjsWorker = { WorkerMessageHandler };
const canvas = document.querySelector("canvas"),
  status = document.querySelector("#status"),
  pageLabel = document.querySelector("#page"),
  text = document.querySelector("#text");
let pdf,
  loading,
  render,
  generation = 0,
  drawing = 0,
  page = 1,
  zoom = 1,
  latest;
const button = (name) => document.querySelector(`[data-action="${name}"]`);
async function draw() {
  if (!pdf) return;
  render?.cancel();
  const drawTicket = ++drawing;
  const ticket = generation,
    current = pdf,
    target = page;
  try {
    const sheet = await current.getPage(target);
    if (
      drawTicket !== drawing ||
      ticket !== generation ||
      current !== pdf ||
      target !== page
    )
      return;
    const natural = sheet.getViewport({ scale: 1 });
    const width = Math.max(180, document.documentElement.clientWidth - 24);
    const scale = Math.min(
      4,
      (width / natural.width) * zoom,
      8192 / natural.width,
      8192 / natural.height,
    );
    const viewport = sheet.getViewport({ scale });
    const dpr = Math.min(
      2,
      window.devicePixelRatio || 1,
      Math.sqrt(12_000_000 / (viewport.width * viewport.height)),
    );
    canvas.width = Math.ceil(viewport.width * dpr);
    canvas.height = Math.ceil(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    render = sheet.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
      transform: [dpr, 0, 0, dpr, 0, 0],
    });
    await render.promise;
    if (drawTicket !== drawing || ticket !== generation || current !== pdf)
      return;
    const content = await sheet.getTextContent();
    if (
      drawTicket !== drawing ||
      ticket !== generation ||
      current !== pdf ||
      target !== page
    )
      return;
    text.textContent = content.items.map((item) => item.str ?? "").join(" ");
    canvas.setAttribute("aria-label", `PDF page ${page} of ${pdf.numPages}`);
    pageLabel.textContent = `${page} / ${pdf.numPages}`;
    button("previous").disabled = page <= 1;
    button("next").disabled = page >= pdf.numPages;
    button("out").disabled = zoom <= 0.5;
    button("in").disabled = zoom >= 3;
    status.textContent = "";
    button("retry").hidden = true;
    document.body.dataset.rendered = String(latest?.id ?? "");
  } catch (error) {
    if (error?.name !== "RenderingCancelledException" && ticket === generation)
      fail();
  }
}
function fail() {
  status.textContent = "Couldn’t display this PDF. Try again.";
  button("retry").hidden = false;
}
async function receive(event) {
  if (event.source && event.source !== window.parent && event.source !== window)
    return;
  let request;
  try {
    request =
      typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }
  if (
    request?.type !== "orbyn-pdf" ||
    typeof request.data !== "string" ||
    request.data.length > 36_000_000 ||
    !Number.isSafeInteger(request.id)
  )
    return;
  const unchanged = latest?.id === request.id && latest.data === request.data;
  for (const key of ["surface", "text", "muted", "border"])
    if (typeof request.palette?.[key] === "string")
      document.documentElement.style.setProperty(
        `--${key}`,
        request.palette[key],
      );
  document.documentElement.style.setProperty(
    "--control-h",
    request.controls === "compact" ? "32px" : "44px",
  );
  document.documentElement.style.setProperty(
    "--control-fs",
    request.controls === "compact" ? "13px" : "15px",
  );
  if (unchanged) return;
  latest = request;
  await load();
}
async function load() {
  const ticket = ++generation;
  render?.cancel();
  pdf = null;
  status.textContent = "Loading preview…";
  button("retry").hidden = true;
  try {
    await loading?.destroy();
    if (ticket !== generation) return;
    const bytes = Uint8Array.from(atob(latest.data), (char) =>
      char.charCodeAt(0),
    );
    loading = getDocument({
      data: bytes,
      isEvalSupported: false,
      useWasm: false,
      isImageDecoderSupported: false,
      disableAutoFetch: true,
      disableStream: true,
    });
    const result = await loading.promise;
    if (ticket !== generation) {
      await result.destroy();
      return;
    }
    pdf = result;
    page = Math.min(Math.max(1, page), pdf.numPages);
    await draw();
  } catch {
    if (ticket === generation) fail();
  }
}
button("previous").onclick = () => {
  if (pdf && page > 1) {
    page--;
    void draw();
  }
};
button("next").onclick = () => {
  if (pdf && page < pdf.numPages) {
    page++;
    void draw();
  }
};
button("out").onclick = () => {
  zoom = Math.max(0.5, zoom - 0.25);
  void draw();
};
button("in").onclick = () => {
  zoom = Math.min(3, zoom + 0.25);
  void draw();
};
button("retry").onclick = () => void load();
let timer;
new ResizeObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(() => void draw(), 100);
}).observe(document.documentElement);
window.addEventListener("message", receive);
document.addEventListener("message", receive);
