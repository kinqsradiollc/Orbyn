import { HttpError } from "@orbyn/core";

/** Read failures carry no mutation; uncertain writes must not be replayed. */
export type ChannelFailureKind = "read" | "refused" | "unknown";

export function channelFailure(
  failure: unknown,
  effect: "read" | "write",
): ChannelFailureKind {
  if (effect === "read") return "read";
  if (
    failure instanceof HttpError &&
    failure.statusCode >= 400 &&
    failure.statusCode < 500 &&
    ![408, 425, 429].includes(failure.statusCode)
  )
    return "refused";
  return "unknown";
}
