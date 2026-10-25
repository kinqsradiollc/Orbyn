# C# / .NET: contracts to preserve

## Resolve the target

Inspect global.json, target frameworks, language version, nullable context and package locks. Preserve the configured SDK, analyzers and dependency injection lifetimes.

## Apply at the affected boundary

- Nullable annotations help static reasoning; still validate external/deserialized values. Records and readonly references do not recursively freeze mutable objects.
- Return and await Task/ValueTask work; reserve async void for interfaces that require it, such as event handlers with explicit error handling. Propagate the matching CancellationToken.
- Keep IDisposable/IAsyncDisposable alive until dependent asynchronous work finishes. Use using/await using according to the implemented disposal interface.
- Do not share scoped mutable services such as a DbContext across concurrent operations. Inspect deferred IEnumerable execution, repeated enumeration and database query shape before optimizing.

## Worked failure and correction

Keep the resource alive through the asynchronous read:

```csharp
async Task<string> ReadAsync(string path, CancellationToken token)
{
    using var reader = File.OpenText(path);
    return await reader.ReadToEndAsync(token);
}
```

This example requires a target supporting that overload. Returning the unfinished
task from inside using can dispose reader too early.

## Evidence to report

Use the configured dotnet build/analyzers and scoped authorized tests on supported targets. A cancellation request is cooperative; it does not establish that remote effects were undone.

## Maintainability and checks

Match dependency-injection lifetime to the state and resources owned. A singleton must not capture request-scoped mutable work. Distinguish container-owned disposal from explicitly constructed resources, and preserve async completion before a scope ends. Validate behavior at the actual target framework rather than relying on nullable annotations alone.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[C# disposal statements](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/using), [Disposal with unawaited work](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca2025), [.NET cancellation](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/task-cancellation).

[.NET dependency injection lifetimes and disposal](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines).
