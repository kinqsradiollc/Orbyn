# Incremental Skill

## Overview

Guides incremental delivery in the Orbyn codebase. After each increment, verify the change is complete and does not break existing functionality.

## Workflow

### Incremental Checklist
After each increment, verify:

- [ ] The change does one thing and does it completely
- [ ] All existing tests still pass (`npm test`)
- [ ] The build succeeds (`npm run build`)
- [ ] Type checking passes (`npx tsc --noEmit`)
- [ ] Linting passes (`npm run lint`)
- [ ] The new functionality works as expected
- [ ] The change is committed with a descriptive message

## Orbyn-Specific Notes

- Run `npm run build:packages` first if shared packages are affected
- For backend changes: run `npm test` and `npm run typecheck`
- For frontend changes: run `npm run build` in the relevant package
- For migrations: ensure `npm run migrate` succeeds in a clean database
- Verify the security shield for any new API endpoints
- Run `npm run format:check` to ensure code style compliance

## Verification

After a successful run, don't repeat the same command unless the code has changed since. Re-running on unchanged code adds no information.

## When to Use
- After any code change that could affect tests, build, or type checking
- Before committing changes
- When reviewing pull requests
- Before deployment

## NOT for
- Initial exploration or investigation tasks
- Planning-only work

## Verification
- [ ] All checklist items pass
- [ ] No repeated verification commands on unchanged code
