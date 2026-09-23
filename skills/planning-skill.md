# Planning Skill

## Overview

Decomposes work into small, verifiable tasks with explicit acceptance criteria. Use when you have a spec or clear requirements and need to break work into implementable tasks.

## When to Use
- You have a spec and need to break it into implementable units
- A task feels too large to start
- Work needs to be parallelized across multiple agents or sessions
- You need to communicate scope to a human
- The implementation order isn't obvious

## When NOT to Use
- Single-file changes with obvious scope
- When the spec already contains well-defined tasks

## Orbyn Workflow

### Step 1: Classify the Planning Contract
- **Plan/review-only:** produce the requested plan and stop
- **Plan and implement:** keep the plan current and proceed
- **Small obvious change:** skip planning, implement directly
- **Decision blocked:** pause for choice that changes scope/authority

### Step 2: Identify the Dependency Graph
```
Database schema → API models/types → API endpoints → Frontend API client → UI components
```

Implementation order follows the dependency graph bottom-up.

### Step 3: Assign Ownership Before Files
- Shared records → lowest dependency-safe package (`packages/core`)
- Host effects → ports in the owning runtime (`backend/`, `desktop/`, `mobile/`)
- Preserve supported imports during extraction

### Step 4: Slice Vertically
Build complete feature paths rather than horizontal layers:
- Bad: Build entire database → all API → all UI
- Good: User can create account (schema + API + UI for registration)

### Step 5: Verification Checkpoints
Add explicit checkpoints after every 2-3 tasks:
```
[ ] All tests pass
[ ] Application builds without errors
[ ] Core user flow works end-to-end
[ ] Review with human before proceeding
```

### Step 6: Orbyn-Specific Tasks

When planning work in Orbyn, consider:
- Backend modules in `backend/src/modules/<name>/`
- Shared types/schemas in `packages/core/src/`
- API client in `packages/api-client/src/`
- Frontend features in `desktop/src/features/` or `mobile/src/screens/`
- Migrations in `backend/src/migrations/`
- Worker logic in `backend/src/worker/`

### Step 7: Task Structure
```markdown
## Task [N]: [Short title]
**Description:** One paragraph
**Acceptance criteria:**
- [ ] Specific, testable condition
- [ ] Specific, testable condition
**Verification:**
- [ ] Tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
**Dependencies:** [Task numbers]
**Files likely touched:** [paths]
**Estimated scope:** [Small/Medium/Large]
```

## Orbyn-Specific Notes

- Always `npm run build:packages` before backend changes
- Backend type-check with `npm run typecheck`
- Frontend type-check separately via `npm run typecheck -w desktop` or `-w mobile`
- Migration changes require running `npm run migrate` on a clean database

## Verification
- [ ] Every task has acceptance criteria
- [ ] Every task has a verification step
- [ ] Task dependencies are identified and ordered correctly
- [ ] No task touches more than ~5 files unless broken down further
- [ ] Checkpoints exist between major phases
