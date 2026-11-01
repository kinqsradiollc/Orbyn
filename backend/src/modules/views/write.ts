import {
  fail,
  VIEW_FEATURE,
  viewFeatures,
  type ViewDefinition,
} from "@orbyn/core";

/** Called under the row lock by every definition replacement owner. */
export function checkViewReplacement(
  current: { definition: ViewDefinition; version: number },
  input: { definition?: ViewDefinition; expected_version?: number },
  acknowledged: readonly string[],
) {
  if (
    input.expected_version !== undefined &&
    input.expected_version !== current.version
  )
    fail(409, "This view changed since it was opened. Refresh before saving.");
  if (!input.definition) return;
  const extended =
    viewFeatures(current.definition).length ||
    viewFeatures(input.definition).length;
  if (
    extended &&
    (!acknowledged.includes(VIEW_FEATURE) ||
      input.expected_version === undefined)
  )
    fail(
      409,
      "This view uses exact task filters. Open it in a client that preserves those filters before changing its definition.",
    );
}
