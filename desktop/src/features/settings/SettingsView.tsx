import { useState } from "react";
import {
  Activity,
  CalendarCog,
  Monitor,
  Moon,
  Plug,
  Sun,
  Tags,
  UserRound,
} from "lucide-react";
import type { Team, User } from "@orbyn/core";
import { useTheme, type ThemeChoice } from "../../lib/theme";
import { PlanningSettings } from "./PlanningSettings";
import { TagSettings } from "./TagSettings";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { SessionsSettings } from "./SessionsSettings";
import "./settings.css";

export type SettingsTab = "account" | "planning" | "tags" | "connections";

const TABS = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "planning", label: "Planning", icon: CalendarCog },
  { id: "tags", label: "Tags", icon: Tags },
  { id: "connections", label: "Connections", icon: Plug },
] as const;

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
  report: (e: unknown) => void;
  initialTab?: SettingsTab;
};

export function SettingsView({
  user,
  teams,
  busy,
  onEmailReminders,
  onOpenStatus,
  report,
  initialTab = "account",
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [theme, setTheme] = useTheme();
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Settings">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            id={"settings-tab-" + id}
            aria-selected={tab === id}
            aria-controls={"settings-panel-" + id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={"settings-panel-" + tab}
        aria-labelledby={"settings-tab-" + tab}
      >
        {tab === "account" && (
          <section className="card settings-card">
            <h2>Your account</h2>
            <p>
              {user?.name} · {user?.email}
            </p>
            <hr />
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
            <hr />
            <h2>Stay in the loop</h2>
            <label className="preference">
              <span>
                <strong>Email reminders</strong>
                <small>
                  Receive a reminder before your tasks and events are due.
                </small>
              </span>
              <input
                type="checkbox"
                checked={user?.email_reminders || false}
                disabled={busy}
                onChange={(e) => onEmailReminders(e.target.checked)}
              />
            </label>
            <p className="muted">
              Mobile push notifications can be enabled in the Orbyn mobile app.
              Each item has its own reminder timing.
            </p>
            <SessionsSettings report={report} />
            <hr />
            <h2>AI provider</h2>
            <p className="muted">
              An admin connects the AI provider in Admin → AI. Keys stay on the
              server.
            </p>
            {onOpenStatus && (
              <>
                <hr />
                <h2>Service status</h2>
                <p className="muted">
                  See whether Orbyn is running smoothly and review recent
                  incidents.
                </p>
                <button className="secondary" onClick={onOpenStatus}>
                  <Activity size={14} /> Service status
                </button>
              </>
            )}
          </section>
        )}
        {tab === "planning" && (
          <PlanningSettings teams={teams} report={report} />
        )}
        {tab === "tags" && <TagSettings teams={teams} report={report} />}
        {tab === "connections" && <ConnectionsSettings report={report} />}
      </div>
    </>
  );
}
