import { useRef, useState } from "react";
import {
  docSelectionContext,
  type DocAskExcerpt,
  type DocSelection,
} from "@orbyn/core";

/** Retain only the excerpt on the wire; owner/source epochs stay local. */
export function useDocExcerpt(
  owner: () => { revision: number; [key: string]: unknown },
  report: (error: unknown) => void,
) {
  const latest = useRef(owner);
  latest.current = owner;
  const captured = useRef<string | null>(null);
  const validate = useRef<(() => boolean) | undefined>(undefined);
  const counter = useRef(0);
  const [context, setContext] = useState<DocAskExcerpt | null>(null);
  return {
    context,
    open(selection: DocSelection) {
      try {
        const state = latest.current();
        if (state.blocked)
          throw new Error(
            "Finish the pending action or resolve the conflict before asking.",
          );
        const selected = docSelectionContext(selection, state.revision);
        captured.current = JSON.stringify(state);
        validate.current = selection.isCurrent;
        setContext({
          selection: selected,
          requestId: ++counter.current,
          explain: selection.explain,
        });
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    },
    current: () =>
      captured.current !== null &&
      captured.current === JSON.stringify(latest.current()) &&
      validate.current?.() !== false,
    clear() {
      captured.current = null;
      setContext(null);
    },
  };
}
