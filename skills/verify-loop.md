# Verify Loop Skill

## Overview

Final verification loop before any code is considered complete. Run this before marking work done.

## Workflow

### Step 1: Build Verification
```bash
npm run build:packages && npm run build -w backend && npm run build -w desktop
```
- [ ] Build succeeds without errors
- [ ] All packages compile to `dist/`

### Step 2: Type Checking
```bash
npm run typecheck
```
- [ ] No TypeScript errors in any workspace
- [ ] All types are correct

### Step 3: Tests
```bash
npm test
```
- [ ] All backend integration tests pass
- [ ] Security shield verified (401/403/429/400)
- [ ] Mocking is correct (no live connections)
- [ ] Response schema matches specs
- [ ] Error cases are covered

### Step 4: Formatting
```bash
npm run format:check
```
- [ ] Prettier formatting is consistent
- [ ] No formatting warnings

### Step 5: Linting
```bash
npm run lint
```
- [ ] No linting errors
- [ ] No `console.log` statements

### Step 6: Manual Verification
- [ ] Core user flow works end-to-end
- [ ] New functionality works as expected
- [ ] No regressions in existing functionality

### Step 7: Deployment Check (if applicable)
- [ ] Docker compose services healthy
- [ ] Health endpoints responding
- [ ] Database migrations applied
- [ ] Environment variables correct

## Orbyn-Specific Verification

- [ ] Dependency direction is respected (apps → packages → core)
- [ ] Optimistic locking via `version` is enforced
- [ ] Cross-tenant access returns 404 not 403
- [ ] AI providers are configured via Admin → AI, not `.env`
- [ ] Notifier worker handles scheduling and delivery correctly
- [ ] Migration files are additive only
- [ ] `packages/core/src/rbac.ts` permissions match the code
- [ ] `backend/src/app.ts` `serviceModules` mapping is correct
- [ ] Changed screens previewed on web (5174) and mobile web (8083): rounded corners, no
      content touching a box's edge, no overflow past a panel, repeated controls aligned
- [ ] No native `<select>` or date/time `<input>` in desktop code (`Select`, `DateField`)

## When to Use
- Before marking any task complete
- Before creating a PR
- Before deployment
- After any code change

## NOT for
- Initial exploration
- Investigation tasks
- Planning-only work

## Verification
- [ ] All verification steps pass
- [ ] No skipped verification steps
- [ ] All issues resolved before marking complete
