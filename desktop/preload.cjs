// The bridge between the desktop app's window and its main process: orbyn://
// links the app was opened with (a link clicked in another app, or
// Shortcuts), files opened with Orbyn (CAP-11), and opening a page in a
// window of its own (NAV-06). The page asks for links and files once it is
// listening.
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
  onOpenFile: (fn) => {
    const handle = (_event, file) => {
      if (
        file &&
        typeof file.name === "string" &&
        typeof file.type === "string" &&
        typeof file.data === "string"
      )
        fn(file);
    };
    ipcRenderer.on("orbyn:open-file", handle);
    return () => ipcRenderer.removeListener("orbyn:open-file", handle);
  },
  openWindow: (where) => ipcRenderer.invoke("orbyn:open-window", where),
});
