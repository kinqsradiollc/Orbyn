import { newId, type Project } from "@orbyn/core";
import { MessageSquare, Minus } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, usePath } from "../../lib/router";
import {
  RouteScopeProvider,
  useRouteScope,
  type RouteScope,
  type RouteSnapshot,
} from "../../lib/route-scope";
import { useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import { watchAccount } from "../../lib/account-events";
import {
  ErrorNotice,
  IconButton,
  Loading,
  SelectBox,
  useToast,
} from "../../ui/kit";
import {
  ProjectChatDock,
  type ProjectChatRequest,
} from "../../screens/projects/ProjectChatDock";
import { ask } from "../../screens/projects/shared";
import type { SharedAssistantReads } from "../../screens/assistant";
import type { WorkspaceController } from "./controller";
import {
  sessionsToUnmount,
  shouldCollapseForFocus,
} from "./project-chat-policy";
import { useControls } from "../../screens/agents-shared/hooks";

type ChatRequest = Omit<ProjectChatRequest, "id">;
const Context = createContext<
  ((project: Project, request?: ChatRequest) => void) | null
>(null);
type OpenChat = (project: Project, request?: ChatRequest) => void;
/** Without the workspace dock, fall back to the full Assistant screen. */
export function useProjectChat(): OpenChat {
  const open = useContext(Context);
  const navigate = useNavigate();
  return useCallback<OpenChat>(
    (project, request = {}) => {
      if (open) return open(project, request);
      const id = encodeURIComponent(project.id);
      void navigate(
        request.ask
          ? ask(project.id, request.ask)
          : request.chatId
            ? `/app/assistant?project=${id}&chat=${encodeURIComponent(request.chatId)}`
            : `/app/assistant?project=${id}`,
      );
    },
    [open, navigate],
  );
}

type Session = { project: Project; request: ProjectChatRequest | null };

function SessionScope({
  scope,
  active,
  children,
}: {
  scope: RouteScope;
  active: boolean;
  children: ReactNode;
}) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const value = useMemo<RouteScope>(() => {
    const visible = {
      ...scope.getSnapshot(),
      visible: true,
      focused: true,
    };
    const hidden = { ...visible, visible: false, focused: false };
    const listeners = new Set<() => void>();
    let disposing = false;
    const notify = () => listeners.forEach((listener) => listener());
    return {
      ...scope,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => (disposing || activeRef.current ? visible : hidden),
      // Disposal can ask about a hidden project's draft. Its confirmation is
      // an explicit global action, while ordinary hidden input stays disabled.
      addGuard: (guard) =>
        scope.addGuard(async (destination) => {
          disposing = true;
          notify();
          try {
            return await guard(destination);
          } finally {
            disposing = false;
            notify();
          }
        }),
    };
  }, [scope]);
  return <RouteScopeProvider value={value}>{children}</RouteScopeProvider>;
}

