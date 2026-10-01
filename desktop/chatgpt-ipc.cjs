const path = require("node:path");
const { fileURLToPath } = require("node:url");

/** Bind private credential operations to the packaged main window, never child frames. */
function createChatgptIpcGuard({ getWindow, entryFile }) {
  if (typeof getWindow !== "function" || !path.isAbsolute(entryFile))
    throw new Error("Invalid ChatGPT desktop entrypoint.");
  const allowedPath = path.resolve(entryFile);
  return (event) => {
    try {
      const window = getWindow();
      if (!window || window.isDestroyed()) throw new Error();
      const contents = window.webContents;
      if (
        contents.isDestroyed() ||
        event?.sender !== contents ||
        !event.senderFrame ||
        event.senderFrame !== contents.mainFrame
      )
        throw new Error();
      const location = new URL(event.senderFrame.url);
      if (
        location.protocol !== "file:" ||
        location.hostname ||
        location.username ||
        location.password ||
        path.resolve(fileURLToPath(location)) !== allowedPath
      )
        throw new Error();
      // Check both the invoking frame and its current owning page. A navigated
      // window must not inherit trust from a queued event with an old URL.
      const current = new URL(contents.getURL());
      if (
        current.protocol !== "file:" ||
        current.hostname ||
        current.username ||
        current.password ||
        path.resolve(fileURLToPath(current)) !== allowedPath
      )
        throw new Error();
      return contents;
    } catch {
      const error = new Error("This page cannot access ChatGPT connections.");
      error.code = "AUTH_IPC";
      throw error;
    }
  };
}

module.exports = { createChatgptIpcGuard };
