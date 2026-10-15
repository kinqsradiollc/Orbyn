import { createContext, useContext, useEffect, useRef } from "react";

/** Each working pane owns its document actions and title notifications. */
export const PageCommandScope = createContext("main");

export type PageCommands = {
  docId: string;
  title: string;
  run: Partial<Record<string, () => void>>;
  /** Save or reject navigation while keeping the mounted draft available. */
  beforeLeave?: () => Promise<boolean>;
};

type OpenPage = { docId: string; title: string } | null;
type Owner = object;
type Entry = { owner: Owner; commands: PageCommands | null };
const entries = new Map<string, Entry>();
const leaveGuards = new Map<string, Map<Owner, () => Promise<boolean>>>();
const watchers = new Map<string, Set<(page: OpenPage) => void>>();
const told = new Map<string, OpenPage>();

/** Commands of the document in the requested pane. */
export const openPageCommands = (scope = "main") =>
  entries.get(scope)?.commands ?? null;

/** Settle non-document drafts before replacing content in the same pane. */
export async function preparePaneDrafts(scope = "main"): Promise<boolean> {
  try {
    for (const [owner, guard] of leaveGuards.get(scope) ?? []) {
      if (!(await guard()) || leaveGuards.get(scope)?.get(owner) !== guard)
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Only the current editor may approve leaving its pane. */
export async function preparePageLeave(scope = "main"): Promise<boolean> {
  const entry = entries.get(scope);
  try {
    if (!(await preparePaneDrafts(scope))) return false;
    if (!entry?.commands?.beforeLeave) return true;
    const allowed = await entry.commands.beforeLeave();
    return allowed && entries.get(scope)?.owner === entry.owner;
  } catch {
    // The editor retains its draft and its own recovery message.
    return false;
  }
}

function tell(scope: string) {
  const current = openPageCommands(scope);
  const page = current ? { docId: current.docId, title: current.title } : null;
  const previous = told.get(scope);
  if (page?.docId === previous?.docId && page?.title === previous?.title)
    return;
  told.set(scope, page);
  for (const watch of watchers.get(scope) ?? []) watch(page);
}

function releaseUnused(scope: string) {
  if (!entries.has(scope) && !watchers.has(scope)) told.delete(scope);
}

/** Follow page identity/title only within this pane. */
export function watchOpenPage(watch: (page: OpenPage) => void, scope = "main") {
  let listeners = watchers.get(scope);
  if (!listeners) {
    listeners = new Set();
    watchers.set(scope, listeners);
  }
  listeners.add(watch);
  return () => {
    listeners.delete(watch);
    if (!listeners.size) watchers.delete(scope);
    releaseUnused(scope);
  };
}

/** Offer current actions; stale editor cleanup cannot clear a newer editor. */
export function usePageCommands(commands: PageCommands | null) {
  const scope = useContext(PageCommandScope);
  const owner = useRef<Owner>({});
  useEffect(() => {
    entries.set(scope, { owner: owner.current, commands });
    tell(scope);
  });
  useEffect(() => {
    const identity = owner.current;
    return () => {
      if (entries.get(scope)?.owner !== identity) return;
      entries.delete(scope);
      tell(scope);
      releaseUnused(scope);
    };
  }, [scope]);
}

/** Protect non-document drafts without changing the pane's document identity. */
export function usePaneLeaveGuard(guard: () => Promise<boolean>) {
  const scope = useContext(PageCommandScope);
  const owner = useRef<Owner>({});
  const latest = useRef(guard);
  latest.current = guard;
  useEffect(() => {
    const identity = owner.current;
    const invoke = () => latest.current();
    const guards = leaveGuards.get(scope) ?? new Map();
    guards.set(identity, invoke);
    leaveGuards.set(scope, guards);
    return () => {
      guards.delete(identity);
      if (!guards.size) leaveGuards.delete(scope);
    };
  }, [scope]);
}
