import { lazy, Suspense, useSyncExternalStore, useLayoutEffect } from "react";
import { RouteScopeProvider } from "../../lib/route-scope";
import { Dialog, Loading } from "../../ui/kit";
import { SettingsOwner } from "./SettingsOwner";
const Settings = lazy(() => import("../../screens/settings"));
/** Exactly one non-retained Settings owner; lazy loading does not release modal input to frames. */
export function SettingsOverlay({ owner }: { owner: SettingsOwner }) {
  const overlay = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  useLayoutEffect(() => {
    if (!overlay) owner.restoreClosedFocus();
  }, [owner, overlay]);
  if (!overlay) return null;
  return (
    <RouteScopeProvider value={owner.scope}>
      <Suspense
        fallback={
          <Dialog title="Settings" onClose={() => void owner.close()}>
            <Loading label="Opening Settings" />
          </Dialog>
        }
      >
        <Settings />
      </Suspense>
    </RouteScopeProvider>
  );
}
