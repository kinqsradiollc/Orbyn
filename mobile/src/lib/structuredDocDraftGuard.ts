import { docEditorSessionDirty } from "@orbyn/core";
import type { DocEditorStoreState } from "@orbyn/api-client";

/** A queued tree never makes a newer invalid source buffer safe to leave. */
export function canLeaveStructuredDocDraft(
  state: DocEditorStoreState,
  offlineQueued: boolean,
): boolean {
  if (!state.session) return true;
  if (
    state.sourceInvalid ||
    state.conflict ||
    (state.source !== null && state.error)
  )
    return false;
  return (
    offlineQueued || (!docEditorSessionDirty(state.session) && !state.error)
  );
}
