# Rust: contracts to preserve

## Resolve the target

Inspect Cargo.toml edition/rust-version, rust-toolchain, Cargo.lock, enabled features and target. Preserve the minimum supported Rust version and public API contracts.

## Apply at the affected boundary

- Express owned versus borrowed data deliberately. Do not add clone, Arc or a mutex just to silence the borrow checker before tracing lifetime and concurrency ownership.
- Use Result and meaningful error propagation for expected failures. Keep unwrap/expect at documented invariants, not on untrusted input or routine I/O.
- An async future can be dropped at suspension points. Cancellation does not roll back an already committed effect; design retry identity and cleanup at the effect owner.
- Keep unsafe/FFI small with explicit allocation, aliasing, alignment and lifetime invariants. Safe wrappers must uphold them for every caller. Avoid holding blocking mutex guards across await.

## Worked failure and correction

Return a borrow tied to its real input instead of allocating only to satisfy a signature:

```rust
fn first_tag(tags: &[String]) -> Option<&str> {
    tags.first().map(String::as_str)
}
```

An owned String is appropriate when the value must outlive tags. The decision is
lifetime ownership, not a blanket rule against allocation.

## Evidence to report

Use configured cargo check/test, formatting and Clippy within authorized scope. Compilation proves neither unsafe-code soundness nor transactional cancellation safety.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[Rust ownership](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html), [Cargo rust-version](https://doc.rust-lang.org/cargo/reference/rust-version.html), [Rust unsafe](https://doc.rust-lang.org/book/ch20-01-unsafe-rust.html).
