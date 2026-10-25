# C: contracts to preserve

## Resolve the target

Inspect the C standard, compiler/target flags, ABI, allocation conventions and platform APIs. A .h file may belong to C, C++ or a shared ABI; resolve its real owner.

## Apply at the affected boundary

- Pair every allocation/resource with its actual release owner. Define pointer length, capacity, nullability and lifetime at each function/FFI boundary.
- Check range and multiplication/addition overflow before allocating or indexing. sizeof a pointer is not the pointed-to object size; signed overflow is not a portable wrapping contract.
- Keep byte buffers distinct from NUL-terminated strings. Check snprintf return values and capacity; a bounded call alone does not prove the result was complete.
- Use one understandable cleanup path for partial initialization. Synchronize shared invariants with the platform's atomics/locks; volatile is not thread synchronization.

## Worked failure and correction

Check an externally supplied element count before allocation:

```c
if (count > SIZE_MAX / sizeof *items) {
    return RANGE_ERROR;
}
items = malloc(count * sizeof *items);
```

Define the zero-count contract, handle allocation failure and release successful
allocation exactly once. This is an original fragment, not a complete allocator.

## Evidence to report

Use the actual compiler warnings and authorized sanitizer/behavior checks for bounds and cleanup. Sanitizers observe executed behavior and do not prove absence of undefined behavior.

## Maintainability and checks

Document public ABI ownership and caller obligations, including partial initialization and cleanup. Keep capacity/length/error conventions consistent across consumers. Use representative invalid input and failure paths in authorized checks; warnings or one sanitizer run cannot establish all lifetime and concurrency invariants.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[CERT allocation rule](https://wiki.sei.cmu.edu/confluence/spaces/flyingpdf/pdfpageexport.action?pageId=87152128), [Clang undefined-behavior sanitizer](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html).
