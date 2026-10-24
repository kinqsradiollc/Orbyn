# TypeScript contracts from unknown input to committed effect

Read the project's compiler target, strictness options and runtime schema owner.
Keep module dependency direction and supported syntax; a best-practice example
does not authorize adopting a new schema library or changing the compiler.

## Represent one lifecycle

This synthetic interface illustrates the invariant; substitute the project's
own validated ID and result types:

```ts
type Review =
  | { kind: "waiting"; question: string; version: number }
  | { kind: "applied"; receipt: string; version: number }
  | { kind: "rejected"; reason: string; version: number };

function caption(review: Review): string {
  switch (review.kind) {
    case "waiting":
      return review.question;
    case "applied":
      return review.receipt;
    case "rejected":
      return review.reason;
    default: {
      const unreachable: never = review;
      return unreachable;
    }
  }
}
```

The union excludes a waiting state without a question. It does not parse JSON,
prove tenant access or establish that the stored version is current. Parse
external or persisted `unknown` with the owning runtime schema, then derive the
TypeScript type from that schema when the existing tooling supports it. Avoid a
second hand-maintained union in each client.

## Preserve runtime meaning

Use `satisfies` when checking a literal while retaining useful inferred keys.
Use narrowing and explicit error variants instead of non-null assertions or
blanket `as` casts. Localize unavoidable FFI/vendor assertions and state their
invariant. Do not use `any` to bypass an unresolved contract.

Distinguish missing values from valid falsy values, serialization from internal
objects, and optional fields from explicit nullable states. Resolve date, integer
range and identifier encoding at transport boundaries. A branded identifier can
prevent accidental parameter swaps internally; it cannot validate a raw string.

Cancellation must reach the actual effect. Decide who closes streams, timers and
subscriptions on success, failure and abandonment. A resolved promise does not
establish an external effect's known outcome after a timeout.

## Review one change through its callers

For a new lifecycle variant, update the schema, serialization, shared client and
affected consumers. Check exhaustive handling and failure behavior using existing
authorized commands. For a versioned write, retain current authorization and a
conditional update at persistence; a typed request alone does not prevent stale
writes. Released clients and stored formats may need a compatibility window.

Return the invariant, owning schema, migrated callers, justified assertions and
actual compiler/runtime evidence. This example has been structurally reviewed;
it is not a receipt that every consuming project's compiler or runtime passed.
