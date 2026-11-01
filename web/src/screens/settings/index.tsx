import {
  searchSettings,
  sectionKey,
  settingById,
  type SettingEntry,
} from "@orbyn/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  navigate,
  onBeforeNavigate,
  usePath,
  useSearch,
  useTitle,
} from "../../lib/router";
import {
  Button,
  Dialog,
  Input,
  SelectBox,
  useConfirm,
  useToast,
} from "../../ui/kit";
import { AccountSettings } from "./account";
import { PlanningSettings } from "./planning";
import { TagSettings } from "./Tags";
import { PrivacySettings } from "./Privacy";
import { ChatGPTSettings } from "./ChatGPT";
import { MorningSummary } from "./MorningSummary";
import { AutomationSettings } from "./automation";
import { ConnectionsSettings } from "./connections";
import {
  SettingsExitContext,
  useSettingsOwner,
  type SettingsExit,
} from "./shared";
import "./settings.css";

const categories = [
  ["account", "Account"],
  ["planning", "Planning"],
  ["assistants", "AI & connections"],
  ["tags", "Tags"],
  ["connections", "Connections"],
  ["privacy", "Privacy"],
] as const;
type Category = (typeof categories)[number][0];
function destination(path: string, query: string) {
  const params = new URLSearchParams(query);
  const entry = settingById(params.get("setting") ?? "");
  if (entry) return { tab: entry.tab, section: entry.section };
  if (path === "/app/agents")
    return { tab: "connections" as const, section: "Connected agents" };
  if (path === "/app/chatgpt")
    return { tab: "account" as const, section: "AI connections & models" };
  const suffix = path.split("/")[3];
  return {
    tab: categories.find(([id]) => id === suffix)?.[0] ?? "account",
    section: "",
  };
}

