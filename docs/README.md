# Orbyn documentation

Start with the guide for the task. Current implementation and configuration define
the contract; check the owning source when a guide and code disagree. Old ADR
queues and checkpoint transcripts have been retired from the active tree.

## Develop Orbyn

| Need | Guide |
| --- | --- |
| Repository rules | [AGENTS.md](../AGENTS.md) |
| Engineering workflow and skills | [Skill index](../skills/README.md) |
| Stack and skill integration | [Stack](agents/stack.md), [skill system](agents/skill-system.md) |
| Agent responsibilities | [Orbyn roles](agents/roles.md) |
| Project sessions and subagents | [Coordination](agents/coordination.md) |
| Codex and Claude defaults | [Model policy](agents/model-policy.md) |
| Source conventions and commands | [Development](agents/development.md) |
| UI and product copy | [UI/UX](agents/ui-ux.md) |
| Checks, handoff and delivery | [Verification](verification.md), [delivery](agents/delivery.md), [status](agents/status.md) |
| Documentation ownership | [Documentation policy](agents/documentation.md) |
| Imported tools and attribution | [Tooling](agents/tooling.md) |

## Product and operations

| Need | Guide | Owning source |
| --- | --- | --- |
| Local environment and services | [Setup](setup.md), [environment](environment.md) | `compose.yaml`, `.env.example`, `backend/src/config/env.ts` |
| Architecture and data flow | [Architecture](architecture.md) | `backend/src/app.ts`, shared packages and owning modules |
| HTTP contract | [API](api.md), [OpenAPI](openapi.yaml) | Backend routes and shared schemas |
| MCP connector | [MCP](mcp.md), [catalog](mcp-catalog.json), [runbook](runbooks/agents.md) | `backend/src/modules/mcp-server/`, `backend/src/capabilities/` |
| Plugin service | [Plugin](plugin.md) | `backend/src/modules/plugin/` |
| Mobile app | [Mobile](mobile.md) | `mobile/package.json`, app configuration and screens |
| Deployment and recovery | [Deployment](deployment.md), [scalability](scalability.md) | Deployment scripts, Compose and Kubernetes manifests |
| Hosted planner usage | [Connector skill](agent-skill/orbyn/SKILL.md) | Public tool contract, separate from developer-agent workflow |

These product references describe application behavior; changing development
skills does not by itself change API routes, security controls or deployment.
Current verification is attached to a specific candidate and task, never inferred
from an old report or this index. See [migration notes](agents/migration.md) for
the documentation retirement and recovery record.
