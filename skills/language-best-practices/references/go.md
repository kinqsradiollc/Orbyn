# Go: contracts to preserve

## Resolve the target

Inspect go.mod language/toolchain directives, build tags, CGO and module boundaries. Use the supported compiler and gofmt; do not install an unrelated style framework.

## Apply at the affected boundary

- Carry request context explicitly through blocking operations. Every goroutine needs an owner, completion path and cancellation/shutdown behavior; a channel send can block after the receiver exits.
- Handle returned errors and wrap with context while preserving errors.Is/errors.As matching. Use panic for programmer invariants only where project policy permits it.
- Close response bodies/resources on every path and bound external reads. A defer inside a long loop retains resources until that function returns.
- Treat slices/maps/pointers as potentially shared aliases. Synchronize the whole invariant, not just individual reads; use narrow consumer-owned interfaces when a real boundary requires them.

## Worked failure and correction

A bounded worker send must notice that its request has ended:

```go
select {
case results <- result:
    return nil
case <-ctx.Done():
    return ctx.Err()
}
```

The caller still owns starting/joining workers and closing channels exactly once;
the snippet does not make an arbitrary worker pool leak-free.

## Evidence to report

Use configured package tests and go vet when authorized. The race detector observes executed paths; a clean -race run is not proof of race freedom or logical atomicity.

## Maintainability and checks

Choose packages and exported APIs from actual responsibilities. Use internal packages for implementation details when that visibility contract fits. Keep consumer interfaces narrow around real variation; do not generate one interface per struct. Preserve wrapped error identity, worker lifetime and supported toolchain behavior in representative tests.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[Go review comments](https://go.dev/wiki/CodeReviewComments), [Go race detector](https://go.dev/doc/articles/race_detector), [Go errors](https://go.dev/blog/go1.13-errors).
