# Conventions Skill

## Overview

Applies coding conventions to all new code in the Orbyn codebase. Load this before writing new files, adding features, or conducting code reviews.

## Workflow

### [CONV-001] Naming
- Files: `kebab-case` for all files (`user-service.ts`, `location-controller.ts`)
- React components: `PascalCase.tsx` (`SpotCard.tsx`, `AuthGuard.tsx`)
- Functions & variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Types & Interfaces: `PascalCase`, no `I` prefix (`User`, not `IUser`)
- Event handlers: `handleEventName` pattern (`handleSubmit`, `handleDelete`)

### [CONV-002] Code Style
- Formatter: Prettier
- Quotes: single quotes for strings
- Semicolons: required
- Line length: 100 characters max
- Indentation: 2 spaces
- No `console.log` in committed code — use the project logger

### [CONV-003] Import Order
1. External packages (`react`, `express`, `zod`)
2. Internal modules (`@/lib`, `@/services`, `@/components`)
3. Relative imports (`./utils`, `../types`)
4. Type imports (`import type {}`) — always last
- Blank line between each group; alphabetical within groups

### [CONV-004] Error Handling
- Throw errors, catch at route/boundary level — not deep in utilities
- Custom errors extend `Error` class, named `*Error` (`ValidationError`, `NotFoundError`)
- Async functions use `try/catch` — no `.catch()` chains
- Always log error context before re-throwing

### [CONV-005] Function Design
- Keep functions under 50 lines; extract helpers for complex logic
- Max 3 parameters — use an options object for 4+
- Destructure object parameters in the signature: `function fn({ id, name }: Params)`
- Use explicit `return` statements; return early for guard clauses

### [CONV-006] Module Design
- Named exports preferred; default exports only for React components
- Barrel files (`index.ts`) re-export the public API only
- Do not export internal helpers from barrel files
- Avoid circular dependencies — import from specific files if needed

### [CONV-007] Comments
- Explain *why*, not *what*
- Document business rules and non-obvious algorithms
- JSDoc required for public API functions (`@param`, `@returns`, `@throws`)
- TODOs: `// TODO: description` — link to issue number if available

## Orbyn-Specific Notes

- Backend routes are in `backend/src/modules/<name>/routes.ts`
- Module services are in `backend/src/modules/<name>/service.ts`
- Use `createService` pattern from `backend/src/services/http.ts`
- All item mutations go through `mutate()` with optimistic locking
- AI agent tools are in `backend/src/modules/ai/agent/tools.ts`
- Guard functions for AI intent detection are in `backend/src/modules/ai/guards.ts`
- UI follows AGENT.md "UI Conventions": theme tokens only (never new colours), the radius
  scale (`--radius-xs/sm/md/lg/pill`, mobile `radii.*`), and Orbyn's own controls — `Select`,
  `DateField`, and the global field/checkbox styles — never a bare browser control
- Long-lived connections go on the `realtime` service; fan-out through Postgres NOTIFY

## Required Checks

- File and function names match `CONV-001` patterns
- No `console.log` left in committed code
- Imports are ordered and grouped per `CONV-003`
- All async code uses `try/catch`
- Functions stay under 50 lines

## When to Use
- Creating new modules, adding endpoints, writing frontend components
- Local codebase cleanups and refactoring
- Any new code in the Orbyn repo

## NOT for
- Simple documentation-only changes
- Config modifications

## Verification
- [ ] Prettier/ESLint rules have been run and all styling warnings are cleared
- [ ] All imported modules are ordered according to standard grouping
- [ ] Functions are short, clean, well-scoped, and documented where necessary
