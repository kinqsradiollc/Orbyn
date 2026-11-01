import { useLayoutEffect, useRef } from "react";
import { useRouteScope, type RouteScope } from "../../lib/route-scope";
import { getSessionVersion } from "../../lib/session";

export type LibraryLaunchKind = "new.page" | "new.from-template" | "new.import";
export type LibraryLaunchActions = {
  ready(kind: LibraryLaunchKind): boolean;
  available(kind: LibraryLaunchKind): boolean;
  launch(kind: LibraryLaunchKind): void | Promise<unknown>;
};
type TargetEntry = {
  generation: number;
  token: object;
  actions(): LibraryLaunchActions;
};
const targets = new Map<RouteScope, TargetEntry>(),
  changed = new Set<() => void>();
const publish = () => changed.forEach((listener) => listener());

/** The real Collection owns the operation, its draft, and uncertain server outcome. */
export function useLibraryLaunchTarget(actions: LibraryLaunchActions) {
  const opening = useRouteScope(),
    scope = opening?.originScope ?? opening;
  const latest = useRef(actions);
  latest.current = actions;
  useLayoutEffect(() => {
    if (!scope) return;
    const entry: TargetEntry = {
      generation: getSessionVersion(),
      token: {},
      actions: () => latest.current,
    };
    targets.set(scope, entry);
    publish();
    return () => {
      if (targets.get(scope) === entry) {
        targets.delete(scope);
        publish();
      }
    };
  }, [scope]);
  useLayoutEffect(publish, [actions]);
}
export type LibraryLaunchTarget = {
  scope: RouteScope;
  activation: number;
  inputEpoch: number;
};
export type LibraryAdmission =
  | { kind: "ready"; target: LibraryLaunchTarget }
  | { kind: "refused"; reason: string }
  | { kind: "superseded" };
type Pending = {
  token: object;
  kind: LibraryLaunchKind;
  target: LibraryLaunchTarget | null;
  retire(): void;
  resolve(value: LibraryAdmission): void;
};

/** One account-lived handoff owner; no persisted query flags or speculative domain writes. */
export class LibraryLaunchCoordinator {
  private pending: Pending | null = null;
  private alive = true;
  private sequence = 0;
  constructor(
    private readonly generation: number,
    private readonly report: (message: string) => void,
  ) {}
  private current() {
    return this.alive && this.generation === getSessionVersion();
  }
  private valid(target: LibraryLaunchTarget) {
    const snapshot = target.scope.getSnapshot();
    return (
      this.current() &&
      snapshot.pathname === "/app/docs" &&
      !snapshot.search &&
      !snapshot.hash &&
      snapshot.activation === target.activation &&
      typeof snapshot.inputEpoch === "number" &&
      Number.isSafeInteger(snapshot.inputEpoch) &&
      snapshot.inputEpoch >= 0 &&
      snapshot.inputEpoch === target.inputEpoch &&
      snapshot.visible &&
      snapshot.focused
    );
  }
  async request(
    kind: LibraryLaunchKind,
    admit: () => Promise<LibraryAdmission>,
  ): Promise<void> {
    if (!this.current()) return;
    if (this.pending) {
      this.report("Finish the current Library action before starting another.");
      return;
    }
    const token = {},
      sequence = ++this.sequence;
    let resolve!: (value: LibraryAdmission) => void;
    const finished = new Promise<LibraryAdmission>((done) => {
      resolve = done;
    });
    const pending: Pending = {
      token,
      kind,
      target: null,
      retire: () => {},
      resolve,
    };
    this.pending = pending;
    try {
      // The existing route/controller owner settles the captured actual origin before admission.
      const admission = await admit();
      if (
        !this.current() ||
        this.pending !== pending ||
        sequence !== this.sequence
      )
        return;
      if (admission.kind !== "ready") {
        this.finish(pending, admission);
        if (admission.kind === "refused") this.report(admission.reason);
        return;
      }
      pending.target = admission.target;
      if (!this.valid(admission.target)) {
        this.finish(pending, { kind: "superseded" });
        return;
      }
      const cancel = () =>
        this.finish(pending, {
          kind: "refused",
          reason:
            "Library opened. The requested action was cancelled because you started another action.",
        });
      const check = () => {
        if (!this.valid(admission.target))
          this.finish(pending, { kind: "superseded" });
        else
          void this.claim(pending).catch((error) =>
            this.finish(pending, {
              kind: "refused",
              reason:
                error instanceof Error
                  ? error.message
                  : "Couldn't check the Library action.",
            }),
          );
      };
      const off = admission.target.scope.subscribe(check);
      changed.add(check);
      // Native input after navigation belongs to the user, not to an earlier command.
      document.addEventListener("pointerdown", cancel, true);
      document.addEventListener("keydown", cancel, true);
      document.addEventListener("input", cancel, true);
      const timeout = setTimeout(
        () =>
          this.finish(pending, {
            kind: "refused",
            reason:
              "Library opened, but its creation controls haven't become ready. Try the command again.",
          }),
        20_000,
      );
      pending.retire = () => {
        off();
        changed.delete(check);
        clearTimeout(timeout);
        document.removeEventListener("pointerdown", cancel, true);
        document.removeEventListener("keydown", cancel, true);
        document.removeEventListener("input", cancel, true);
      };
      check();
      const result = await finished;
      if (this.current() && result.kind === "refused")
        this.report(result.reason);
    } catch (error) {
      if (this.pending === pending)
        this.finish(pending, {
          kind: "refused",
          reason:
            error instanceof Error
              ? error.message
              : "Couldn't open the Library action.",
        });
      if (this.current())
        this.report(
          error instanceof Error
            ? error.message
            : "Couldn't open the Library action.",
        );
    } finally {
      if (this.pending === pending)
        this.finish(pending, { kind: "superseded" });
    }
  }
  private async claim(pending: Pending) {
    const target = pending.target;
    if (!target || this.pending !== pending || !this.valid(target)) return;
    const entry = targets.get(target.scope);
    if (!entry || entry.generation !== this.generation) return;
    const actions = entry.actions();
    if (!actions.ready(pending.kind)) return;
    if (!actions.available(pending.kind)) {
      this.finish(pending, {
        kind: "refused",
        reason:
          "Resolve the open Library draft or pending operation before starting this action.",
      });
      return;
    }
    // Consume once in the same stack as dispatch. Later input belongs to the accepted domain owner.
    pending.retire();
    pending.retire = () => {};
    pending.target = null;
    try {
      if (
        !this.current() ||
        targets.get(target.scope) !== entry ||
        !this.valid(target) ||
        !entry.actions().available(pending.kind)
      ) {
        this.finish(pending, { kind: "superseded" });
        return;
      }
      await entry.actions().launch(pending.kind);
      this.finish(pending, { kind: "ready", target });
    } catch (error) {
      this.finish(pending, {
        kind: "refused",
        reason:
          error instanceof Error
            ? error.message
            : "Couldn't start that Library action.",
      });
    }
  }
  private finish(pending: Pending, result: LibraryAdmission) {
    if (this.pending !== pending) return;
    pending.retire();
    this.pending = null;
    pending.resolve(result);
  }
  activate() {
    if (this.generation === getSessionVersion()) this.alive = true;
  }
  destroy() {
    this.alive = false;
    this.sequence++;
    if (this.pending) this.finish(this.pending, { kind: "superseded" });
  }
}
