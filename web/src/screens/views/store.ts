import { ViewDraftStore } from "@orbyn/api-client";
import { client, getToken, onToken } from "../../lib/session";

const errors = new Set<(error: unknown) => void>();

const make = () => {
  const owner = getToken();
  return new ViewDraftStore(
    async (id, definition) =>
      (await client.updateView(id, { definition })).definition,
    () => getToken() === owner,
    (error) => errors.forEach((listener) => listener(error)),
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
