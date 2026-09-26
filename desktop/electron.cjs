const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// The desktop shell: one window, plus a system-tray icon so Orbyn can keep
// running in the background. Closing the window hides it to the tray (on
// Windows/Linux) or the Dock (on macOS) rather than quitting; quitting is a
// deliberate choice from the tray menu or the app menu.

let win = null;
let tray = null;
let quitting = false;

// orbyn:// links (orbyn://task/<id>, orbyn://add?text=…): Orbyn registers
// the scheme, and a link opens the one running copy, which hands it to the
// page. Links wait until the page is listening; the page itself decides
// what each one opens, and a link that adds something only fills in Quick
// add for the person to confirm.
const SCHEME = "orbyn";
const waiting = [];
let pageListening = false;

const isOurLink = (value) =>
  typeof value === "string" &&
  value.length <= 2048 &&
  value.toLowerCase().startsWith(`${SCHEME}://`);

const deliver = (url) => {
  if (!isOurLink(url)) return;
  if (win && pageListening) win.webContents.send("orbyn:open-link", url);
  else waiting.push(url);
  if (win) reveal();
};

// Windows and Linux pass the link on the command line.
const linkIn = (argv) => argv.find(isOurLink);

// "Open with Orbyn" (CAP-11): Markdown, Word and PDF files. The file is read
// here and handed to the page, which sends it through the importer (Uploads
// for Word and PDF, a dry run for Markdown), so nothing arrives unreviewed.
const OPENABLE = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
};
const MAX_OPEN_BYTES = 50 * 1024 * 1024;
const filesWaiting = [];
const isOpenable = (value) =>
  typeof value === "string" &&
  !isOurLink(value) &&
  Object.hasOwn(OPENABLE, path.extname(value).toLowerCase());
const fileIn = (argv) => argv.slice(1).filter(isOpenable);

const deliverFile = (file) => {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_OPEN_BYTES) return;
    const opened = {
      name: path.basename(file),
      type: OPENABLE[path.extname(file).toLowerCase()],
      data: fs.readFileSync(file).toString("base64"),
    };
    if (win && pageListening) win.webContents.send("orbyn:open-file", opened);
    else filesWaiting.push(opened);
    if (win) reveal();
  } catch {
    // A file that can't be read is left alone.
  }
};

if (process.defaultApp && process.argv.length >= 2)
  app.setAsDefaultProtocolClient(SCHEME, process.execPath, [
    path.resolve(process.argv[1]),
  ]);
else app.setAsDefaultProtocolClient(SCHEME);

// One copy of Orbyn: a second launch (a link clicked on Windows or Linux)
// hands its link to the first and quits.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on("second-instance", (_event, argv) => {
  const url = linkIn(argv);
  const files = fileIn(argv);
  if (url) deliver(url);
  for (const file of files) deliverFile(file);
  if (!url && !files.length) reveal();
});
// macOS hands over files opened with Orbyn as an event.
app.on("open-file", (event, file) => {
  event.preventDefault();
  if (isOpenable(file)) {
    if (app.isReady()) deliverFile(file);
    else app.whenReady().then(() => deliverFile(file));
  }
});
// macOS delivers links as an event, even before the app is ready.
app.on("open-url", (event, url) => {
  event.preventDefault();
  deliver(url);
});
const launchedWith = linkIn(process.argv);
if (launchedWith) waiting.push(launchedWith);
app.whenReady().then(() => fileIn(process.argv).forEach(deliverFile));

ipcMain.on("orbyn:links-ready", (event) => {
  if (!win || event.sender !== win.webContents) return;
  pageListening = true;
  while (waiting.length)
    win.webContents.send("orbyn:open-link", waiting.shift());
  while (filesWaiting.length)
    win.webContents.send("orbyn:open-file", filesWaiting.shift());
});

// A page in a window of its own (NAV-06): the same app, showing one page
// without the sidebar and library. Closing it closes it (only the main
// window hides to the tray).
const PAGE_WINDOW = /^\/app\/doc\/([0-9a-f-]{36})\?window=page$/i;
ipcMain.handle("orbyn:open-window", (_event, where) => {
  const m = typeof where === "string" ? PAGE_WINDOW.exec(where) : null;
  if (!m) return false;
  const page = new BrowserWindow({
    width: 960,
    height: 900,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: "#f7f8fa",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  page.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  page.webContents.on("will-navigate", (event) => event.preventDefault());
  page.loadFile(path.join(__dirname, "dist/index.html"), {
    query: { open: `orbyn://doc/${m[1].toLowerCase()}`, window: "page" },
  });
  return true;
});

const showWindow = () => {
  if (!win) return create();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

const create = () => {
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#f7f8fa",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  // A reload starts a new page, which asks for links again.
  win.webContents.on("did-start-loading", () => {
    pageListening = false;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, "dist/index.html"));
  // The close button tucks Orbyn away instead of quitting it.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
    if (process.platform === "darwin" && app.dock) app.dock.hide();
  });
  return win;
};

const reveal = () => {
  if (process.platform === "darwin" && app.dock) app.dock.show();
  showWindow();
};

const buildTray = () => {
  // Reuse the app icon, scaled down for the menu bar / system tray.
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "dist/icon-192.png"))
    .resize({ width: 18, height: 18 });
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Orbyn");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Orbyn", click: reveal },
      { type: "separator" },
      {
        label: "Quit Orbyn",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  // A left-click on the tray icon toggles the window.
  tray.on("click", () =>
    win && win.isVisible() && !win.isMinimized() ? win.hide() : reveal(),
  );
};

app.whenReady().then(() => {
  if (!primary) return;
  create();
  buildTray();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) create();
    else reveal();
  });
});

// With a tray, Orbyn keeps running when the window is closed; the tray menu
// (or Cmd/Ctrl-Q) quits it.
app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  // Intentionally left running so the tray stays; quitting is explicit.
});
