// The bridge between the desktop app's window and its main process, kept to
// one thing: orbyn:// links the app was opened with (a link clicked in
// another app, or Shortcuts). The page asks for them once it is listening.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("orbynDesktop", {
  onOpenLink: (fn) => {
    const handle = (_event, url) => {
      if (typeof url === "string") fn(url);
    };
    ipcRenderer.on("orbyn:open-link", handle);
    ipcRenderer.send("orbyn:links-ready");
    return () => ipcRenderer.removeListener("orbyn:open-link", handle);
  },
});
