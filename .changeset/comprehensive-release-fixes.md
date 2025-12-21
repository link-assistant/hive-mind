---
'@link-assistant/hive-mind': patch
---

Comprehensive release and validation fixes

This release includes multiple critical fixes that work together to ensure reliable releases and prevent unvalidated code from merging:

**1. Fix workflow conditions to prevent unvalidated code from merging (#958)**

Updated lint job conditions in release.yml to check all file types that Prettier formats (.mjs, .md, .json, .js), not just .mjs files. This ensures the lint check runs consistently for both pull requests and main branch, preventing formatting issues from bypassing validation. Previously, PRs changing only .md or .json files would skip lint checks, allowing unformatted code to merge and cause main branch CI failures.

Documentation added:

- Case study analysis (docs/case-studies/issue-958/ANALYSIS.md) with root cause analysis and timeline reconstruction
- Branch protection policy guide (docs/BRANCH_PROTECTION_POLICY.md) with required status checks specification and configuration instructions

**2. Fix perlbrew bashrc unbound variable error at perl version check (#954)**

Resolves an issue where running `perl --version` during installation would trigger an "unbound variable" error from perlbrew's bashrc file at line 71. The error occurred because:

- The version check command triggered .bashrc sourcing in a subshell
- Perlbrew's bashrc referenced positional parameter $1 without guards
- With `set -u` enabled, unbound variables cause errors

Solution:

- Only load perlbrew in interactive shells (PS1 check in .bashrc)
- Temporarily disable `set -u` when sourcing perlbrew bashrc in the install script
- Re-enable strict mode immediately after sourcing
- Added comprehensive test script (experiments/test-perlbrew-fix.sh)

**3. Enhance README.md initialization for empty repositories (#706)**

Enhanced the existing empty repository handling to include repository description in the auto-generated README.md file. When the solve command encounters an empty repository that cannot be forked, it now creates a more descriptive README with both the repository title and description (if available).

**4. Fix package-lock.json sync in changeset version bump flow**

- Add `npm install --package-lock-only` after `npm run changeset:version` in version-and-commit.mjs
- Ensures package-lock.json stays in sync with package.json during changeset-based releases
- Fixes issue where version bumps only updated package.json
