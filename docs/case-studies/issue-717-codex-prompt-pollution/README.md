# Case Study: Temporary Prompt Files Polluting Repository Workspace

## Issue Reference
- **Issue**: [#717 - codex_prompt.txt created inside repository by solve command](https://github.com/deep-assistant/hive-mind/issues/717)
- **Pull Request**: [#718](https://github.com/deep-assistant/hive-mind/pull/718)
- **Example PR with pollution**: [link-foundation/ideav-local-associative-js#2](https://github.com/link-foundation/ideav-local-associative-js/pull/2)

## Executive Summary

The Codex and OpenCode CLI integration code creates temporary prompt files (`codex_prompt.txt` and `opencode_prompt.txt`) directly in the repository workspace instead of using the operating system's temporary directory. This causes:

1. **Repository pollution**: Temporary files are created in the git working directory
2. **Accidental commits**: These files may be committed to version control (as seen in ideav-local-associative-js#2)
3. **Operational issues**: Triggers uncommitted changes warnings and auto-restart loops
4. **Git interference**: Can cause issues with git operations and branch switching

### Key Findings
- **Affected files**: `src/codex.lib.mjs` and `src/opencode.lib.mjs`
- **Affected CLI tools**: `codex` and `opencode` (NOT `claude`)
- **File locations**: Lines 280-282 (codex) and 270-272 (opencode)
- **Current behavior**: Creates `{codex,opencode}_prompt.txt` in repository workspace
- **Expected behavior**: Should create files in OS temporary directory

## Timeline of Events

### Discovery
1. **Date**: Issue reported referencing [link-foundation/ideav-local-associative-js#2](https://github.com/link-foundation/ideav-local-associative-js/pull/2)
2. **Evidence**: A 90-line `codex_prompt.txt` file was committed to the repository
3. **Related**: Issue #715 also mentions "uncommitted files (codex_prompt.txt)" triggering auto-restart loops

### Sequence of Events

#### 1. User runs solve command with codex or opencode
```bash
./solve.mjs https://github.com/example/repo/issues/123 --backend codex
```

#### 2. Code execution path
1. `solve.mjs` calls `executeCodex()` or `executeOpenCode()`
2. Function builds combined prompt (system + user prompt)
3. **PROBLEM**: Writes prompt to `path.join(tempDir, 'codex_prompt.txt')`
4. Pipes file content to CLI tool: `cat "${promptFile}" | codex exec ...`
5. File remains in workspace after execution

#### 3. Consequences
- If git operations occur, the file shows as untracked
- If code makes changes, the prompt file may be auto-committed
- If PR is created, the file may be pushed to remote repository
- Triggers "uncommitted changes" detection logic

## Root Cause Analysis

### Technical Root Cause
The code uses the repository workspace (`tempDir`) for storing temporary prompt files when it should use the OS temporary directory.

**Current code (codex.lib.mjs:281)**:
```javascript
const promptFile = path.join(tempDir, 'codex_prompt.txt');
```

**Current code (opencode.lib.mjs:271)**:
```javascript
const promptFile = path.join(tempDir, 'opencode_prompt.txt');
```

### Why This Happens
1. The `tempDir` variable name is misleading - it refers to the cloned repository directory, not a temporary directory
2. The files are needed for piping to CLI tools (technical requirement)
3. The current working directory is used for convenience when running CLI commands

### Contributing Factors
1. **Variable naming**: `tempDir` suggests temporary storage but actually refers to repository workspace
2. **No cleanup**: Files are not explicitly deleted after use
3. **No .gitignore**: These files are not in .gitignore (though they should be generated elsewhere)
4. **Multiple CLI tools affected**: Both codex and opencode have the same issue

## Evidence

### Example 1: PR with Committed File
In [link-foundation/ideav-local-associative-js#2](https://github.com/link-foundation/ideav-local-associative-js/pull/2):
- File `codex_prompt.txt` was added (90 lines)
- Contains AI solver guidelines and instructions
- Should never have been committed to the repository

### Example 2: Operational Issues (Issue #715)
From issue-715 case study:
```
"Auto-restart loop triggered due to uncommitted files (codex_prompt.txt)"
```

This shows the file creation interferes with normal operations.

## Proposed Solution

### Primary Fix: Use OS Temporary Directory

Instead of writing to the repository workspace, use Node.js `os.tmpdir()`:

```javascript
const os = await use('os');
const tmpDir = os.tmpdir();
const promptFile = path.join(tmpDir, `codex_prompt_${Date.now()}.txt`);
```

Benefits:
1. ✅ No repository pollution
2. ✅ Automatic cleanup by OS
3. ✅ No git interference
4. ✅ Follows best practices
5. ✅ Prevents accidental commits

### Alternative Solutions Considered

#### Option 2: Use Node.js built-in `fs.mkdtemp()`
```javascript
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-'));
const promptFile = path.join(tmpDir, 'prompt.txt');
```
- Pros: More secure, isolated directory per execution
- Cons: Requires explicit cleanup

#### Option 3: Add to .gitignore
```gitignore
*_prompt.txt
codex_prompt.txt
opencode_prompt.txt
```
- Pros: Simple, prevents commits
- Cons: Still pollutes workspace, doesn't solve root cause

**Decision**: Use Option 1 (os.tmpdir()) as it's the simplest and most effective solution.

## Implementation Plan

### Files to Modify
1. `src/codex.lib.mjs` (Line 281)
2. `src/opencode.lib.mjs` (Line 271)

### Changes Required
1. Import `os` module at the top of each file
2. Change `promptFile` path to use `os.tmpdir()`
3. Add timestamp or random suffix to prevent collisions
4. Update tests if they verify file locations

### Testing Strategy
1. **Unit tests**: Verify prompt files are created in OS temp directory
2. **Integration tests**: Run solve command and verify no files in repo workspace
3. **Git tests**: Verify `git status --porcelain` shows no untracked prompt files
4. **Cleanup tests**: Verify OS temp files are created and readable

## Impact Assessment

### Files Affected
- `src/codex.lib.mjs`: ~1 line change (plus import)
- `src/opencode.lib.mjs`: ~1 line change (plus import)

### Backward Compatibility
- ✅ No breaking changes
- ✅ Existing functionality preserved
- ✅ CLI commands work the same way
- ✅ No API changes

### Risk Assessment
- **Risk Level**: Low
- **Reason**: Simple path change, well-tested pattern
- **Mitigation**: Comprehensive testing before release

## Verification

### Success Criteria
1. ✅ No `*_prompt.txt` files created in repository workspace
2. ✅ Prompt files created in OS temporary directory
3. ✅ CLI tools (codex, opencode) continue to work correctly
4. ✅ No git status pollution
5. ✅ All existing tests pass

### Test Cases
1. Run `solve.mjs` with `--backend codex`
2. Check `git status` in workspace → should be clean
3. Verify prompt file exists in `/tmp` (or OS equivalent)
4. Run `solve.mjs` with `--backend opencode`
5. Verify same behavior

## Related Issues and Context

### Related Issues
- [#715 - Codex authentication failures](https://github.com/deep-assistant/hive-mind/issues/715) - Mentions uncommitted codex_prompt.txt
- [#717 - Current issue](https://github.com/deep-assistant/hive-mind/issues/717)

### Related PRs
- [link-foundation/ideav-local-associative-js#2](https://github.com/link-foundation/ideav-local-associative-js/pull/2) - Example of pollution

### Context from Issue Description
From issue #717:
> "I think we can solve it by using temporary files in random temporary folder in base folder provided by the OS"

This confirms the proposed solution aligns with the issue reporter's suggestion.

## Conclusion

This case study demonstrates a clear pattern of temporary file pollution in the repository workspace. The fix is straightforward: use the OS temporary directory instead of the repository workspace. This will prevent accidental commits, reduce git interference, and follow best practices for temporary file management.

The solution has been validated against:
- Technical requirements (piping to CLI tools)
- Operational needs (no workspace pollution)
- Best practices (OS temporary directory usage)
- User feedback (issue description suggestions)

Implementation can proceed with confidence.
