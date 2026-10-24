# Swift: contracts to preserve

## Resolve the target

Inspect Package.swift, resolved dependencies, Xcode/Swift language mode and deployment targets. Concurrency checking and SDK availability depend on that actual configuration.

## Apply at the affected boundary

- Use value/reference semantics deliberately and make ownership of escaping closures explicit. Apply weak references for real retain cycles, not mechanically to every closure.
- Respect actor isolation and Sendable contracts. Do not silence a demonstrated cross-actor mutation with unchecked annotations before fixing its owner.
- Treat cancellation as cooperative and keep child tasks attached to their intended lifecycle. A detached or unstructured Task requires explicit lifetime/error ownership.
- Keep UI state on its platform owner (often MainActor). Preserve throwing errors and avoid forced unwrap/try on external data. Codable decoding does not establish domain authorization.

## Worked failure and correction

An actor can still interleave work at await. For a save based on a revision:

1. Capture the revision before the asynchronous operation.
2. After await, verify the state still matches that revision.
3. Commit through the owning authority or reject/retry with a bounded policy.

Actor isolation prevents overlapping unsynchronized access; it does not make the
entire suspended operation an atomic transaction.

## Evidence to report

Use the supported toolchain build/checks and authorized target tests. A package build is not iOS interaction, device behavior or proof of freedom from logical races.

## Maintainability and checks

Keep actor/public API and SDK availability explicit. Revalidate state after suspension when another operation can change the invariant. Test a meaningful asynchronous interleaving or recovery boundary when authorized; do not silence isolation diagnostics with unchecked annotations or claim a package build qualifies device behavior.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[Swift concurrency](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/), [Swift ARC](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting/).
