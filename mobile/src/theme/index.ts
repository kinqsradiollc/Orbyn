/** Colours that are reused across more than one component or inline style. */
export const colors = {
  /** App and modal backgrounds. */
  background: "#f7f8f4",
  modalBackground: "#f8f9f6",
  /** Accent green: refresh spinner, checked checkbox. */
  accent: "#476f4d",
  /** Secondary button label. */
  secondaryText: "#456d4d",
  /** Completed item title. */
  muted: "#9ba797",
  /** Unread inbox card. */
  unread: "#edf2e6",
  /** Switch track when on. */
  switchOn: "#709566",
  white: "#fff",
} as const;

export const spacing = {
  /** Horizontal page padding. */
  page: 24,
} as const;

export const radii = {
  input: 8,
  card: 10,
} as const;
