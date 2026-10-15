import { createContext, useContext, useEffect, useRef } from "react";

export type CommentDraftGuards = {
  register: (scope: string, guard: () => Promise<boolean>) => () => void;
  prepare: (scope?: string) => Promise<boolean>;
};
export const commentDraftScope = (blockId?: string | null) =>
  blockId ? `block:${blockId}` : "page";
export const CommentDraftContext = createContext<CommentDraftGuards | null>(
  null,
);

/** A page owns its comment drafts, including its page-level composer. */
export function useCommentDraftOwner(): CommentDraftGuards {
  const entries = useRef(
    new Map<object, { scope: string; guard: () => Promise<boolean> }>(),
  );
  const owner = useRef<CommentDraftGuards>({
    register(scope, guard) {
      const key = {};
      entries.current.set(key, { scope, guard });
      return () => {
        entries.current.delete(key);
      };
    },
    async prepare(scope) {
      for (const [key, entry] of entries.current) {
        if (scope !== undefined && scope !== entry.scope) continue;
        if (!(await entry.guard()) || entries.current.get(key) !== entry)
          return false;
      }
      return true;
    },
  });
  useEffect(
    () => () => {
      entries.current.clear();
    },
    [],
  );
  return owner.current;
}

export function useCommentDraftGuard(
  scope: string,
  guard: () => Promise<boolean>,
) {
  const owner = useContext(CommentDraftContext);
  const latest = useRef(guard);
  latest.current = guard;
  useEffect(
    () => owner?.register(scope, () => latest.current()),
    [owner, scope],
  );
}
