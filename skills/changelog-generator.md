# Changelog Generator Skill

## Overview

Generates changelog entries for Orbyn releases.

## Workflow

### Step 1: Gather Changes
- `git log --oneline` since last release
- `git diff` for the current branch
- Check for new features, bug fixes, and breaking changes

### Step 2: Categorize Changes
- **Features:** New functionality added
- **Fixes:** Bug fixes
- **Breaking:** Breaking changes
- **Docs:** Documentation updates
- **Chore:** Maintenance, dependency updates

### Step 3: Generate Changelog
Format:
```markdown
## [Version] - YYYY-MM-DD

### Added
- Feature 1
- Feature 2

### Fixed
- Bug fix 1
- Bug fix 2

### Changed
- Breaking change 1

### Documentation
- Doc update 1

### Chores
- Maintenance 1
```

### Step 4: Verify
- All changes are accounted for
- Version number follows semver
- Dates are accurate
- Breaking changes are clearly marked

## Orbyn-Specific Notes

- Reference PR numbers from GitHub
- Include commit hashes for significant changes
- Note any deployment-related changes
- Mention AI provider changes if applicable

## When to Use
- Before a release
- After a set of changes
- When preparing documentation

## Verification
- [ ] All changes categorized
- [ ] Version number and date accurate
- [ ] Breaking changes clearly marked