export default function SettingsScreen() {
  useTitle("Settings");
  const path = usePath();
  const search = useSearch();
  const owned = useSettingsOwner();
  const confirm = useConfirm();
  const toast = useToast();
  const [returnTo] = useState(() => {
    const from: unknown =
      history.state?.orbynSettingsReturn ?? history.state?.orbynFrom;
    return typeof from === "string" &&
      /^\/app(?:\/|$)/.test(from) &&
      !/^\/app\/(?:settings|agents|chatgpt)(?:[/?#]|$)/.test(from)
      ? from
      : "/app";
  });
  const initial = destination(path, search);
  const [tab, setTab] = useState<Category>(initial.tab);
  const [focus, setFocus] = useState({
    key: sectionKey(initial.section),
    sequence: 0,
  });
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(8);
  const [configurationVersion, setConfigurationVersion] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  const guards = useRef(new Set<() => SettingsExit>());
  const checking = useRef(false);
  const register = useCallback((read: () => SettingsExit) => {
    guards.current.add(read);
    return () => void guards.current.delete(read);
  }, []);
  const canLeave = useCallback(async () => {
    if (!owned()) return true;
    if (checking.current) return false;
    const states = [...guards.current].map((read) => read());
    const blocked = states.find((one) => one.pending || one.sensitive);
    if (blocked) {
      toast({
        text:
          blocked.message ??
          (blocked.sensitive
            ? "Save your recovery material and acknowledge it before leaving."
            : "Wait for this action to finish before leaving."),
        error: true,
      });
      return false;
    }
    if (!states.some((one) => one.dirty)) return true;
    checking.current = true;
    try {
      const allowed = await confirm({
        title: "Discard unsaved settings?",
        body: "Your saved settings will stay as they are.",
        action: "Discard changes",
        danger: true,
      });
      return (
        owned() &&
        allowed &&
        ![...guards.current].some((read) => {
          const now = read();
          return now.pending || now.sensitive;
        })
      );
    } finally {
      checking.current = false;
    }
  }, [confirm, owned, toast]);
  useLayoutEffect(() => onBeforeNavigate(canLeave), [canLeave]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        owned() &&
        [...guards.current].some((read) => {
          const state = read();
          return state.dirty || state.pending || state.sensitive;
        })
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [owned]);
  useEffect(() => {
    const next = destination(path, search);
    setTab(next.tab);
    setQuery("");
    setFocus((old) => ({
      key: sectionKey(next.section),
      sequence: old.sequence + 1,
    }));
  }, [path, search]);
  useEffect(() => {
    const region = content.current;
    if (!region) return;
    const openingFocus = document.activeElement;
    const reveal = () => {
      const section = [
        ...region.querySelectorAll<HTMLElement>("[data-settings-section]"),
      ].find((one) => one.dataset.settingsSection === focus.key);
      if (!section) return false;
      // Do not steal focus if someone has already started editing while loading.
      if (
        document.activeElement !== openingFocus &&
        region.contains(document.activeElement)
      )
        return true;
      section.scrollIntoView({ block: "start" });
      section.focus({ preventScroll: true });
      return true;
    };
    region.scrollTop = 0;
    if (!focus.key || reveal()) return;
    const observer = new MutationObserver(() => {
      if (reveal()) observer.disconnect();
    });
    observer.observe(region, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [focus, tab]);
  const choose = async (next: Category, section = "") => {
    if ((next !== tab && !(await canLeave())) || !owned()) return;
    setTab(next);
    setQuery("");
    setFocus((old) => ({
      key: sectionKey(section),
      sequence: old.sequence + 1,
    }));
  };
  const found = searchSettings(query);
  const chooseResult = (entry: SettingEntry) =>
    void choose(entry.tab, entry.section);
  return (
    <SettingsExitContext.Provider value={register}>
      <div className="settings-backdrop">
        <Dialog title="Settings" wide onClose={() => navigate(returnTo)}>
          <div className="settings-workspace">
            <nav
              className="settings-navigation"
              aria-label="Settings categories"
            >
              <SelectBox
                aria-label="Settings category"
                value={tab}
                onChange={(event) =>
                  void choose(event.target.value as Category)
                }
              >
                {categories.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </SelectBox>
              <div className="settings-category-list">
                {categories.map(([id, label]) => (
                  <Button
                    key={id}
                    variant="ghost"
                    aria-current={id === tab ? "page" : undefined}
                    onClick={() => void choose(id)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </nav>
            <div className="settings-main">
              <div className="settings-search" role="search">
                <Input
                  type="search"
                  aria-label="Search settings"
                  placeholder="Find a setting"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLimit(8);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && query) {
                      event.preventDefault();
                      event.stopPropagation();
                      setQuery("");
                    }
                    if (event.key === "Enter" && found[0]) {
                      event.preventDefault();
                      chooseResult(found[0]);
                    }
                  }}
                />
                {query.trim() && (
                  <div
                    className="settings-results"
                    aria-label="Matching settings"
                  >
                    {found.slice(0, limit).map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => chooseResult(entry)}
                      >
                        <strong>{entry.label}</strong>
                        <span className="muted">{entry.hint}</span>
                      </button>
                    ))}
                    {!found.length && (
                      <p className="muted">No matching settings.</p>
                    )}
                    {found.length > limit && (
                      <Button
                        variant="ghost"
                        onClick={() => setLimit((old) => old + 8)}
                      >
                        Show more
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="settings-content" ref={content} key={tab}>
                {tab === "account" ? (
                  <>
                    <AccountSettings />
                    <ChatGPTSettings
                      onConfigurationChanged={() =>
                        setConfigurationVersion((old) => old + 1)
                      }
                    />
                    <MorningSummary
                      configurationVersion={configurationVersion}
                    />
                  </>
                ) : tab === "planning" ? (
                  <PlanningSettings />
                ) : tab === "tags" ? (
                  <TagSettings />
                ) : tab === "assistants" ? (
                  <AutomationSettings />
                ) : tab === "privacy" ? (
                  <PrivacySettings />
                ) : (
                  <ConnectionsSettings />
                )}
              </div>
            </div>
          </div>
        </Dialog>
      </div>
    </SettingsExitContext.Provider>
  );
}
