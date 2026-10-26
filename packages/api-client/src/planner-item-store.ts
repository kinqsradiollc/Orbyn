import type { Item } from "@orbyn/core";
import type { OrbynClient } from "./client.js";

type Api = Pick<OrbynClient, "reconcileItems" | "syncItems" | "listAllItems">;
export const PLANNER_RECONCILE_MS = 5 * 60_000;
const timestamp = (value: string | undefined) => {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
};
/** One ephemeral, account-bound item owner. Deltas never claim lossless delivery. */
export class PlannerItemStore {
  private items: Item[] = [];
  private listeners = new Set<() => void>();
  private generation = 0;
  private binding: unknown;
  private scope: string | null = null;
  private fullAt = Number.NEGATIVE_INFINITY;
  private after: string | undefined;
  private cursor: string | undefined;
  private legacy = false;
  private request = 0;
  private allowedTeams: ReadonlySet<string> | null = null;
  constructor(
    private api: Api,
    private session: () => unknown,
    private now: () => number = () => performance.now(),
  ) {
    this.binding = session();
  }
  getSnapshot = () => this.items;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(items: Item[]) {
    if (this.allowedTeams)
      items = items.filter(
        (item) => !item.team_id || this.allowedTeams!.has(item.team_id),
      );
    if (
      items.length === this.items.length &&
      items.every((item, index) => item === this.items[index])
    )
      return;
    this.items = items;
    for (const listener of this.listeners) listener();
  }
  reset = () => {
    this.generation++;
    this.binding = this.session();
    this.scope = null;
    this.fullAt = Number.NEGATIVE_INFINITY;
    this.after = undefined;
    this.cursor = undefined;
    this.legacy = false;
    this.allowedTeams = null;
    this.request++;
    this.publish([]);
  };
  /** Offline seed has no cursor; the next connected refresh must reconcile. */
  seed = (items: Item[]) => {
    this.reset();
    this.publish(items);
  };
  /** Membership loss is known authority even when the replacement read fails. */
  restrictTeams = (ids: readonly string[]) => {
    if (this.binding !== this.session()) this.reset();
    const allowed = new Set(ids);
    if (
      !this.allowedTeams ||
      allowed.size !== this.allowedTeams.size ||
      [...allowed].some((id) => !this.allowedTeams!.has(id))
    ) {
      // Fence older reads before the caller awaits a potentially failing disk purge.
      this.request++;
      this.fullAt = Number.NEGATIVE_INFINITY;
    }
    this.allowedTeams = allowed;
    const next = this.items.filter(
      (item) => !item.team_id || allowed.has(item.team_id),
    );
    if (next.length !== this.items.length) {
      this.fullAt = Number.NEGATIVE_INFINITY;
      this.publish(next);
    }
  };
  nextReconcileIn = () =>
    Math.max(0, PLANNER_RECONCILE_MS - (this.now() - this.fullAt));
  async refresh(
    scope: string | null,
    force = false,
    visibleTeamIds?: readonly string[],
  ): Promise<Item[]> {
    if (this.binding !== this.session()) this.reset();
    if (visibleTeamIds) this.restrictTeams(visibleTeamIds);
    const generation = this.generation,
      binding = this.binding,
      request = ++this.request;
    const valid = () =>
      generation === this.generation &&
      binding === this.session() &&
      request === this.request;
    const full =
      force ||
      this.legacy ||
      scope === null ||
      scope !== this.scope ||
      !this.after ||
      this.nextReconcileIn() === 0;
    const reconcile = async () => {
      const started = this.now();
      let items: Item[],
        after: string | undefined,
        legacy = false;
      try {
        const result = await this.api.reconcileItems();
        if (!Number.isFinite(Date.parse(result.updated_after)))
          throw new Error("Invalid planner reconciliation watermark.");
        items = result.items;
        // A small overlap absorbs clock precision; periodic primary snapshots
        // cover late commits, access changes and expired tombstones.
        after = new Date(Date.parse(result.updated_after) - 1000).toISOString();
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
        if (!valid()) return;
        items = await this.api.listAllItems(500);
        legacy = true; // Old servers retain full refreshes, never unsafe deltas.
      }
      if (!valid()) return;
      this.after = after;
      this.cursor = undefined;
      this.scope = scope;
      this.fullAt = started;
      this.legacy = legacy;
      this.publish(items);
    };
    if (full) {
      await reconcile();
      return this.items;
    }
    const map = new Map(this.items.map((item) => [item.id, item]));
    let cursor = this.cursor;
    try {
      for (let page = 0; ; page++) {
        if (page === 20) {
          await reconcile();
          return this.items;
        }
        if (!valid()) return this.items;
        if (this.nextReconcileIn() === 0) {
          await reconcile();
          return this.items;
        }
        const result = await this.api.syncItems(
          {
            ...(cursor ? { cursor } : { updated_after: this.after }),
            include_deleted: true,
            limit: 500,
          },
          { fresh: true, headers: { "x-orbyn-consistency": "primary" } },
        );
        if (!valid()) return this.items;
        for (const item of result.items) {
          const previous = map.get(item.id);
          if (
            previous &&
            (item.version < previous.version ||
              (item.version === previous.version &&
                timestamp(item.updated_at) < timestamp(previous.updated_at)))
          )
            continue;
          map.set(
            item.id,
            previous && JSON.stringify(previous) === JSON.stringify(item)
              ? previous
              : item,
          );
        }
        for (const gone of result.deleted) {
          const previous = map.get(gone.id);
          if (
            !previous ||
            timestamp(gone.deleted_at) >= timestamp(previous.updated_at)
          )
            map.delete(gone.id);
        }
        if (result.has_more && result.next_cursor === cursor)
          throw new Error("Planner delta cursor did not advance.");
        cursor = result.next_cursor;
        if (!result.has_more) break;
      }
    } catch (error) {
      if (!valid()) return this.items;
      if (
        [400, 404, 410, 422].includes(
          (error as { status?: number }).status ?? 0,
        )
      ) {
        await reconcile();
        return this.items;
      }
      throw error; // Failed pages never commit a partial map or cursor.
    }
    if (valid()) {
      if (this.nextReconcileIn() === 0) {
        await reconcile();
        return this.items;
      }
      this.cursor = cursor;
      this.publish(
        [...map.values()].sort(
          (a, b) => timestamp(b.created_at) - timestamp(a.created_at),
        ),
      );
    }
    return this.items;
  }
}
