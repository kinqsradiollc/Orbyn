/**
 * A random UUID (version 4), made on the device. Used where the device has to
 * name something before the server has seen it — a task made offline, a
 * focus session — so a retry is the same thing, never a second one.
 *
 * Uses the platform's secure generator when there is one (every browser,
 * Node, and React Native with a crypto polyfill), and falls back to
 * Math.random otherwise; these ids name records, they are not secrets.
 */
type RandomSource = {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
};

export function newId(): string {
  const c = (globalThis as { crypto?: RandomSource }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
