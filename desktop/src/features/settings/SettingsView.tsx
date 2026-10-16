import { AgentWarmStart } from "./AgentContext";
import { ChatgptConnections } from "./ChatgptConnections";
import { AssistantRulesSettings } from "./AssistantRulesSettings";
import { AssistantBudgetSettings } from "./AssistantBudgetSettings";
import { SettingsWorkspace, SettingsSection } from "./SettingsSection";
import { useEffect, useId, useRef, useState } from "react";
import { settingsExitAllowed } from "./SettingsModal";
import {
  Activity,
  BookOpen,
  Newspaper,
  Search,
  ShieldCheck,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import {
  searchSettings,
  sectionKey,
  securityPageDate,
  settingById,
  type SettingEntry,
  type Team,
  type User,
} from "@orbyn/core";
import { readsFirst, setReadsFirst } from "../docs/reading";
import { useTheme, type ThemeChoice } from "../../lib/theme";
import { PlanningSettings } from "./PlanningSettings";
import { TagSettings } from "./TagSettings";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { SessionsSettings } from "./SessionsSettings";
import { DevicesSettings } from "./DevicesSettings";
import { TwoFactorSettings } from "./TwoFactorSettings";
import { PasskeysSettings } from "./PasskeysSettings";
import { PrivacySettings } from "./PrivacySettings";
import {
  ArrangeSettings,
  HomeArrangeSettings,
  ShortcutSettings,
  StartSettings,
} from "./LayoutSettings";
import { ClipperSettings } from "./ClipperSettings";
import "./settings.css";

import {
  SETTINGS_CATEGORIES,
  SettingsNavigation,
  type SettingsTab,
} from "./SettingsNavigation";
export type { SettingsTab } from "./SettingsNavigation";

const THEMES: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

type Props = {
  user: User | null;
  teams: Team[];
  busy: boolean;
  onEmailReminders: (checked: boolean) => void;
  /** Opens the public status page. */
  onOpenStatus?: () => void;
  /** Opens the public Security and data page. */
  onOpenSecurity?: () => void;
  report: (e: unknown) => void;
  initialTab?: SettingsTab;
  /** A setting to open and scroll to (⌘K's "Settings: …", NAV-10). */
  initialSetting?: { id: string; seq: number } | null;
  /** Opens "What's new" (DSN-03). */
  onOpenWhatsNew?: () => void;
  /** After deleting your own account. */
  onAccountDeleted: () => void;
};

export function SettingsView({
  user,
  teams,
  busy,
  onEmailReminders,
  onOpenStatus,
  onOpenSecurity,
  report,
  initialTab = "account",
  initialSetting = null,
  onOpenWhatsNew,
  onAccountDeleted,
}: Props) {
  const id = useId();
  const foundId = `${id}-found`;
  const contentId = `${id}-content`;
  const categoryId = `${id}-category`;
  const content = useRef<HTMLElement>(null);
  const [limit, setLimit] = useState(8);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [theme, setTheme] = useTheme();
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<{ key: string; seq: number } | null>(null);
  const [reading, setReading] = useState(readsFirst);
  const found = searchSettings(query);
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [tab]);
  const choose = (entry: SettingEntry) => {
    if (!settingsExitAllowed()) return;
    setTab(entry.tab);
    setQuery("");
    setFocus((f) => ({
      key: sectionKey(entry.section),
      seq: (f?.seq ?? 0) + 1,
    }));
  };
  // ⌘K chose a setting: open its tab and section.
  useEffect(() => {
    const entry = initialSetting && settingById(initialSetting.id);
    if (entry) choose(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSetting?.seq]);
  return (
    <SettingsWorkspace focus={focus} resetKey={tab}>
      <div className="settings-workspace">
        <aside className="settings-sidebar">
          <div className="settings-search" role="search">
            <label className="settings-search-field">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search settings</span>
              <input
                type="search"
                value={query}
                placeholder="Search settings"
                aria-controls={foundId}
                aria-expanded={!!query.trim()}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(8);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && found[0]) {
                    e.preventDefault();
                    choose(found[0]);
                  }
                  if (e.key === "Escape" && query) {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuery("");
                  }
                }}
              />
            </label>
            {!!query.trim() && (
              <ul
                id={foundId}
                className="settings-found"
                aria-label="Settings found"
              >
                {found.length ? (
                  found.slice(0, limit).map((entry) => (
                    <li key={entry.id}>
                      <button type="button" onClick={() => choose(entry)}>
                        <strong>{entry.label}</strong>
                        <small>
                          {
                            SETTINGS_CATEGORIES.find((t) => t.id === entry.tab)
                              ?.label
                          }{" "}
                          · {entry.hint}
                        </small>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="settings-found-none">No matching settings.</li>
                )}
                {found.length > limit && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setLimit((n) => n + 8)}
                    >
                      More results
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
          <SettingsNavigation
            contentId={contentId}
            labelId={categoryId}
            selected={tab}
            onSelect={(next) => {
              if (settingsExitAllowed()) setTab(next);
            }}
          />
        </aside>
        <section
          ref={content}
          className="settings-content"
          id={contentId}
          aria-labelledby={categoryId}
        >
          {tab === "account" && (
            <SettingsSection className="card settings-card" defaultOpen>
              <h2>Your account</h2>
              <p>
                {user?.name} · {user?.email}
              </p>
            </SettingsSection>
          )}
          {tab === "account" && (
            <SettingsSection className="card settings-card">
              <h2>Appearance</h2>
              <div className="preference theme-preference">
                <span>
                  <strong>Theme</strong>
                  <small>Saved on this device.</small>
                </span>
                <div className="segmented" role="group" aria-label="Theme">
                  {THEMES.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      aria-pressed={theme === id}
                      className={theme === id ? "active" : ""}
                      onClick={() => setTheme(id)}
                    >
                      <Icon size={14} aria-hidden="true" /> {label}
                    </button>
                  ))}
                </div>
              </div>
            </SettingsSection>
          )}
          {tab === "account" && (
            <SettingsSection className="card settings-card">
              <h2>Reading</h2>
              <label className="switch-line settings-field">
                <input
                  type="checkbox"
                  role="switch"
                  className="ai-switch"
                  checked={reading}
                  onChange={(e) => {
                    setReadsFirst(e.target.checked);
                    setReading(e.target.checked);
                  }}
                />
                <span>
                  <BookOpen size={14} aria-hidden="true" /> Open pages for
                  reading
                  <small>Use Edit to change a page.</small>
                </span>
              </label>
            </SettingsSection>
          )}
          {tab === "account" && <StartSettings />}
          {tab === "account" && <ArrangeSettings user={user} />}
          {tab === "account" && <HomeArrangeSettings />}
          {tab === "account" && <ShortcutSettings />}
          {tab === "account" && (
            <SettingsSection className="card settings-card">
              <h2>Notifications</h2>
              <label className="switch-line settings-field">
                <input
                  type="checkbox"
                  role="switch"
                  className="ai-switch"
                  checked={user?.email_reminders || false}
                  disabled={busy}
                  onChange={(e) => onEmailReminders(e.target.checked)}
                />
                <span>
                  Email reminders
                  <small>Reminders before items are due.</small>
                </span>
              </label>
              <details>
                <summary>Push notifications</summary>
                <p className="muted">
                  Manage push notifications in the mobile app.
                </p>
              </details>
            </SettingsSection>
          )}
          {tab === "account" && (
            <SettingsSection className="card settings-card" title="Signing in">
              <TwoFactorSettings report={report} />
              <PasskeysSettings report={report} />
              <SessionsSettings report={report} />
              <DevicesSettings report={report} />
            </SettingsSection>
          )}
          {tab === "account" && <ChatgptConnections userId={user?.id ?? ""} />}
          {tab === "account" && onOpenWhatsNew && (
            <SettingsSection className="card settings-card">
              <h2>What's new</h2>
              <button className="secondary" onClick={onOpenWhatsNew}>
                <Newspaper size={14} /> What's new
              </button>
            </SettingsSection>
          )}
          {tab === "account" && onOpenStatus && (
            <SettingsSection className="card settings-card">
              <h2>Service status</h2>
              <button className="secondary" onClick={onOpenStatus}>
                <Activity size={14} /> Service status
              </button>
            </SettingsSection>
          )}
          {tab === "planning" && (
            <PlanningSettings teams={teams} report={report} />
          )}
          {tab === "assistants" && (
            <>
              <AgentWarmStart report={report} />
              <AssistantBudgetSettings userId={user?.id ?? ""} />
              <AssistantRulesSettings userId={user?.id ?? ""} teams={teams} />
            </>
          )}
          {tab === "tags" && <TagSettings teams={teams} report={report} />}
          {tab === "connections" && <ConnectionsSettings report={report} />}
          {tab === "connections" && <ClipperSettings report={report} />}
          {tab === "privacy" && onOpenSecurity && (
            <SettingsSection className="card settings-card">
              <h2>Security and data</h2>
              <p className="muted">Last reviewed {securityPageDate()}.</p>
              <button className="secondary" onClick={onOpenSecurity}>
                <ShieldCheck size={14} /> Security and data
              </button>
            </SettingsSection>
          )}
          {tab === "privacy" && (
            <PrivacySettings
              user={user}
              report={report}
              onDeleted={onAccountDeleted}
            />
          )}
        </section>
      </div>
    </SettingsWorkspace>
  );
}
