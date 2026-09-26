/**
 * Validation problems in words people (and agents) can act on. Kept apart
 * from the HTTP service so code with no web framework (the capability
 * layer) can use it too.
 */

/** The field a validation issue is about, in words ("start time", "title"). */
const fieldOf = (path: PropertyKey[]) => {
  const last = [...path].reverse().find((p) => typeof p === "string");
  return typeof last === "string" ? last.replace(/_/g, " ") : "";
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A rejected request in a sentence or two people can act on ("Title is too
 * long: 200 characters at most."), from Zod's issues. Hand-written messages
 * (refinements) are used as they are.
 */
export function validationMessage(
  issues: {
    code: string;
    path: PropertyKey[];
    message: string;
    origin?: string;
    maximum?: number | bigint;
    minimum?: number | bigint;
    format?: string;
    input?: unknown;
  }[],
): string {
  const one = (i: (typeof issues)[number]) => {
    // A message written in the schema ("Colours look like #376c51") is for
    // people already, and says which field when it has one; Zod's own
    // ("Invalid input: …", "Too big: …") aren't.
    if (
      !/^(Invalid|Too (big|small)|Expected|Unrecognized|Required)\b/.test(
        i.message,
      )
    ) {
      const text = /[.!?]$/.test(i.message) ? i.message : `${i.message}.`;
      const name = fieldOf(i.path);
      return name ? `${capital(name)}: ${text}` : text;
    }
    const field = fieldOf(i.path);
    const Field = capital(field || "a value");
    switch (i.code) {
      case "too_big":
        return i.origin === "string"
          ? `${Field} is too long: ${i.maximum} characters at most.`
          : i.origin === "array" || i.origin === "set"
            ? `Too many ${field || "items"}: ${i.maximum} at most.`
            : `${Field} must be ${i.maximum} or less.`;
      case "too_small":
        return i.origin === "string"
          ? Number(i.minimum) <= 1
            ? `${Field} can't be empty.`
            : `${Field} is too short: at least ${i.minimum} characters.`
          : i.origin === "array" || i.origin === "set"
            ? `Add at least ${i.minimum} ${field || "items"}.`
            : `${Field} must be at least ${i.minimum}.`;
      case "invalid_type":
        return i.input === undefined
          ? `${Field} is missing.`
          : `${Field} isn't the right kind of value.`;
      case "invalid_format":
        return i.format === "email"
          ? `${Field} isn't a valid email address.`
          : i.format === "url"
            ? `${Field} isn't a valid link.`
            : i.format === "datetime" || i.format === "date"
              ? `${Field} isn't a valid date.`
              : `${Field} isn't in the right format.`;
      case "invalid_value":
        return `${Field} isn't one of the choices.`;
      case "unrecognized_keys":
        return "Some of what was sent isn't recognised. Refresh and try again.";
      case "custom":
        return i.message;
      default:
        return `${Field} isn't valid.`;
    }
  };
  const messages = [...new Set(issues.map(one))];
  return messages.slice(0, 2).join(" ") || "Something in that isn't valid.";
}
