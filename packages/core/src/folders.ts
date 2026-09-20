/**
 * Folders and favourites: the two light ways to tidy a workspace. Folders are
 * flat — one level is enough to group documents without becoming a filing
 * cabinet — and favourites pin the few things someone keeps coming back to.
 */

export const FAVOURITE_KINDS = ["doc", "project"] as const;
export type FavouriteKind = (typeof FAVOURITE_KINDS)[number];

export type Folder = {
  id: string;
  user_id: string;
  team_id: string | null;
  name: string;
  position: number;
  created_at: string;
  /** How many documents are filed here. */
  doc_count: number;
};

export type Favourite = {
  kind: FavouriteKind;
  target_id: string;
  created_at: string;
};

/** Quick lookup for "is this starred?" without scanning a list each render. */
export const favouriteKey = (kind: FavouriteKind, id: string) =>
  `${kind}:${id}`;

export const favouriteSet = (favourites: Favourite[]) =>
  new Set(favourites.map((f) => favouriteKey(f.kind, f.target_id)));
