# Development rules

## Before Any Task

1. Read `docs/architecture.md` — services, data model, reminder pipeline, access control.
2. Read `docs/setup.md` — env vars, Docker and local workflows.
3. Read `AGENTS.md` if it exists (project-level overrides).
4. Check `backend/src/config/env.ts` for canonical environment variables.
5. Check `packages/core/src/rbac.ts` for role/permission definitions.

## Dependency Rules (Strict)

```
apps (desktop, mobile) → @orbyn/api-client → @orbyn/core
backend → @orbyn/core, @orbyn/api-client
```

Never import from apps into packages, backend into packages, or packages into apps. `@orbyn/core` depends on nothing in-repo besides zod.

## Code Conventions

From `conventions-skill`: kebab-case.ts files, PascalCase components/types, camelCase functions, Prettier formatting, single quotes, 2-space indent, 100-char lines, no console.log, JSDoc for public APIs.

## Testing Rules (from `testing-skill`)

- Security shield: 401, 403, 429, 400 coverage in every integration test.
- Mock all DB layers and external integrations.
- Responses must match active specs; cover catch blocks, not-found, rate limits.

## Development Workflows

### Docker Compose

```bash
cp .env.example .env && docker compose up -d --build
```

### Local Development

```bash
cp .env.example .env
docker compose up -d postgres mailpit
npm install
npm run build:packages   # compile @orbyn/core & @orbyn/api-client first
npm run migrate
PORT=8008 npm run dev:api
npm run dev:web
```

### Commands (root)

`npm install` · `npm run build:packages` · `npm run typecheck` · `npm test` · `npm run build` · `npm run format` · `npm run format:check`
