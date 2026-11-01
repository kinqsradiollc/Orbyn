import { viewDefinition } from "@orbyn/core";
import { ViewDraftStore } from "@orbyn/api-client";
import {
  client,
  getToken,
  getSessionVersion,
  onToken,
} from "../../lib/session";

const errors = new Set<(error: unknown) => void>();

const make = () => {
  const owner = getSessionVersion();
  return new ViewDraftStore(
    async (id, definition, expected_version) => {
      if (expected_version === undefined)
        throw Object.assign(
          new Error(
            "Refresh this view before saving; this server has not supplied its revision.",
          ),
          { status: 409 },
        );
      const saved = await client.updateView(id, {
        definition,
        expected_version,
      });
      if (saved.id !== id || saved.version === undefined)
        throw new Error(
          "The view save receipt is incomplete. Check the saved view.",
        );
      return {
        definition: viewDefinition.parse(saved.definition),
        version: saved.version,
      };
    },
    () => !!getToken() && getSessionVersion() === owner,
    (error) => errors.forEach((listener) => listener(error)),
    async (id) => {
      const view = (await client.listViews({ fresh: true })).find(
        (v) => v.id === id,
      );
      if (!view) throw new Error("This view is no longer available.");
      return { ...view, definition: viewDefinition.parse(view.definition) };
    },
  );
};

let current = make();

onToken(() => {
  current.stop();
  current = make();
});

/** Unsaved view changes survive moving between screens, never an account change. */
export const draftStore = () => current;

export const onDraftError = (listener: (error: unknown) => void) => {
  errors.add(listener);
  return () => void errors.delete(listener);
};
