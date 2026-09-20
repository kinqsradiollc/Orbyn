const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  shell,
} = require("electron");
const path = require("node:path");

// The desktop shell: one window, plus a system-tray icon so Orbyn can keep
// running in the background. Closing the window hides it to the tray (on
// Windows/Linux) or the Dock (on macOS) rather than quitting; quitting is a
// deliberate choice from the tray menu or the app menu.

let win = null;
let tray = null;
let quitting = false;

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
    },
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
