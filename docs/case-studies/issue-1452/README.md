# Case Study: Merged Changelog Entries Not Formatted as Separate Items (Issue #1452)

## Summary

When multiple PRs merge to `main` in quick succession, the CI/CD pipeline produces malformed changelog entries and incomplete release notes. Instead of separate bullet items for each changeset, all descriptions are merged into a single entry.

## Timeline of Events (v1.35.1)

1. **PR #1449** merged to `main` at `87d0a7cb` (2026-03-20T22:38:55Z) — "improve Solution Draft Log comment formatting"
2. **PR #1447** merged to `main` at `60bcf778` (2026-03-20T22:39:59Z) — "Fix misleading Retry after: 0s message"
3. Workflow run for #1449 (ID: 23365417671) was **cancelled** due to concurrency setting (`cancel-in-progress: true` on main branch)
4. Workflow run for #1447 (ID: 23365445290) **succeeded** — this run found 2 changeset files and merged them
5. The merged changeset was processed by `@changesets/cli` which produced a **single** bullet entry in CHANGELOG.md
6. GitHub release v1.35.1 was created with merged text and only **PR #1447** linked (not #1449)

## Root Causes

### Root Cause 1: `merge-changesets.mjs` joins descriptions as plain text, not as separate changeset entries

In `scripts/merge-changesets.mjs`, the `createMergedChangeset()` function (line 99-108) joins descriptions with `\n\n`:

```javascript
function createMergedChangeset(type, descriptions) {
  const combinedDescription = descriptions.join('\n\n');
  // ...
}
```

When `@changesets/cli` runs `changeset version`, it treats each `.md` file in `.changeset/` as **one** changelog entry. Since `merge-changesets.mjs` combines all descriptions into a single file, only one bullet (`-`) appears in CHANGELOG.md. The second description becomes an indented continuation paragraph under the first bullet, not a separate item.

**Expected behavior**: Each original changeset description should appear as a separate bullet item in the changelog.

### Root Cause 2: `format-release-notes.mjs` misses PRs for merged changesets

The `format-release-notes.mjs` script (line 105) detects PRs by extracting commit hashes from changelog entries:

```javascript
const commitHashRegex = /-\s+([a-f0-9]{7,40}):/g;
```

Format expected: `- abc1234: Description`

But when changesets are merged, the merged changeset has **no commit hash prefix** — it only has the raw description text. So the regex finds zero hashes. The fallback `--commit-sha` only captures the triggering commit (last merge to main), so only #1447 was detected, not #1449.

### Root Cause 3: Concurrency cancellation is expected but compounds the above issues

The workflow concurrency setting cancels older runs on main when a newer push arrives:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
```

This is the correct behavior — we want the latest commit on main to perform the release, not an outdated one. However, this means the merge-changesets script **must** correctly handle producing separate changelog items from accumulated changesets.

## Impact

- CHANGELOG.md v1.35.1 shows 1 entry instead of 2
- GitHub release v1.35.1 shows merged text with only 1 PR linked instead of 2
- Users reading the changelog cannot distinguish separate changes

## Fix

### Fix 1: Don't merge changeset files — let `@changesets/cli` handle multiple changesets natively

`@changesets/cli` already natively supports multiple changeset files and produces separate bullet items for each one. The `merge-changesets.mjs` script was well-intentioned but counterproductive — it defeats the multi-entry formatting that changesets provides out of the box.

**Solution**: Remove the merge step from the release workflow. If the merge step is kept for version bump coalescing (e.g., one has `minor` and another `patch`), it should create separate merged changeset files instead of combining descriptions.

### Fix 2: Enhance `format-release-notes.mjs` to find PRs from multiple changelog entries

When multiple entries exist, each `- description` line in the release notes should trigger PR lookup. Additionally, use `git log` between version tags to find all merge commits and their associated PRs.

### Fix 3: Pass all merge commit SHAs to format-release-notes

Instead of only passing `github.sha` (the last push to main), detect all merge commits since the last release tag and pass them to the PR detection logic.

## References

- Broken release: https://github.com/link-assistant/hive-mind/releases/tag/v1.35.1
- Broken commit: https://github.com/link-assistant/hive-mind/commit/7b8863f6
- CI run (successful, but produced bad output): workflow run ID 23365445290
- CI run (cancelled): workflow run ID 23365417671
- `@changesets/cli` documentation: multiple changesets are designed to produce separate entries
