import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cachedPage,
  decodePageCache,
  dropPage,
  encodePageCache,
  keepPage,
  keepTeamPages,
  type CachedPage,
  type Doc,
} from "@orbyn/core";

/**
 * The pages this phone keeps to open with no signal (SHR-03): the last 20
 * opened or saved, for up to 30 days. The rules (how many, how long, what
 * is too old or broken) are in @orbyn/core; this is the storage. Read
 * lazily, and cleared on sign-out with the rest of the phone's copy.
 */
const KEY = "orbyn-page-cache-v1";

let pages: CachedPage[] | null = null;
let loading: Promise<CachedPage[]> | null = null;

async function load(): Promise<CachedPage[]> {
  if (pages) return pages;
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => (pages = decodePageCache(raw)))
    .catch(() => (pages = []));
  return loading;
}

const save = () =>
  void AsyncStorage.setItem(KEY, encodePageCache(pages ?? [])).catch(() => {});

/** A page was opened or saved: keep it, newest first. */
export async function rememberPage(doc: Doc) {
  pages = keepPage(await load(), doc);
  save();
}

/** A page went to Trash or is no longer shared: stop keeping it. */
export async function forgetPage(id: string) {
  pages = dropPage(await load(), id);
  save();
}

/** The teams were read again: drop pages from teams the person has left. */
export async function forgetLostTeams(teamIds: string[]) {
  const before = await load();
  const after = keepTeamPages(before, teamIds);
  if (after.length === before.length) return;
  pages = after;
  save();
}

/**
 * Opening a kept page answered 404 or 403 (deleted for good, or no longer
 * shared): stop keeping it. True when it was that.
 */
export async function forgetIfGone(id: string, e: unknown) {
  const code = (e as { status?: number } | null)?.status;
  if (code !== 404 && code !== 403) return false;
  await forgetPage(id);
  return true;
}

/** A kept page, or null. */
export async function keptPage(id: string): Promise<Doc | null> {
  return cachedPage(await load(), id);
}

/** Every kept page, newest first, for the list with no signal. */
export async function keptPages(): Promise<Doc[]> {
  return (await load()).map((p) => p.doc);
}

/** Signing out: nothing of this account stays on the phone. */
export async function clearPageCache() {
  pages = [];
  loading = null;
  await AsyncStorage.removeItem(KEY).catch(() => {});
}
