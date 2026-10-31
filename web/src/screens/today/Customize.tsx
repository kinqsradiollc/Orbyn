import {
  DEFAULT_HOME,
  HOME_PANEL_LABELS,
  WORKSPACE_PRESETS,
  homePanels,
  withWorkspacePresets,
  workspacePresets,
  type HomeLayout,
  type HomePanel,
  type WorkspacePreset,
} from "@orbyn/core";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  IconButton,
  SelectBox,
} from "../../ui/kit";
import { homeOf, savePrefs, saveHome, usePrefs } from "./prefs";

const PRESET_WORDS: Record<WorkspacePreset, { name: string; blurb: string }> = {
  engineer: {
    name: "Engineer",
    blurb: "Project work, specifications and decisions.",
  },
  student: { name: "Student", blurb: "Course projects and review material." },
};

/** Order, visibility, the quote and shortcuts for this account. Saves as it goes. */
export function Customize({ onClose }: { onClose: () => void }) {
  const { prefs } = usePrefs();
  const layout = homeOf(prefs);
  const docs = useResource(() => client.listDocs(), []);
  const [error, setError] = useState("");
  const write = (next: HomeLayout) => {
    setError("");
    saveHome(next).catch((e) =>
      setError(messageOf(e, "Couldn't save your layout.")),
    );
  };
  const all = homePanels(layout, true);
  const move = (panel: HomePanel, by: -1 | 1) => {
    const at = all.indexOf(panel);
    const to = at + by;
    if (to < 0 || to >= all.length) return;
    const order = [...all];
    [order[at], order[to]] = [order[to], order[at]];
    write({ ...layout, order });
  };
  const toggle = (panel: HomePanel, shown: boolean) =>
    write({
      ...layout,
      hidden: shown
        ? layout.hidden.filter((p) => p !== panel)
        : [...layout.hidden, panel],
    });
  const presets = workspacePresets(prefs.views.workspace);
  const setPreset = (preset: WorkspacePreset, on: boolean) => {
    setError("");
    const selected = on
      ? [...presets, preset]
      : presets.filter((p) => p !== preset);
    savePrefs({
      views: {
        workspace: withWorkspacePresets(prefs.views.workspace, selected),
      },
    }).catch((e) => setError(messageOf(e, "Couldn't save your shortcuts.")));
  };
  return (
    <Dialog
      title="Customize Today"
      onClose={onClose}
      actions={
        <>
          <Button
            variant="ghost"
            onClick={() => write({ ...DEFAULT_HOME, hubs: layout.hubs })}
          >
            Reset order
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <h3>Sections</h3>
      <ul className="today-arrange">
        {all.map((panel, n) => {
          const shown = !layout.hidden.includes(panel);
          return (
            <li key={panel}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={shown}
                  onChange={(event) => toggle(panel, event.target.checked)}
                />
                {HOME_PANEL_LABELS[panel]}
              </label>
              <IconButton
                label={`Move ${HOME_PANEL_LABELS[panel]} up`}
                disabled={n === 0}
                onClick={() => move(panel, -1)}
              >
                <ArrowUp />
              </IconButton>
              <IconButton
                label={`Move ${HOME_PANEL_LABELS[panel]} down`}
                disabled={n === all.length - 1}
                onClick={() => move(panel, 1)}
              >
                <ArrowDown />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <h3>Line under the greeting</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={layout.quote.on}
          onChange={(event) =>
            write({
              ...layout,
              quote: { ...layout.quote, on: event.target.checked },
            })
          }
        />
        Show a line from one of your pages
      </label>
      {layout.quote.on && (
        <Field label="Page">
          <SelectBox
            value={layout.quote.doc_id ?? ""}
            onChange={(event) =>
              write({
                ...layout,
                quote: { ...layout.quote, doc_id: event.target.value || null },
              })
            }
          >
            <option value="">Choose a page</option>
            {(docs.data ?? [])
              .filter((d) => d.kind !== "agenda")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title || "Untitled"}
                </option>
              ))}
          </SelectBox>
        </Field>
      )}
      {docs.error && (
        <ErrorNotice message={docs.error} onRetry={() => void docs.reload()} />
      )}
      <h3>Workspace shortcuts</h3>
      <p className="muted small">
        These add shortcuts. Your projects, layout and permissions stay as they
        are.
      </p>
      {WORKSPACE_PRESETS.map((preset) => (
        <label className="check" key={preset}>
          <input
            type="checkbox"
            checked={presets.includes(preset)}
            onChange={(event) => setPreset(preset, event.target.checked)}
          />
          <span>
            {PRESET_WORDS[preset].name}{" "}
            <span className="muted small">{PRESET_WORDS[preset].blurb}</span>
          </span>
        </label>
      ))}
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}
