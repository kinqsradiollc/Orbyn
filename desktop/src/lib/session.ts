const KEY = "orbyn-session";

/** sessionStorage-backed auth token for the current browser tab. */
export const session = {
  get: () => sessionStorage.getItem(KEY) || "",
  set: (token: string) => sessionStorage.setItem(KEY, token),
  clear: () => sessionStorage.removeItem(KEY),
};
