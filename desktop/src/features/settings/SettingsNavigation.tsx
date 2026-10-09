import {
  Bot,
  CalendarCog,
  Plug,
  ShieldCheck,
  Tags,
  UserRound,
} from "lucide-react";
import { Select } from "../../components/Select";

export const SETTINGS_CATEGORIES = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "planning", label: "Planning", icon: CalendarCog },
  { id: "assistants", label: "Assistants", icon: Bot },
  { id: "tags", label: "Tags", icon: Tags },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
] as const;

export type SettingsTab = (typeof SETTINGS_CATEGORIES)[number]["id"];

/** Wide settings use category buttons; narrow settings use one compact category picker. */
export function SettingsNavigation({
  selected,
  onSelect,
}: {
  selected: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
}) {
  return (
    <nav className="settings-navigation" aria-label="Settings categories">
      <span className="sr-only" id={"settings-category-" + selected}>
        {
          SETTINGS_CATEGORIES.find((category) => category.id === selected)
            ?.label
        }
      </span>
      <div className="settings-navigation-compact">
        <Select
          value={selected}
          aria-label="Settings category"
          onChange={(event) => {
            const category = SETTINGS_CATEGORIES.find(
              (entry) => entry.id === event.target.value,
            );
            if (category) onSelect(category.id);
          }}
        >
          {SETTINGS_CATEGORIES.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div className="settings-navigation-wide">
        {SETTINGS_CATEGORIES.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className="settings-category-button"
            aria-current={selected === id ? "page" : undefined}
            aria-controls="settings-content"
            onClick={() => onSelect(id)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
