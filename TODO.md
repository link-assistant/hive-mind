# TODO: CI/CD Pipeline Migration to Trusted Publishing and Changesets

This file tracks the remaining work for migrating the CI/CD pipeline to use npm Trusted Publishing (OIDC) and changesets for version management.

## Completed

- [x] Created `.changeset/config.json` - Configuration for changesets
- [x] Created `.changeset/README.md` - Developer documentation for using changesets
- [x] Created `.github/workflows/release.yml` - New release workflow with:
  - Changesets action for version management
  - npm Trusted Publishing (OIDC) - no NPM_TOKEN needed
  - Automatic GitHub releases
  - Docker image publishing
  - Helm chart releases
- [x] Created `.github/workflows/ci.yml` - Refactored CI workflow (from main.yml):
  - Removed publishing logic (moved to release.yml)
  - Removed version bump verification (changesets handles this)
  - Focused on testing and validation only
- [x] Updated `package.json` with:
  - Added `@changesets/cli` as dev dependency
  - Added scripts: `changeset`, `version`, `release`, `build:pre`

## TODO - Before Merging

### 1. Configure npm Trusted Publisher (Required)

**On npmjs.com:**
1. Go to https://www.npmjs.com/package/@link-assistant/hive-mind
2. Navigate to Settings > Trusted Publishers
3. Add a trusted publisher with:
   - **Provider**: GitHub Actions
   - **Organization**: link-assistant
   - **Repository**: hive-mind
   - **Workflow filename**: `release.yml`
   - **Environment**: (leave empty or create one for approvals)

### 2. Verify npm CLI Version

The release workflow should use npm v11.5.1+ for Trusted Publishing. The `actions/setup-node@v4` with `node-version: 20` should provide this, but verify.

### 3. Remove Old Workflow

**Important**: The old `main.yml` is kept during the transition period. Once the new workflows are verified working:
- [ ] Delete `.github/workflows/main.yml` (or rename to `main.yml.bak` for reference)
- [ ] The new structure will be:
  - `ci.yml` - All CI checks (tests, lint, docker checks, etc.)
  - `release.yml` - Release automation (changesets, npm publish, docker, helm)
  - `cleanup-test-repos.yml` - (unchanged)
  - `helm-pr-check.yml` - (unchanged, but may be redundant with ci.yml)

### 4. First Release with New System

After merging this PR:
1. Create a changeset for the next change:
   ```bash
   npx changeset
   ```
2. Select the package and version bump type
3. Write a summary of changes
4. Commit and push the changeset file
5. When merged, changesets action will create a "Version Packages" PR
6. Merge the "Version Packages" PR to trigger the actual release

### 5. Clean Up Secrets (After Verification)

Once Trusted Publishing is confirmed working:
- [ ] Consider removing `NPM_TOKEN` secret (no longer needed for npm publish)
- Keep other secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `SENTRY_AUTH_TOKEN`, etc.

## Known Issues / Considerations

### Changesets Action + OIDC Limitation

The changesets/action runs both PR creation and publishing in the same workflow. This means:
- All runs require `id-token: write` permission
- If you want approval gates, you'll need to use GitHub Environments

### First-Time Setup

If this is the first time using changesets:
- The `.changeset` folder needs to be committed
- Run `npm install` to get `@changesets/cli`
- The first "Version Packages" PR will appear after the first changeset is merged

### Reference Repository

The issue mentioned copying from `http://github.com/link-assistant/test-anywhere`, but this repository was not accessible (404). The implementation was created based on:
- [npm Trusted Publishing docs](https://docs.npmjs.com/trusted-publishers/)
- [changesets/action documentation](https://github.com/changesets/action)
- Best practices from the npm and GitHub communities

## Questions for Review

1. Should we keep the old `main.yml` as a backup, or delete it entirely?
2. Do you want to use GitHub Environments for release approvals?
3. Should we add the changesets bot for PR checking?
4. Is there any specific configuration from the `test-anywhere` repo that should be included?
