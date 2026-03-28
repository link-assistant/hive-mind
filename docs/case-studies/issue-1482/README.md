# Case Study: Issue #1482 - URLs Used as `--base-branch`

## Summary

A user passed a full GitHub URL (`https://github.com/rumaster/2book-es/pull/172`) as the `--base-branch` argument instead of a branch name. The system accepted it without validation, leading to a failed `git checkout -b ... origin/https://github.com/...` command.

## Timeline / Sequence of Events

1. User invoked: `/solve https://github.com/rumaster/2book-es/issues/173 --model opus --base-branch https://github.com/rumaster/2book-es/pull/172`
2. The Hive Mind bot parsed the command and started the solve session.
3. The solve process passed the URL as-is to `git checkout -b <new-branch> origin/<url>`.
4. Git failed because `origin/https://github.com/rumaster/2book-es/pull/172` is not a valid ref.

## Root Cause Analysis

**Root cause:** No input validation existed for the `--base-branch` parameter.

The `--base-branch` option was defined in `solve.config.lib.mjs` (line 245) as a plain string type with no validation. The value was used directly in:

- `solve.branch.lib.mjs:128` - `git checkout -b ${branchName} origin/${baseBranch}`
- `solve.auto-pr.lib.mjs:579` - GitHub compare API call
- `solve.auto-pr.lib.mjs:927` - PR creation target branch
- `hive.mjs:769` - Forwarded from hive's `--target-branch` to solve's `--base-branch`

All these locations assumed `baseBranch` was a valid git branch name.

## Why the URL Was Accepted

1. Yargs treats `--base-branch` as a generic string option with no coerce/check.
2. No post-parse validation existed for branch name format.
3. The hive bot (`hive.mjs`) also forwards `--target-branch` to `--base-branch` without validation.
4. The Telegram bot command parser splits on whitespace, so the URL was captured as the option value.

## Impact

- The solve process failed during branch creation.
- The user received a confusing git error rather than a clear validation message.
- Compute resources were wasted on a doomed solve session.

## Solution

### Validation Function: `validateBranchName()`

Added to `solve.branch.lib.mjs`, this function validates branch names against:

1. **URL detection** (primary fix): Rejects `https://`, `http://`, `git@`, `ssh://` prefixes and `://` anywhere.
2. **Git ref format rules** (from `git-check-ref-format`):
   - No control characters (0x00-0x1F, 0x7F)
   - No special chars: space, `~`, `^`, `:`, `?`, `*`, `[`, `]`, `\`
   - No `..` sequences
   - No leading `.` or `-`
   - No trailing `.` or `.lock`
   - No `@{` sequence or bare `@`
   - No empty path components (consecutive slashes, leading/trailing slashes)
   - No component starting with `.` or ending with `.lock`
3. **Length limit**: Max 255 characters.

### Validation Points (defense-in-depth)

1. **`telegram-bot.mjs`** - Earliest validation point: rejects invalid branch names in `/solve` and `/hive` commands before any process is spawned. Also validates `--base-branch`/`--target-branch` in solve/hive overrides at bot startup.
2. **`solve.config.lib.mjs:parseArguments()`** - Early validation after CLI parsing, before any processing.
3. **`solve.branch.lib.mjs:createOrCheckoutBranch()`** - Defense-in-depth check right before `git checkout`.
4. **`hive.mjs`** - Validation before forwarding `--base-branch`/`--target-branch` to the solve subprocess.

### Error Messages

Clear, actionable error messages, e.g.:

```
Invalid --base-branch value: "https://github.com/rumaster/2book-es/pull/172" looks like a URL, not a branch name. Use just the branch name (e.g. "main", "develop")
```

## Testing

19 test cases in `tests/test-base-branch-validation.mjs` covering:

- Valid branch names (simple, slashed, numeric, with underscores/dots)
- URL rejection (HTTPS, HTTP, SSH, git@, generic `://`)
- Git ref format violations (control chars, special chars, `..`, leading/trailing issues, `@{`, path components)
- Edge cases (length limits, `@` in names)

## References

- [git-check-ref-format documentation](https://git-scm.com/docs/git-check-ref-format)
- Screenshot (issue): [screenshot1.png](./screenshot1.png)
- Screenshot (comment): [screenshot2.png](./screenshot2.png)
- [Full solve log](./solve-log.log)
