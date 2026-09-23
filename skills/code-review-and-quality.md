# Code Review and Quality Skill

## Overview

Review standards for code in the Orbyn codebase. Use when reviewing code, conducting PR reviews, or performing quality audits.

## Review Checklist

### Correctness
- [ ] Does the code solve the stated problem?
- [ ] Are edge cases handled?
- [ ] Are error paths properly handled with custom `*Error` classes?
- [ ] Are async functions using `try/catch`?

### Security
- [ ] Is the security shield enforced (401/403/429/400)?
- [ ] Are ownership checks enforced in SQL with `user_id`?
- [ ] Are cross-tenant accesses returning 404 not 403?
- [ ] Are passwords hashed with argon2?
- [ ] Are AI provider keys encrypted at rest?
- [ ] Are API keys stored hashed?
- [ ] Are tokens stored as SHA-256 digests?

### Architecture
- [ ] Does it follow the dependency direction? (apps → packages → core)
- [ ] Are items written through `mutate()` with optimistic locking?
- [ ] Are AI calls routed through the `ai` service?
- [ ] Are reminders handled by the `notifier` worker?
- [ ] Are migrations additive only?

### Code Style
- [ ] Prettier formatting is applied?
- [ ] Imports are ordered correctly?
- [ ] No `console.log` statements?
- [ ] Functions are under 50 lines?
- [ ] JSDoc on public API functions?
- [ ] Comments explain *why*, not *what*?

### Testing
- [ ] Security shield tests present?
- [ ] Database calls are mocked?
- [ ] External integrations are mocked?
- [ ] Response schema matches specs?
- [ ] Error cases are covered?

## Orbyn-Specific Notes

- Review backend routes in `backend/src/modules/<name>/routes.ts`
- Check that module owners match the service boundaries in `app.ts`
- Verify `serviceModules` mapping in `backend/src/app.ts` is correct
- Ensure `packages/core/src/rbac.ts` permissions match the code
- Check that `backend/src/config/env.ts` has all required env vars

## When to Use
- Reviewing pull requests
- Code quality audits
- Pre-merge checks
- Any code change that affects shared modules

## Verification
- [ ] All correctness checks pass
- [ ] All security checks pass
- [ ] All architecture constraints satisfied
- [ ] All code style checks pass
- [ ] All test requirements met
