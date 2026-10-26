# Orbyn documentation

Orbyn is developed in public by Anh Dang, a University of Melbourne student.
See the [creator/contact details](../README.md#creator-and-contact),
[contribution workflow](../README.md#contributing) and
[MIT application license](../LICENSE).

Start with the guide for the task. Current implementation and configuration define
the contract; check the owning source when a guide and code disagree. Old ADR
queues and checkpoint transcripts have been retired from the active tree.

## Product overview

Orbyn covers tasks, calendars, projects, documents, study and assistant work across
web/desktop and mobile. Start with [the repository overview](../README.md),
[Assistant](assistant.md), [Docs architecture](architecture.md#workspace-and-document-ownership)
and [Admin Publishing](admin-publishing.md). Features that need rollout flags,
provider consent or external service setup describe those conditions in their guide.

## Develop Orbyn

| Need                                         | Guide                                                  |
| -------------------------------------------- | ------------------------------------------------------ |
| Engineering workspace and contribution setup | [CONTRIBUTING](../CONTRIBUTING.md)                     |
| Stack, source conventions, commands and CI   | [Development](development.md)                          |
| Environment and service ownership            | [Operations](operations.md)                            |
| UI and product copy                          | [Product design](design.md)                            |
| Verification scope and receipts              | [Verification](verification.md)                        |
| Retained source snapshots and licenses       | [Third-party notices](../tools/THIRD_PARTY_NOTICES.md) |

## Product and operations

| Need                                 | Guide                                                                                  | Owning source                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Local environment and services       | [Setup](setup.md), [environment](environment.md)                                       | `compose.yaml`, `.env.example`, `backend/src/config/env.ts`           |
| Architecture and data flow           | [Architecture](architecture.md)                                                        | `backend/src/app.ts`, shared packages and owning modules              |
| HTTP contract                        | [API](api.md), [OpenAPI](openapi.yaml)                                                 | Backend routes and shared schemas                                     |
| Assistant chats and automation       | [Assistant](assistant.md), [conversation API](api.md#retained-assistant-conversations) | `backend/src/modules/assistant-workspace/`, `backend/src/modules/ai/` |
| Changelog, image drafts and LinkedIn | [Admin Publishing](admin-publishing.md)                                                | `backend/src/modules/publishing/`, web admin UI                       |
| MCP connector                        | [MCP](mcp.md), [catalog](mcp-catalog.json), [runbook](runbooks/agents.md)              | `backend/src/modules/mcp-server/`, `backend/src/capabilities/`        |
| Plugin service                       | [Plugin](plugin.md)                                                                    | `backend/src/modules/plugin/`                                         |
| Mobile app                           | [Mobile](mobile.md)                                                                    | `mobile/package.json`, app configuration and screens                  |
| Deployment and recovery              | [Deployment](deployment.md), [scalability](scalability.md)                             | Deployment scripts, Compose and Kubernetes manifests                  |
| Hosted planner usage                 | [Connector skill](agent-skill/orbyn/SKILL.md)                                          | Public tool contract, separate from developer-agent workflow          |

## Architecture work

- [Architecture consolidation](work/adr-architecture-consolidation.md) — accepted direction for
  ownership boundaries, current and proposed topology diagrams, and a phased
  migration plan. Queue ownership, placement, booking delivery, service
  composition, shared assistant lifecycle, planner reconciliation and admission
  policy have local implementation and verification evidence. Deployment and
  installed-client acceptance remain open.

These product references describe application behavior; changing development
skills does not by itself change API routes, security controls or deployment.
Current verification is attached to a specific candidate and task, never inferred
from an old report or this index. Dated work records preserve historical delivery
state; they do not install engineering policy.
