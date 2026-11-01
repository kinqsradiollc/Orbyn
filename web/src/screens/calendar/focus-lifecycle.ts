/** Timer account lifetime and visible input lifetime are deliberately separate. */
export type FocusPreparationReason = "hide" | "replace" | "exit";
export type FocusPreparationResult =
  false | { kind: "running" | "settled"; current(): boolean };
export type FocusPreparation = (
  reason: FocusPreparationReason,
) => Promise<FocusPreparationResult>;
