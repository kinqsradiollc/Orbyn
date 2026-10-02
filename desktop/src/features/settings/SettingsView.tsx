import {
  SettingsFocus,
  SettingsSection,
  SettingsSectionsVisible,
} from "./SettingsSection";
import { useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  Newspaper,
  Search,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import {
  searchSettings,
  sectionKey,
  securityPageDate,
  settingById,
  settingsCategory,
  SETTINGS_CATEGORIES,
  type SettingEntry,
  type SettingsCategoryId,
  type SettingsTabId,
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
import { ChatgptConnections } from "./ChatgptConnections";
import { ChatDelivery } from "./ChatDelivery";
import { PortabilitySettings } from "./PortabilitySettings";
import { SettingsNavigation } from "./SettingsNavigation";
import "./settings.css";

export type SettingsTab = SettingsTabId;

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
  const requested = initialSetting && settingById(initialSetting.id);
  const [tab, setTab] = useState<SettingsCategoryId>(() =>
    settingsCategory(requested ? requested.tab : initialTab),
  );
  const [theme, setTheme] = useTheme();
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<{ key: string; seq: number } | null>(() =>
    requested
      ? { key: sectionKey(requested.section), seq: initialSetting?.seq ?? 1 }
      : initialTab === "tags"
        ? { key: sectionKey("Tags"), seq: 1 }
        : null,
  );
  const [reading, setReading] = useState(readsFirst);
  const found = searchSettings(query);
  const choose = (entry: SettingEntry) => {
    setTab(settingsCategory(entry.tab));
    setQuery("");
    setFocus((f) => ({
      key: sectionKey(entry.section),
      seq: (f?.seq ?? 0) + 1,
    }));
  };
  const currentCategory = SETTINGS_CATEGORIES.find(
    (value) => value.id === tab,
  )!;
  // ⌘K chose a setting: open its tab and section.
  useEffect(() => {
    const entry = initialSetting && settingById(initialSetting.id);
    if (entry) choose(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSetting?.seq]);
  return (
    <SettingsFocus.Provider value={focus}>
      <SettingsSectionsVisible.Provider value={true}>
        <div className="settings-workspace">
          <div className="settings-search" role="search">
            <label className="settings-search-field">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search settings</span>
              <input
                type="search"
                value={query}
                placeholder="Search settings"
                aria-controls="settings-found"
                aria-expanded={!!query.trim()}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && found[0]) {
                    e.preventDefault();
                    choose(found[0]);
                  }
                  if (e.key === "Escape") setQuery("");
                }}
              />
            </label>
            {!!query.trim() && (
              <ul
                id="settings-found"
                className="settings-found"
                aria-label="Settings found"
              >
                {found.length ? (
                  found.slice(0, 8).map((entry) => (
                    <li key={entry.id}>
                      <button type="button" onClick={() => choose(entry)}>
                        <strong>{entry.label}</strong>
                        <small>
                          {
                            SETTINGS_CATEGORIES.find(
                              (t) => t.id === settingsCategory(entry.tab),
                            )?.label
                          }{" "}
                          · {entry.hint}
                        </small>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="settings-found-none">
                    No setting is called that. Try other words.
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="settings-layout">
            <SettingsNavigation
              category={tab}
              onChoose={(value) => {
                setTab(value);
                setFocus(null);
                setQuery("");
              }}
            />
            <div
              className="settings-content"
              role="region"
              id={"settings-panel-" + tab}
              aria-labelledby="settings-current-category"
              key={tab}
            >
              <header className="settings-category-heading">
                <h2 id="settings-current-category">{currentCategory.label}</h2>
                <p className="muted">{currentCategory.hint}</p>
              </header>
              {tab === "account" && (
                <SettingsSection className="card settings-card" defaultOpen>
                  <h2>Your account</h2>
                  <p>
                    {user
                      ? `${user.name} · ${user.email}`
                      : "Loading account details…"}
                  </p>
                </SettingsSection>
              )}
              {tab === "appearance" && (
                <SettingsSection className="card settings-card">
                  <h2>Appearance</h2>
                  <div className="preference theme-preference">
                    <span>
                      <strong>Theme</strong>
                      <small>
                        System follows your device. Saved on this device only.
                      </small>
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
              {tab === "appearance" && (
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
                      <small>
                        Pages open without editing handles; press Edit, or ⌘⇧R,
                        to change one. Saved on this device only, so a phone and
                        a computer can differ.
                      </small>
                    </span>
                  </label>
                </SettingsSection>
              )}
              {tab === "appearance" && <StartSettings />}
              {tab === "appearance" && <ArrangeSettings user={user} />}
              {tab === "appearance" && <HomeArrangeSettings />}
              {tab === "appearance" && <ShortcutSettings />}
              {tab === "notifications" && (
                <SettingsSection className="card settings-card">
                  <h2>Stay in the loop</h2>
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
                      <small>
                        Receive a reminder before your tasks and events are due.
                      </small>
                    </span>
                  </label>
                  <p className="muted">
                    Mobile push notifications can be enabled in the Orbyn mobile
                    app. Each item has its own reminder timing.
                  </p>
                </SettingsSection>
              )}
              {tab === "security" && (
                <>
                  <TwoFactorSettings report={report} />
                  <PasskeysSettings report={report} />
                  <SessionsSettings report={report} />
                  <DevicesSettings report={report} />
                </>
              )}
              {tab === "ai" && <ChatgptConnections userId={user?.id ?? ""} />}
              {tab === "account" && onOpenWhatsNew && (
                <SettingsSection className="card settings-card">
                  <h2>What's new</h2>
                  <p className="muted">
                    What changed in Orbyn lately: New, Better and No longer
                    broken.
                  </p>
                  <button className="secondary" onClick={onOpenWhatsNew}>
                    <Newspaper size={14} /> What's new
                  </button>
                </SettingsSection>
              )}
              {tab === "account" && onOpenStatus && (
                <SettingsSection className="card settings-card">
                  <h2>Service status</h2>
                  <p className="muted">
                    See whether Orbyn is running smoothly and review recent
                    incidents.
                  </p>
                  <button className="secondary" onClick={onOpenStatus}>
                    <Activity size={14} /> Service status
                  </button>
                </SettingsSection>
              )}
              {tab === "planning" && (
                <PlanningSettings teams={teams} report={report} />
              )}
              {tab === "planning" && (
                <TagSettings teams={teams} report={report} />
              )}
              {tab === "notifications" && <ChatDelivery report={report} />}
              {tab === "connections" && <ConnectionsSettings report={report} />}
              {tab === "connections" && <ClipperSettings report={report} />}
              {tab === "privacy" && onOpenSecurity && (
                <SettingsSection className="card settings-card">
                  <h2>Security and data</h2>
                  <p className="muted">
                    How Orbyn keeps your account safe and how to take your data
                    with you, last checked {securityPageDate()}.
                  </p>
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
              {tab === "privacy" && <PortabilitySettings report={report} />}
            </div>
          </div>
        </div>
      </SettingsSectionsVisible.Provider>
    </SettingsFocus.Provider>
  );
}
