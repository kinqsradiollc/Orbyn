import AsyncStorage from "@react-native-async-storage/async-storage";
import { session } from "./session";
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
let generation = 0;
let clearing: Promise<void> | null = null;

async function load(): Promise<CachedPage[]> {
  if (clearing) {
    await clearing;
    return load();
  }
  if (pages) return pages;
  const epoch = generation;
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => (epoch === generation ? (pages = decodePageCache(raw)) : []))
    .catch(() => (epoch === generation ? (pages = []) : []));
  return loading;
}

let writeTail: Promise<void> = Promise.resolve();
const saveStrict = () => {
  const snapshot = encodePageCache(pages ?? []);
  const write = writeTail.then(() => AsyncStorage.setItem(KEY, snapshot));
  writeTail = write.catch(() => {});
  return write;
};
const save = () => void saveStrict().catch(() => {});

/** A page was opened or saved: keep it, newest first. */
export async function rememberPage(doc: Doc) {
  const epoch = generation,
    account = session.token;
  const previous = await load();
  if (!account || account !== session.token || epoch !== generation) return;
  pages = keepPage(previous, doc);
  save();
}

/** A recovery copy with an awaited storage receipt for guarded editor exit. */
export async function rememberPageDurable(doc: Doc, account = session.token) {
  const epoch = generation;
  const previous = await load();
  if (!account || session.token !== account || epoch !== generation)
    return false;
  pages = keepPage(previous, doc);
  await saveStrict();
  return session.token === account && epoch === generation;
}

/** A page went to Trash or is no longer shared: stop keeping it. */
export async function forgetPage(id: string) {
  const epoch = generation,
    account = session.token;
  const previous = await load();
  if (account !== session.token || epoch !== generation) return;
  pages = dropPage(previous, id);
  save();
}

/** The teams were read again: drop pages from teams the person has left. */
export async function forgetLostTeams(teamIds: string[]) {
  const epoch = generation,
    account = session.token;
  const before = await load();
  if (account !== session.token || epoch !== generation) return;
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
export function clearPageCache(): Promise<void> {
  generation++;
  pages = [];
  loading = null;
  const previous = clearing;
  const work = (async () => {
    await previous;
    await writeTail;
    await AsyncStorage.removeItem(KEY).catch(() => {});
  })();
  clearing = work;
  return work.finally(() => {
    if (clearing === work) clearing = null;
  });
}
