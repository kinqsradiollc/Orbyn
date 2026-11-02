import type { Project } from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { watchAccount } from "../../lib/account-events";
import { messageOf } from "../../lib/resource";
import { useRouteActivity } from "../../lib/route-scope";
import { client, getSessionVersion } from "../../lib/session";

/** News areas that can change a project's metadata or its aggregate counts. */
const AREAS = ["projects", "items", "docs", "organize"];
/** Wait before reading after account news, so a burst becomes one read. */
const NEWS_DELAY_MS = 400;
/** Closest two reads may start, so continuous change cannot loop requests. */
const MIN_GAP_MS = 300;

type Lease = { dead: boolean; session: number };
type Snapshot = {
  key: string;
  data: Project | undefined;
  error: string;
  loading: boolean;
  unavailable: boolean;
};

export type ProjectRead = {
  data: Project | undefined;
  error: string;
  loading: boolean;
  /** The project was deleted or is no longer shared with this account. */
  unavailable: boolean;
  /** Read the project now; explicit Retry and known local changes use it. */
  reload: () => Promise<Project | undefined>;
  /** Adopt a project returned by one of this screen's own writes. */
  adoptReceipt: (project: Project) => void;
};

/**
 * The one reader and publisher of the open Project. GET /projects/:id stays
 * authoritative for counts, so item changes and account news only invalidate
 * it. One read runs at a time; a known newer receipt or invalidation fences an
 * older read so its late answer cannot replace newer data. A failed refresh
 * keeps what is showing and reports the error. 403/404 retires the project.
 */
export function useProjectRead(
  id: string,
  userId: string,
  /** Stable signature of this project's task rows; a change invalidates the read. */
  itemsSignature: string,
): ProjectRead {
  const key = `${id}:${userId}`;
  const [snapshot, setSnapshot] = useState<Snapshot>({
    key,
    data: undefined,
    error: "",
    loading: true,
    unavailable: false,
  });
  const { visible } = useRouteActivity();
  const owner = useRef({
    key,
    lease: null as Lease | null,
    ticket: 0,
    active: 0,
    dirty: false,
    deadline: 0,
    startedAt: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    hasData: false,
    visible,
    latest: undefined as Project | undefined,
    waiters: [] as ((project: Project | undefined) => void)[],
  });
  const state = owner.current;
  state.visible = visible;

  const publish = useCallback((lease: Lease, next: Partial<Snapshot>) => {
    if (lease.dead) return;
    setSnapshot((current) =>
      current.key === state.key ? { ...current, ...next } : current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settle = useCallback(() => {
    const waiting = state.waiters.splice(0);
    for (const done of waiting) done(state.latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pump = useCallback(() => {
    const lease = state.lease;
    if (!lease || lease.dead || !state.dirty || state.active) return;
    clearTimeout(state.timer);
    const wait = Math.max(
      state.deadline - Date.now(),
      state.startedAt + MIN_GAP_MS - Date.now(),
      0,
    );
    if (wait > 0) {
      state.timer = setTimeout(pump, wait);
      return;
    }
    state.dirty = false;
    state.deadline = 0;
    state.startedAt = Date.now();
    const ticket = ++state.ticket;
    state.active = ticket;
    void client.getProject(state.key.split(":")[0]).then(
      (project) => {
        if (lease.dead || lease.session !== getSessionVersion()) return;
        state.active = 0;
        // A fenced read may still fill an empty screen; anything newer wins.
        if (ticket === state.ticket || !state.hasData) {
          state.hasData = true;
          state.latest = project;
          publish(lease, {
            data: project,
            error: "",
            loading: false,
            unavailable: false,
          });
        } else publish(lease, { loading: false });
        settle();
        pump();
      },
      (failure: unknown) => {
        if (lease.dead || lease.session !== getSessionVersion()) return;
        state.active = 0;
        const status = (failure as { status?: number }).status;
        if (status === 403 || status === 404) {
          state.hasData = false;
          state.dirty = false;
          publish(lease, {
            data: undefined,
            error: "",
            loading: false,
            unavailable: true,
          });
        } else if (ticket === state.ticket)
          publish(lease, {
            error: messageOf(failure, "Couldn't refresh this project."),
            loading: false,
          });
        else publish(lease, { loading: false });
        settle();
        pump();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Mark the read stale and queue one replacement; the earliest deadline stands. */
  const invalidate = useCallback(
    (delay: number) => {
      const lease = state.lease;
      if (!lease || lease.dead) return;
      state.dirty = true;
      if (state.active && state.hasData) state.ticket++;
      const due = Date.now() + delay;
      state.deadline = state.deadline ? Math.min(state.deadline, due) : due;
      pump();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pump],
  );

  useEffect(() => {
    const lease: Lease = { dead: false, session: getSessionVersion() };
    state.key = key;
    state.lease = lease;
    state.ticket = 0;
    state.active = 0;
    state.dirty = false;
    state.deadline = 0;
    state.startedAt = 0;
    state.hasData = false;
    state.latest = undefined;
    setSnapshot({
      key,
      data: undefined,
      error: "",
      loading: true,
      unavailable: false,
    });
    invalidate(0);
    const hear = () => {
      if (!state.visible) {
        // A hidden retained frame only records that it is stale.
        state.dirty = true;
        return;
      }
      invalidate(NEWS_DELAY_MS);
    };
    const stop = watchAccount((news) => {
      if (news.kind !== "changed") return;
      if (news.area && !AREAS.includes(news.area)) return;
      hear();
    }, hear);
    return () => {
      lease.dead = true;
      if (state.lease === lease) state.lease = null;
      clearTimeout(state.timer);
      stop();
      settle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Task rows of this project changed: read the aggregate again.
  const seen = useRef(itemsSignature);
  useEffect(() => {
    if (seen.current === itemsSignature) return;
    seen.current = itemsSignature;
    if (state.visible) invalidate(0);
    else state.dirty = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsSignature]);

  // A hidden frame catches up when it is shown again.
  useEffect(() => {
    if (visible && state.dirty && !state.active) invalidate(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const adoptReceipt = useCallback(
    (project: Project) => {
      const lease = state.lease;
      if (!lease || lease.dead || lease.session !== getSessionVersion()) return;
      if (project.id !== state.key.split(":")[0]) return;
      state.ticket++;
      state.hasData = true;
      state.latest = project;
      publish(lease, {
        data: project,
        error: "",
        loading: false,
        unavailable: false,
      });
      // A read that started before this receipt may have missed it: ask again.
      if (state.active) invalidate(0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invalidate, publish],
  );

  const reload = useCallback(() => {
    const done = new Promise<Project | undefined>((resolve) =>
      state.waiters.push(resolve),
    );
    publish(state.lease ?? { dead: false, session: 0 }, { loading: true });
    invalidate(0);
    return done;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalidate, publish]);

  if (snapshot.key !== key)
    return {
      data: undefined,
      error: "",
      loading: true,
      unavailable: false,
      reload,
      adoptReceipt,
    };
  return { ...snapshot, reload, adoptReceipt };
}
