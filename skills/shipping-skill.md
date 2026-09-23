# Shipping Skill

## Overview

Release checklist for shipping Orbyn features or versions.

## Pre-Release Checklist

- [ ] All tests pass (`npm test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Build succeeds (`npm run build`)
- [ ] Formatting passes (`npm run format:check`)
- [ ] Linting passes (`npm run lint`)
- [ ] Security shield verified for all new endpoints
- [ ] Migrations are additive only
- [ ] Environment variables documented in `docs/setup.md`
- [ ] API documentation updated in `docs/api.md`
- [ ] Architecture documentation updated in `docs/architecture.md`

## Docker Release

- [ ] `POSTGRES_PASSWORD` set correctly
- [ ] `JWT_SECRET` set correctly
- [ ] `SMTP_*` configured for production
- [ ] `ADMIN_EMAILS` configured
- [ ] `API_BIND` set to `0.0.0.0` if needed
- [ ] Gateway config verified
- [ ] Read replica configuration if scaling

## Kubernetes Release

- [ ] `deploy/k8s/` manifests updated
- [ ] Autoscaling configured
- [ ] Ingress and network policies verified
- [ ] See `deploy/k8s/README.md`

## Desktop Release

- [ ] `npm run build` succeeds
- [ ] Electron packaging works
- [ ] Platform-specific builds verified (macOS, Windows, Linux)
- [ ] Notarization completed for macOS

## Mobile Release

- [ ] Expo EAS project configured
- [ ] Native push credentials set up
- [ ] Development or distribution build tested on physical device
- [ ] Notifications verified
- See `docs/mobile.md`

## When to Use
- Before any production release
- Before creating a PR
- Before deploying to staging/production

## NOT for
- Local development iterations
- Planning-only work

## Verification
- [ ] All pre-release checklist items pass
- [ ] All deployment-specific checklist items pass
