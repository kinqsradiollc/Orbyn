# Testing Skill

## Overview

Applies testing standards to all new code in the Orbyn codebase. Load this before writing tests or conducting code reviews.

## Workflow

### [TEST-001] Security Shield Verification
Integration tests must verify the entire request-handling ingress pipeline:

- Confirm `401 Unauthorized` responses when requests are unauthenticated
- Confirm `403 Forbidden` responses when requests lack required roles
- Confirm `429 Too Many Requests` when rate limits are exceeded (using mocks)
- Confirm `400 Bad Request` when structural input validation fails (Zod)

### [TEST-002] Mandatory Mocking
- Never run unit or integration tests against a live production database or external system
- Mock all database querying layers (such as `readQuery`, `writeQuery`)
- Mock all external integrations (Cloud storage, email transmitters, Redis cache)

### [TEST-003] Response Schema Consistency
- Ensure API responses precisely match active specifications
- Use `expect.objectContaining` or json-schema snapshot comparisons

### [TEST-004] Error Case Coverage
- Exercise failure branches
- Tests must cover `catch` blocks, invalid formats, entity-not-found exceptions, and rate limit occurrences

## Orbyn-Specific Notes

- Backend tests are in `backend/tests/` — integration tests using `tsx --test`
- Test database: `orbyn_test` (started via `docker compose --profile test up -d postgres-test`)
- Use mock injection for database layers and external services
- AI provider calls must be mocked — never hit real endpoints in tests
- Test the security shield (auth, roles, rate limits) for every new endpoint

## Running Tests

```bash
# Build packages first, then run backend tests
npm test

# With test Docker services
docker compose --profile test up -d postgres-test
npm test
```

## Required Checks

- [ ] Security shield verification for every new endpoint
- [ ] No live database or external system calls in tests
- [ ] Response schema matches active specs
- [ ] Error cases are covered

## When to Use
- Writing new integration tests
- Adding endpoints to the API
- Reviewing existing test coverage
- Any backend code changes

## NOT for
- Simple documentation-only changes
- Config-only modifications

## Verification
- [ ] All security shield checks pass
- [ ] No live connections in test code
- [ ] Response schema matches specs
- [ ] Error cases covered
