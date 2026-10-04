/** Install only on the trusted packaged main window. Provider credentials never cross this bridge. */
async function installChatgptBridge({ ipcMain, manager, guard, getWindow }) {
  const {
    chatgptDesktopCommand,
    chatgptDesktopState,
    chatgptDesktopDisconnect,
  } = await import("@orbyn/core");
  const sessionChannel = "orbyn:chatgpt-session";
  const commandChannel = "orbyn:chatgpt";
  ipcMain.handle(sessionChannel, async (event, value) => {
    guard(event);
    try {
      if (
        !value ||
        typeof value !== "object" ||
        Object.keys(value).join(",") !== "token" ||
        (value.token !== null &&
          (typeof value.token !== "string" ||
            value.token.length > 8192 ||
            (value.token !== "" && /[\x00-\x20\x7f]/.test(value.token))))
      )
        throw new Error();
      return chatgptDesktopState.parse(await manager.setSession(value.token));
    } catch {
      throw new Error(
        "The Orbyn session could not be connected to the desktop runtime.",
      );
    }
  });
  ipcMain.handle(commandChannel, async (event, value) => {
    guard(event);
    try {
      const command = chatgptDesktopCommand.parse(value);
      switch (command.action) {
        case "state":
          return chatgptDesktopState.parse(await manager.snapshot());
        case "connect-request":
          return chatgptDesktopState.parse(
            await manager.connectRequest(command.requestId),
          );
        case "connect":
          return chatgptDesktopState.parse(await manager.connect());
        case "select":
          return chatgptDesktopState.parse(
            await manager.select(
              command.registrationId,
              command.selectionRevision,
            ),
          );
        case "reconnect":
          return chatgptDesktopState.parse(
            await manager.reconnect(command.registrationId),
          );
        case "disconnect":
          return chatgptDesktopDisconnect.parse(
            await manager.disconnect(command.registrationId),
          );
        case "verify-plan":
          return chatgptDesktopState.parse(await manager.verifyPlan());
        case "refresh":
          return chatgptDesktopState.parse(await manager.refresh());
        case "set-default":
          return chatgptDesktopState.parse(
            await manager.setDefault(command.model, command.version),
          );
        case "cancel":
          await manager.cancelSignIn();
          return chatgptDesktopState.parse(await manager.snapshot());
      }
    } catch {
      throw new Error(
        "ChatGPT could not complete this action. Retry or reconnect this account.",
      );
    }
  });
  const unsubscribe = manager.subscribe(() => {
    try {
      const window = getWindow();
      if (!window || window.isDestroyed()) return;
      guard({
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame,
      });
      window.webContents.send("orbyn:chatgpt-changed");
    } catch {
      /* Destroyed or navigated windows receive no connection notifications. */
    }
  });
  return () => {
    unsubscribe();
    ipcMain.removeHandler(sessionChannel);
    ipcMain.removeHandler(commandChannel);
  };
}
module.exports = { installChatgptBridge };
