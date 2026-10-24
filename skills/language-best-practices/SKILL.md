---
name: language-best-practices
description: "Implement or review TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, Swift, C, C++, SQL or shell code using its actual runtime, ownership and error contracts. Select only the affected local guide, including TypeScript schemas and lifecycle contracts."
---

# Apply the language's actual contracts

Use this skill for code changes and language-specific review. Resolve the consuming
checkout, instructions and affected files with [how](../how/SKILL.md). Read the
project's manifests, lockfiles, compiler/runtime targets, formatter and existing
callers. A file extension is a routing hint, not proof of an application's stack,
version, deployment model or permission to migrate it.

## Select only the relevant guide

| Changed code                                      | Local guide                            | Additional owner when relevant              |
| ------------------------------------------------- | -------------------------------------- | ------------------------------------------- |
| JavaScript, Node, browser JS                      | [JavaScript](references/javascript.md) | TypeScript schemas → TypeScript guide       |
| Python                                            | [Python](references/python.md)         | API effects → backend design                |
| Go                                                | [Go](references/go.md)                 | Durable workers → backend design            |
| Rust                                              | [Rust](references/rust.md)             | FFI/data boundaries → architect             |
| Java                                              | [Java](references/java.md)             | JVM interop → Kotlin guide only if affected |
| Kotlin                                            | [Kotlin](references/kotlin.md)         | Android lifecycle/UI → UI design            |
| C# / .NET                                         | [C#](references/csharp.md)             | Database effects → backend design           |
| Swift                                             | [Swift](references/swift.md)           | Platform interaction → UI design            |
| C                                                 | [C](references/c.md)                   | ABI/interface ownership → architect         |
| C++                                               | [C++](references/cpp.md)               | C interop → C guide only if affected        |
| SQL                                               | [SQL](references/sql.md)               | Stored changes → data migration             |
| POSIX shell / Bash / zsh                          | [Shell](references/shell.md)           | Automation trust → CI design                |
| TypeScript, including schemas and lifecycle types | [TypeScript](references/typescript.md) | JS runtime guide only for runtime effects   |

For a polyglot boundary, load the guides on both sides of the actual interface,
not every guide in the repository. For an unlisted language, preserve the project's
owning conventions and use focused research; do not guess that a neighboring
language has the same semantics. The optional dependency-free
[router](scripts/language_guides.py) maps provided repository-relative paths to
local guides; the agent can use it directly. It reads names only and executes no
project code. It does not crawl the workspace, identify versions, choose frameworks
or guarantee that a header is C rather than C++.

## Carry the behavior through its callers

Identify who owns memory/resources, cancellation, mutable state and the committed
effect. Preserve input validation, authority, error meaning and cleanup across
language/FFI/process boundaries. Static annotations, deserialization and a successful
compile do not establish valid domain state or tenant authorization. Define byte
encoding, numeric ranges, nullability and error transport explicitly at those
boundaries; do not silently truncate identifiers or timestamps.

Use the existing project's idioms and supported version. Add a dependency or new
abstraction only when a demonstrated requirement justifies it. When the choice of
language/runtime/framework is itself unsettled, use
[stack selection](../orbyn-stack-selection/SKILL.md); routine coding is not a reason
to reconsider the whole stack. Domain/API design stays with
[architect](../architect/SKILL.md) and [backend design](../orbyn-backend-design/SKILL.md).

Select authorized checks by the changed contract under
[CI design](../orbyn-ci-design/SKILL.md): relevant compiler/analyzer/formatter and
failure-sensitive behavior checks. Reuse configured commands and disposable
fixtures. Do not install twelve toolchains, run all suites or claim production,
platform, race freedom or live-agent qualification from these written examples.

The language owner includes independently authored operational guidance and
synthetic examples. Its consolidated TypeScript guide retains its adapted source
lineage and [original notice](references/typescript-LICENSE.txt); consolidation
does not change that history. Dated primary references are evidence/update
pointers; the instructions work offline. Preserve target-version uncertainty
rather than claiming moving documentation describes the installed environment.
