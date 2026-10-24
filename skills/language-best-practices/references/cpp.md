# C++: contracts to preserve

## Resolve the target

Inspect CMake/build manifests, supported C++ standard, compiler/standard library, ABI and exception/RTTI policy. Do not force a newer dialect or dependency into an existing target.

## Apply at the affected boundary

- Use RAII and owning standard containers/unique ownership by default where they match the interface. Prefer the rule of zero; document non-owning pointer/reference lifetimes.
- string_view/span borrow storage; they do not extend its lifetime. Inspect invalidation from reallocation, moves and escaping callbacks.
- Preserve exception guarantees and project error policy. Destructors must not leak exceptions during unwinding; transaction commitment belongs to the effect owner.
- Keep locks scoped to the complete invariant and avoid callbacks/blocking I/O under locks unless required. shared_ptr does not synchronize the pointed-to state and can form retention cycles.

## Worked failure and correction

A returned view must not refer to a temporary:

```cpp
// Return owned text when construction happens inside the function.
std::string display_name(const User& user) {
    return user.first + " " + user.last;
}
```

Returning string_view here would borrow destroyed storage. A view can be suitable
when the caller owns stable backing storage for the full use interval.

## Evidence to report

Use the configured compiler/format/analyzer and authorized sanitizer or concurrency checks for the changed path. A clean build does not establish ABI compatibility or lifetime safety.

## Maintainability and checks

Keep ownership and exception guarantees visible in public interfaces. Avoid exposing implementation types solely to save a wrapper or using shared_ptr as a concurrency policy. Match supported standard/ABI and real caller needs; test observable behavior and lifetime boundaries rather than private class choreography.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines), [Clang address sanitizer](https://clang.llvm.org/docs/AddressSanitizer.html).
