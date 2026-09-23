# Spec-Driven Skill

## Overview

Creates specs before coding. Use when starting a new project, feature, or significant change and no specification exists yet.

## When to Use
- Starting a new project, feature, or significant change
- Requirements are unclear, ambiguous, or only exist as a vague idea
- Architecture decisions need to be documented before implementation

## When NOT to Use
- Simple bug fixes with clear solutions
- Well-documented features with existing specs
- Single-file changes

## Orbyn Workflow

### Step 1: Gather Requirements
- Read `docs/architecture.md` for existing patterns
- Check `backend/src/modules/<name>/` for similar implementations
- Review `packages/core/src/` for existing schemas and types
- Consult `docs/api.md` for existing endpoint conventions

### Step 2: Define the Spec
A spec should include:
- **Purpose:** What problem does this solve?
- **Data model:** What tables, schemas, or types are needed?
- **API surface:** What endpoints are added/modified?
- **Business rules:** What constraints must be enforced?
- **Edge cases:** What error conditions should be handled?

### Step 3: Map Dependencies
```
Database schema → API models/types → API endpoints → Frontend API client → UI components
```

### Step 4: ADR (Architecture Decision Record)
For significant changes, create an ADR in `docs/adr/` following the `adr-skill` pattern.

### Step 5: Validate Against Orbyn Constraints
- Does it follow the dependency direction? (apps → packages → core)
- Does it use `mutate()` for item writes?
- Does it enforce optimistic locking via `version`?
- Does it return 404 for cross-tenant access?
- Does it enforce the security shield (401/403/429/400)?

### Step 6: Persist the Plan
Use `update_plan` for non-trivial work with phases and ordered steps.

## Orbyn-Specific Notes

- AI features: providers go through `backend/src/modules/ai/` with adapter pattern
- Booking features: use `backend/src/modules/booking/` as reference
- Planner features: follow the pattern in `backend/src/modules/planner/`
- Notification features: use `backend/src/worker/` for scheduling and delivery

## Verification
- [ ] Spec covers purpose, data model, API surface, business rules, edge cases
- [ ] Dependencies are mapped bottom-up
- [ ] ADR created for significant architectural decisions
- [ ] Spec validated against Orbyn constraints
