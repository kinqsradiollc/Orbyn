# Python: contracts to preserve

## Resolve the target

Inspect pyproject.toml or packaging metadata, lockfile, interpreter floor and the actual sync/async entry point. Preserve the configured environment manager.

## Apply at the affected boundary

- Own files/connections with context managers and close async resources before their event loop ends. Do not perform blocking I/O directly in a coroutine's event loop.
- Propagate asyncio cancellation after cleanup. TaskGroup requires Python 3.11+; do not backport its syntax into an older target or swallow BaseException to make a job look successful.
- Type hints and dataclasses do not validate external values. Parse at the boundary and keep mutable defaults per instance.
- Distinguish bytes from text and naive from timezone-aware timestamps at transport/storage boundaries. Avoid mutable default arguments and broad exception-to-success fallbacks.

## Worked failure and correction

Two instances must not share a pending-work list:

```python
from dataclasses import dataclass, field

@dataclass
class PendingWork:
    ids: list[str] = field(default_factory=list)
```

The factory fixes per-instance ownership; it does not make concurrent mutation
safe or turn parsed strings into authorized task identifiers.

## Evidence to report

Use the configured type checker and formatter, then authorized focused tests for malformed input, cleanup or cancellation. Do not claim a type checker validates runtime input.

## Maintainability and checks

Keep imports free of unrequested network/runtime setup. Make package boundaries and supported Python syntax explicit; avoid sys.path patches as a substitute for understanding packaging. Libraries can emit scoped logs while the application owns handlers and export policy. Use real parser/fixture boundaries and register cleanup during partial setup.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[Python 3.13 asyncio](https://docs.python.org/3.13/library/asyncio-task.html), [Python 3.13 dataclasses](https://docs.python.org/3.13/library/dataclasses.html).

[Python logging ownership](https://docs.python.org/3/library/logging.html).
