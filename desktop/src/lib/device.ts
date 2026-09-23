/**
 * This browser (or the desktop app) as one of the person's devices: an id
 * made once and kept, the kind of app, and a name they'd recognise.
 */
const KEY = "orbyn-device-id";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

let cached: string | null = null;

/** Made on first use and kept in this browser, so a device stays one row. */
export function deviceId() {
  if (cached) return cached;
  let id = read(KEY);
  if (!id) {
    id = `d-${crypto.randomUUID()}`;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // Private windows: a new id per visit is fine.
    }
  }
  cached = id;
  return id;
}

/** The desktop app loads the page from a file; the browser from the web. */
export const devicePlatform = (): "desktop" | "web" =>
  location.protocol === "file:" || /Electron/i.test(navigator.userAgent)
    ? "desktop"
    : "web";

/** "Mac · desktop app", "Windows · Chrome". */
export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua)
    ? "iPad"
    : /Mac OS X/.test(ua)
      ? "Mac"
      : /Windows/.test(ua)
        ? "Windows"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "Computer";
  if (devicePlatform() === "desktop") return `${os} · desktop app`;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "browser";
  return `${os} · ${browser}`;
}
