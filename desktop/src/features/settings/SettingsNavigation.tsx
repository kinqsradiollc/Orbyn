import { CalendarCog, Plug, ShieldCheck, Tags, UserRound } from "lucide-react";

export const SETTINGS_CATEGORIES = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "planning", label: "Planning", icon: CalendarCog },
  { id: "tags", label: "Tags", icon: Tags },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
] as const;

export type SettingsTab = (typeof SETTINGS_CATEGORIES)[number]["id"];

/** Category navigation uses ordinary buttons, including their native keyboard behavior. */
export function SettingsNavigation({
  selected,
  onSelect,
}: {
  selected: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
}) {
  return (
    <nav className="settings-navigation" aria-label="Settings categories">
      {SETTINGS_CATEGORIES.map(({ id, label, icon: Icon }) => (
        <button
          type="button"
          key={id}
          id={"settings-category-" + id}
          aria-current={selected === id ? "page" : undefined}
          aria-controls="settings-content"
          onClick={() => onSelect(id)}
        >
          <Icon size={16} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