/** One account-level controls instance (and its listeners) for every chat. */
function SharedControls({
  onValue,
}: {
  onValue: (value: SharedAssistantReads["controls"]) => void;
}) {
  const value = useControls(true);
  const {
    state,
    deliveryAvailable,
    deliveryError,
    refresh,
    set,
    refreshDelivery,
  } = value;
  useEffect(() => {
    onValue(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, deliveryAvailable, deliveryError, refresh, set, refreshDelivery]);
  useEffect(() => () => onValue(null), [onValue]);
  return null;
}

/** The authenticated shell owns sessions, independently of retained working tabs. */
export function WorkspaceProjectChat({
  controller,
  children,
}: {
  controller: WorkspaceController;
  children: ReactNode;
}) {
  const route = useRouteScope();
  const routeRef = useRef(route);
  routeRef.current = route;
  const path = usePath();
  const toast = useToast();
  // The projects list is read once the dock is first used, never before.
  const [wanted, setWanted] = useState(false);
  const wantedRef = useRef(false);
  wantedRef.current = wanted;
  const projects = useResource(
    async () => (wanted ? client.listProjects() : undefined),
    [wanted],
  );
  // Shared assistant reads happen once for every mounted conversation.
  const prefs = useResource(
    async () => (wanted ? client.getPlannerPrefs() : undefined),
    [wanted],
  );
  const capabilities = useResource(
    async () => (wanted ? client.aiCapabilities() : undefined),
    [wanted],
  );
  const identity = useResource(
    async () => (wanted ? client.agentSettings({ fresh: true }) : undefined),
    [wanted],
  );
  const [controls, setControls] =
    useState<SharedAssistantReads["controls"]>(null);
  const shared = useMemo<SharedAssistantReads>(
    () => ({ prefs, capabilities, identity, controls }),
    // useResource returns a new object every render; its value and reload
    // function are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      prefs.data,
      prefs.error,
      prefs.reload,
      capabilities.data,
      capabilities.error,
      capabilities.reload,
      identity.data,
      identity.error,
      identity.reload,
      controls,
    ],
  );
  const [selected, setSelected] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [open, setOpen] = useState(false);
  const [runningProjects, setRunningProjects] = useState<string[]>([]);
  const busyProjects = useRef(new Set<string>());
  const dirtyProjects = useRef(new Set<string>());
  const recent = useRef<string[]>([]);
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const touch = useCallback((id: string) => {
    recent.current = [...recent.current.filter((one) => one !== id), id];
  }, []);
  const availableProjects = useRef(projects.data);
  availableProjects.current = projects.data;
  const hasBlockingRun = useCallback(
    () =>
      [...busyProjects.current].some(
        (id) =>
          !availableProjects.current ||
          availableProjects.current.some((project) => project.id === id),
      ),
    [],
  );
  const busy = runningProjects.some(
    (id) =>
      !projects.data || projects.data.some((project) => project.id === id),
  );
  const launcher = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  const panelId = "workspace-project-chat";

  const selectProject = useCallback(
    (project: Project) => {
      if (hasBlockingRun()) {
        toast({
          text: "Stop the active project run before switching projects.",
        });
        return;
      }
      touch(project.id);
      setSelected(project.id);
      setSessions((current) =>
        current.some((session) => session.project.id === project.id)
          ? current
          : [...current, { project, request: null }],
      );
    },
    [toast, hasBlockingRun, touch],
  );

  const requestChat = useCallback(
    (project: Project, request: ChatRequest = {}) => {
      if (wantedRef.current) void identity.reload();
      setWanted(true);
      setOpen(true);
      if (hasBlockingRun()) {
        toast({
          text: "This project chat is still working. Stop its run before opening another chat.",
        });
        return;
      }
      touch(project.id);
      setSelected(project.id);
      setSessions((current) => {
        const next = { project, request: { ...request, id: newId() } };
        return current.some((session) => session.project.id === project.id)
          ? current.map((session) =>
              session.project.id === project.id ? next : session,
            )
          : [...current, next];
      });
    },
    [toast, hasBlockingRun, touch],
  );

  // Keep the mounted conversations bounded. Selected, working and unsent
  // sessions always stay, so a draft is never lost.
  useEffect(() => {
    const drop = sessionsToUnmount({
      mounted: sessions.map((session) => session.project.id),
      recent: recent.current,
      selected,
      busy: busyProjects.current,
      dirty: dirtyProjects.current,
    });
    if (drop.length)
      setSessions((current) =>
        current.filter((session) => !drop.includes(session.project.id)),
      );
  }, [sessions, selected, runningProjects, dirtyVersion]);

  // Select an initial project only. Navigation never retargets an existing chat.
  useEffect(() => {
    if (selected || !projects.data) return;
    const match = /^\/app\/project\/([^/]+)$/.exec(path);
    const project = projects.data.find((item) => item.id === match?.[1]);
    if (project) selectProject(project);
  }, [path, projects.data, selected, selectProject]);

  useEffect(() => {
    const refresh = () => {
      if (wantedRef.current) void projects.reload();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [projects.reload]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (wantedRef.current) void projects.reload();
      }, 400);
    };
    const stop = watchAccount((news) => {
      if (
        news.kind === "changed" &&
        (!news.area || ["projects", "organize"].includes(news.area))
      )
        refresh();
    }, refresh);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [projects.reload]);

  const onBusy = useCallback((projectId: string, value: boolean) => {
    if (value) busyProjects.current.add(projectId);
    else busyProjects.current.delete(projectId);
    setRunningProjects([...busyProjects.current]);
  }, []);
  const onDirty = useCallback((projectId: string, value: boolean) => {
    if (dirtyProjects.current.has(projectId) === value) return;
    if (value) dirtyProjects.current.add(projectId);
    else dirtyProjects.current.delete(projectId);
    setDirtyVersion((n) => n + 1);
  }, []);
  const collapse = useCallback(() => {
    returnFocus.current = true;
    setOpen(false);
  }, []);
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      launcher.current?.focus();
    }
  }, [open]);
  useEffect(() => {
    if (open && !selected) anchor.current?.querySelector("select")?.focus();
  }, [open, selected, projects.loading]);
  useEffect(() => {
    if (!open) return;
    // Only focus that follows a user Tab can mean "a control is under the
    // panel". Frame activation and focus restoration are programmatic.
    let viaTab = false;
    const phone = () => window.matchMedia("(max-width: 760px)").matches;
    const keydown = (event: KeyboardEvent) => {
      viaTab = event.key === "Tab";
    };
    const pointer = () => {
      viaTab = false;
    };
    const revealFocus = (event: FocusEvent) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        anchor.current?.contains(target) ||
        target.closest('[role="dialog"]')
      )
        return;
      const panel = anchor.current?.querySelector<HTMLElement>(
        ".pj-chat-panel:not([hidden])",
      );
      if (!panel) return;
      // The phone sheet is modal: keep keyboard focus inside it.
      if (phone()) {
        if (viaTab) panel.focus();
        return;
      }
      if (
        shouldCollapseForFocus({
          panel: panel.getBoundingClientRect(),
          target: target.getBoundingClientRect(),
          viaTab,
          container:
            target.matches(".workspace-frame-content") ||
            target.getAttribute("tabindex") === "-1",
        })
      )
        setOpen(false);
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("focusin", revealFocus);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("focusin", revealFocus);
    };
  }, [open]);

  // Let the page scroll clear of the open panel (see project-chat-dock.css).
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.dataset.projectChat = selected ? "chat" : "picker";
    return () => {
      delete root.dataset.projectChat;
    };
  }, [open, selected]);

  const scope = useMemo<RouteScope>(() => {
    const snapshot: RouteSnapshot = {
      pathname: "/app",
      search: "",
      hash: "",
      activation: 0,
      visible: true,
      focused: true,
    };
    return {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      navigate: async (href, replace) =>
        routeRef.current
          ? routeRef.current.navigate(href, replace)
          : {
              kind: "refused",
              reason: "Choose a workspace tab before opening Assistant.",
            },
      addGuard: (guard) => controller.registerWorkspaceGuard(guard),
      noteInput: () => controller.noteWorkspaceInput(),
      setTitle: () => () => {},
    };
  }, [controller]);

  const picker = (
    <SelectBox
      aria-label="Chat project"
      value={selected}
      disabled={busy || (projects.loading && !projects.data)}
      onChange={(event) => {
        const project = projects.data?.find(
          (item) => item.id === event.target.value,
        );
        if (project) selectProject(project);
      }}
    >
      <option value="" disabled>
        Choose a project
      </option>
      {projects.data?.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
          {project.assistant_off ? " · AI excluded" : ""}
        </option>
      ))}
      {selected &&
        projects.data &&
        !projects.data.some((project) => project.id === selected) && (
          <option value={selected}>Project unavailable</option>
        )}
    </SelectBox>
  );

  return (
    <Context.Provider value={requestChat}>
      {children}
      {wanted && <SharedControls onValue={setControls} />}
      <div
        ref={anchor}
        className="workspace-project-chat pj-chat-anchor"
        onInputCapture={() => controller.noteWorkspaceInput()}
        onClickCapture={() => controller.noteWorkspaceInput()}
        onKeyDown={(event) => {
          if (
            event.key !== "Escape" ||
            event.defaultPrevented ||
            (event.target as HTMLElement).closest('[role="dialog"]')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          collapse();
        }}
      >
        <button
          ref={launcher}
          type="button"
          className="btn btn-secondary pj-chat-launcher"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            if (open) collapse();
            else {
              setOpen(true);
              if (wantedRef.current) {
                void projects.reload();
                void identity.reload();
              } else setWanted(true);
            }
          }}
        >
          <MessageSquare aria-hidden="true" />
          {busy ? "Project chat · Working…" : "Project chat"}
        </button>
        <div
          className="pj-chat-scrim"
          aria-hidden="true"
          hidden={!open}
          onClick={collapse}
        />
        <div id={panelId} hidden={!open}>
          {!selected && (
            <section
              className="pj-chat-panel pj-chat-picker-panel"
              aria-label="Project chat"
            >
              <header className="pj-chat-head">
                <MessageSquare aria-hidden="true" />
                <strong className="pj-chat-title">Project chat</strong>
                <IconButton label="Collapse project chat" onClick={collapse}>
                  <Minus aria-hidden="true" />
                </IconButton>
              </header>
              <div className="pj-chat-select-state">
                <label>Project{picker}</label>
                {projects.loading && !projects.data && (
                  <Loading label="Loading projects" />
                )}
                {projects.error && (
                  <ErrorNotice
                    message="Couldn't load projects."
                    onRetry={() => void projects.reload()}
                  />
                )}
                {projects.data && !projects.data.length ? (
                  <p className="muted">
                    No projects are available. Create a project to start a
                    project chat.
                  </p>
                ) : (
                  <p className="muted">
                    Choose a project to ask about its tasks and pages.
                  </p>
                )}
              </div>
            </section>
          )}
          {sessions.map((session) => {
            const current = projects.data?.find(
              (project) => project.id === session.project.id,
            );
            const project = current ?? session.project;
            const unavailable = !!projects.data && !current;
            return (
              <SessionScope
                key={project.id}
                scope={scope}
                active={open && selected === project.id && !unavailable}
              >
                <ProjectChatDock
                  project={project}
                  request={session.request}
                  open={open && selected === project.id}
                  onClose={collapse}
                  onBusyChange={onBusy}
                  onDirtyChange={onDirty}
                  shared={shared}
                  picker={picker}
                  unavailable={unavailable}
                  projectError={projects.error}
                  onRefreshProjects={() => void projects.reload()}
                />
              </SessionScope>
            );
          })}
        </div>
      </div>
    </Context.Provider>
  );
}
