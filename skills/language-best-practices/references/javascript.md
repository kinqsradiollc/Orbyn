# JavaScript: contracts to preserve

## Resolve the target

Inspect package.json, lockfile, module type, engines and actual browser/Node/worker target. Preserve CommonJS/ESM boundaries and supported syntax.

## Apply at the affected boundary

- Return or await every promise that belongs to the operation. A rejected Promise.all does not cancel sibling work; propagate an AbortSignal to APIs that support it and settle owned work before releasing its resources.
- Keep CPU-heavy work off latency-sensitive event loops when measurement justifies a worker. Async syntax does not parallelize CPU work.
- Validate network/storage input before domain use. Keep authorization at the effect, avoid executable HTML/string evaluation and preserve URL/origin policy.
- Separate missing values from valid falsy values. Choose nullish defaults deliberately; preserve numeric/serialization limits at API boundaries.

## Worked failure and correction

A resource scope closes before an unreturned request completes:

```js
// Incomplete lifecycle: the caller cannot await the write.
function save(writer, payload) {
  writer.write(payload);
}
// The owning caller awaits this promise before closing writer.
async function save(writer, payload) {
  await writer.write(payload);
}
```

A detached task is valid only when another explicit owner handles its errors,
cancellation and shutdown; adding void does not create that owner.

## Evidence to report

Use the configured runtime and lint/type checks for the touched module. A passing promise fixture does not prove browser rendering or cancellation of an unsupported underlying API.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[MDN promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises), [Node packages/module boundaries](https://nodejs.org/api/packages.html).
