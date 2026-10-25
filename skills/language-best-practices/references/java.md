# Java: contracts to preserve

## Resolve the target

Inspect Maven/Gradle wrapper, Java toolchain/release target and dependency locks. Verify records, sealed types and virtual-thread support against that target.

## Apply at the affected boundary

- Keep construction valid and expose explicit domain states; records do not automatically validate fields or make referenced collections immutable.
- Use try-with-resources for owned AutoCloseable resources. Preserve the primary failure and suppressed close failures; garbage collection does not provide timely resource release.
- Propagate InterruptedException when the interface allows it. If translating it, restore the interrupt flag and preserve cancellation semantics rather than retrying forever.
- Keep JDBC parameters, transaction boundaries and executor lifetime explicit. Virtual threads are an I/O concurrency tool, not a measured CPU acceleration. Avoid mutable map keys and platform-default text encodings at contracts.

## Worked failure and correction

Translate interruption without losing the signal:

```java
try {
    worker.join();
} catch (InterruptedException failure) {
    Thread.currentThread().interrupt();
    throw new IllegalStateException("Join interrupted", failure);
}
```

Prefer propagating InterruptedException when callers can handle it directly;
translation belongs at an interface that requires it.

## Evidence to report

Use the project wrapper and configured compiler/analyzers plus scoped authorized tests. Building on a newer developer JDK alone does not establish compatibility with the deployment release.

## Maintainability and checks

Keep public interfaces, exception meanings and deployment release compatibility explicit. Do not expose persistence/vendor exceptions as API results or treat a record containing a mutable collection as deeply immutable. Use the existing build wrapper and effect-owned fixtures; a developer JDK build alone does not qualify the deployment target.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[JLS 25 resource statements](https://docs.oracle.com/javase/specs/jls/se25/html/jls-14.html#jls-14.20.3), [JDK 25 Thread contract](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html).
