import { hasSystemPermission, type SystemPermission } from "@orbyn/core";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ScreenProps } from "../../app/routes";
import { useAccount } from "../../app/account";
import { getSessionVersion } from "../../lib/session";
import { useNavigate, useBeforeNavigate, useTitle } from "../../lib/router";
import { Button, SelectBox, useConfirm, useToast } from "../../ui/kit";
import { AdminContext, type ExitState } from "./shared";
import { People } from "./people";
import { Observe } from "./observe";
import { Infrastructure } from "./infrastructure";
import { Models } from "./models";
import { Publisher } from "./publisher";
import "./admin.css";
const AREAS = [
  ["overview", "Overview", "admin:access"],
  ["users", "Accounts", "users:read"],
  ["teams", "Teams", "teams:read_all"],
  ["audit", "Audit log", "audit:read"],
  ["analytics", "Usage", "analytics:read"],
  ["requests", "Requests", "requests:read"],
  ["database", "Database", "system:manage"],
  ["storage", "Storage", "system:manage"],
  ["ai", "AI providers", "ai:manage"],
  ["agents", "Agent access", "system:manage"],
  ["publishing", "Publishing", "system:manage"],
  ["system", "System", "system:manage"],
  ["legal", "Legal", "system:manage"],
] as const;
export default function AdminScreen(props: ScreenProps) {
  return <AdminRoot key={getSessionVersion()} {...props} />;
}
function AdminRoot({ params }: ScreenProps) {
  const navigate = useNavigate();
  useTitle("Administration");
  const account = useAccount(),
    identity = useRef({ role: account.user?.role, id: account.user?.id ?? "" });
  identity.current = { role: account.user?.role, id: account.user?.id ?? "" };
  const guards = useRef(new Set<() => ExitState>()),
    checking = useRef(false),
    operation = useRef<object | null>(null),
    ask = useConfirm(),
    toast = useToast();
  const [area, setArea] = useState(
    AREAS.some((a) => a[0] === params.section) ? params.section : "overview",
  );
  const generation = useRef(getSessionVersion()).current;
  const canLeave = useCallback(async () => {
    if (checking.current) return false;
    const values = [...guards.current].map((read) => read());
    if (operation.current || values.some((v) => v.pending || v.sensitive)) {
      toast({
        text: "Finish the pending change or save the private receipt before leaving Admin.",
        error: true,
      });
      return false;
    }
    if (!values.some((v) => v.dirty)) return true;
    checking.current = true;
    try {
      return (
        generation === getSessionVersion() &&
        (await ask({
          title: "Discard unsaved admin changes?",
          body: "Only unsaved form values will be discarded.",
          action: "Discard changes",
          danger: true,
        })) &&
        generation === getSessionVersion()
      );
    } finally {
      checking.current = false;
    }
  }, [ask, toast, generation]);
  const context = useMemo(
    () => ({
      current: () => identity.current,
      register: (read: () => ExitState) => {
        guards.current.add(read);
        return () => {
          guards.current.delete(read);
        };
      },
      leave: canLeave,
      acquire: (lease: object) => {
        if (checking.current) return false;
        if (operation.current && operation.current !== lease) return false;
        if (
          [...guards.current].some((read) => read().sensitive || read().pending)
        )
          return false;
        operation.current = lease;
        return true;
      },
      release: (lease: object) => {
        if (operation.current === lease) operation.current = null;
      },
    }),
    [canLeave],
  );
  useLayoutEffect(() => {
    setArea(
      AREAS.some((a) => a[0] === params.section) ? params.section : "overview",
    );
  }, [params.section]);
  useBeforeNavigate(canLeave);
  useLayoutEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (
        checking.current ||
        [...guards.current].some((read) => {
          const s = read();
          return s.dirty || s.pending || s.sensitive;
        })
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function choose(next: string) {
    if (next !== area) navigate("/app/admin/" + next);
  }
  const allowed = hasSystemPermission(account.user?.role, "admin:access"),
    available = AREAS.filter((a) =>
      hasSystemPermission(account.user?.role, a[2] as SystemPermission),
    );
  return (
    <AdminContext.Provider value={context}>
      {!allowed ? (
        <div className="page">
          <h1>Administration</h1>
          <p>
            {account.loading
              ? "Checking account permissions…"
              : "A system administrator account is required."}
          </p>
        </div>
      ) : (
        <div className="admin-page">
          <header>
            <h1>Administration</h1>
            <p className="muted">People, services and workspace controls</p>
          </header>
          <div className="admin-work">
            <nav aria-label="Admin areas">
              <SelectBox
                aria-label="Admin area"
                value={area}
                onChange={(e) => void choose(e.target.value)}
              >
                {available.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </SelectBox>
              <div className="admin-area-buttons">
                {available.map(([id, label]) => (
                  <Button
                    key={id}
                    variant="ghost"
                    aria-current={area === id ? "page" : undefined}
                    onClick={() => void choose(id)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </nav>
            <main key={area}>
              {!available.some((a) => a[0] === area) ? (
                <p>This admin area is unavailable.</p>
              ) : ["users", "teams"].includes(area) ? (
                <People area={area} />
              ) : ["overview", "audit", "analytics", "requests"].includes(
                  area,
                ) ? (
                <Observe area={area} />
              ) : ["database", "storage", "system", "legal", "agents"].includes(
                  area,
                ) ? (
                <Infrastructure area={area} />
              ) : area === "ai" ? (
                <Models />
              ) : (
                <Publisher />
              )}
            </main>
          </div>
        </div>
      )}
    </AdminContext.Provider>
  );
}
