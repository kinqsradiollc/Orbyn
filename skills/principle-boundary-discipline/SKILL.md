---
name: principle-boundary-discipline
description: "Design validation and error handling at real trust or effect boundaries."
---

# Principle boundary discipline

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Parse external input once at its owner and pass typed values inward. Keep business transformations independent of framework wiring where useful. Retain runtime authority, freshness and persisted-data checks at the relevant effect; a static type cannot prove them. Avoid repeated downstream parsing or unconditional trust in internal callers.
