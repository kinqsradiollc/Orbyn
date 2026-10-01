/** Use only the API address baked into this build; no renderer-supplied endpoints. */
function desktopChatgptConfiguration(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).sort().join(",") !== "apiBaseUrl,version" ||
    value.version !== 1 ||
    typeof value.apiBaseUrl !== "string" ||
    !value.apiBaseUrl ||
    value.apiBaseUrl.length > 4096
  )
    throw new Error("The desktop connection configuration is unavailable.");
  let base;
  try {
    base = new URL(value.apiBaseUrl);
  } catch {
    throw new Error("The desktop connection configuration is unavailable.");
  }
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
  )
    throw new Error("Use a secure API address for desktop connections.");
  return { apiBaseUrl: base.origin + base.pathname.replace(/\/+$/, "") };
}
module.exports = { desktopChatgptConfiguration };
