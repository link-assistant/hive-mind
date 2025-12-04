# Issue #804: Step closer to use .gitkeep by default instead of CLAUDE.md

## Current State Analysis

Date: 2025-12-04
Branch: issue-804-3661b3948f6f
PR: #807

## Issue Summary

The goal is to migrate from using `CLAUDE.md` as the default file for auto-PR creation to using `.gitkeep` instead. This change requires:

1. Adding a `--no-claude-file` option to disable CLAUDE.md creation
2. Enabling `--gitkeep-file` by default
3. Ensuring mutual exclusivity between `--claude-file` and `--gitkeep-file`
4. At least one file (CLAUDE.md or .gitkeep) must be created for PR creation

## Current Implementation

### File: `src/solve.auto-pr.lib.mjs`

This file contains the `handleAutoPrCreation()` function which is responsible for:
- Creating the CLAUDE.md file with task details (lines 50-103)
- Adding the file to git staging (lines 105-115)
- Detecting when CLAUDE.md is in .gitignore (lines 129-211)
- Falling back to .gitkeep when CLAUDE.md is ignored (lines 137-185)
- Creating and pushing an initial commit (lines 213-308)
- Creating a draft pull request (lines 795-1103)

#### Key Logic Flow:

1. **CLAUDE.md Creation** (lines 50-103):
   - Creates CLAUDE.md with task info
   - Appends timestamp if file already exists
   - Writes task information including issue URL and branch name

2. **Git Staging** (lines 105-115):
   - Attempts to add CLAUDE.md to git
   - Checks for staging success

3. **Fallback Detection** (lines 129-211):
   - Checks if nothing was staged
   - Uses `git check-ignore CLAUDE.md` to detect if file is ignored
   - If ignored, creates `.gitkeep` as fallback with metadata
   - Tracks which file was used for commit

4. **Commit Creation** (lines 213-273):
   - Creates commit with appropriate message based on which file was used
   - Verifies commit was created successfully

### File: `src/solve.config.lib.mjs`

This file contains CLI configuration using yargs. Currently relevant options:

- `--auto-pull-request-creation` (lines 96-100): Boolean flag, defaults to `true`
  - Controls whether to automatically create a draft PR before running Claude
  - Can be disabled with `--no-auto-pull-request-creation`

Currently, there are **NO** flags for:
- `--claude-file` / `--no-claude-file`
- `--gitkeep-file` / `--no-gitkeep-file`

### Existing Tests

File: `experiments/test-gitkeep-fallback.mjs`

This test script validates the fallback behavior:
1. Creates a test repo with CLAUDE.md in .gitignore
2. Verifies CLAUDE.md cannot be staged
3. Confirms CLAUDE.md is ignored using `git check-ignore`
4. Tests that .gitkeep can be staged and committed as fallback

## Current Behavior

### Default Behavior (as of today):
1. Auto-PR creation is enabled by default (`--auto-pull-request-creation`)
2. CLAUDE.md is **always** created first
3. If CLAUDE.md is in .gitignore, automatically fallback to .gitkeep
4. No way to explicitly choose which file to use
5. No way to disable CLAUDE.md creation without disabling auto-PR entirely

### Fallback Logic:
- **Trigger**: CLAUDE.md is in .gitignore AND nothing was staged
- **Detection**: `git check-ignore CLAUDE.md` returns exit code 0
- **Action**: Create `.gitkeep` with metadata instead
- **Commit message**: Changes to mention .gitkeep instead of CLAUDE.md

## Requirements from Issue #804

### Phase 1 (Experimental):
1. ✅ Keep current default behavior (`--claude-file` enabled by default)
2. ✅ Add `--gitkeep-file` as an experimental option
3. ✅ Make them mutually exclusive
4. ✅ `--gitkeep-file` should implicitly set `--no-claude-file`
5. ✅ `--claude-file` should implicitly set `--no-gitkeep-file`

### Phase 2 (Future):
1. ⏳ Switch default to `--gitkeep-file` enabled by default
2. ⏳ Make `--claude-file` opt-in

### Technical Constraints:
- ✅ At least one file (CLAUDE.md or .gitkeep) must be created for PR creation
- ✅ Cannot create PR with no changes
- ✅ Existing fallback logic should remain as safety net

## Findings

### 1. Current Fallback Already Exists
The code already has a robust fallback mechanism:
- Location: `src/solve.auto-pr.lib.mjs` lines 129-211
- Works automatically when CLAUDE.md is ignored
- Creates .gitkeep with metadata (issue URL, branch name, explanation)
- Properly handles both scenarios

### 2. No Explicit Flags Yet
There are currently no command-line flags to control which file to use:
- Need to add `--claude-file` (boolean, default true)
- Need to add `--gitkeep-file` (boolean, default false)
- Need to implement mutual exclusivity logic

### 3. Code Structure is Good
The `handleAutoPrCreation()` function:
- Is well-structured and easy to modify
- Has clear separation of concerns
- Already tracks which file is being used (`commitFileName` variable)
- Has comprehensive error handling and logging

### 4. Testing Infrastructure Exists
The `test-gitkeep-fallback.mjs` test:
- Validates the fallback behavior
- Can be extended to test the new flags
- Provides good foundation for additional tests

## Identified Code Locations for Changes

### 1. Add CLI Flags
**File**: `src/solve.config.lib.mjs`
**Location**: After line 100 (after `auto-pull-request-creation`)

Add two new boolean options:
```javascript
.option('claude-file', {
  type: 'boolean',
  description: 'Create CLAUDE.md file for task details (default)',
  default: true
})
.option('gitkeep-file', {
  type: 'boolean',
  description: 'Create .gitkeep file instead of CLAUDE.md (experimental)',
  default: false
})
```

### 2. Add Mutual Exclusivity Logic
**File**: `src/solve.config.lib.mjs`
**Location**: In `parseArguments()` function, after line 315

Add validation:
```javascript
// Mutual exclusivity: claudeFile and gitkeepFile
if (argv.claudeFile && argv.gitkeepFile) {
  throw new Error('--claude-file and --gitkeep-file are mutually exclusive');
}

// At least one must be enabled
if (!argv.claudeFile && !argv.gitkeepFile) {
  throw new Error('At least one of --claude-file or --gitkeep-file must be enabled');
}

// Handle implicit negation
if (argv.gitkeepFile) {
  argv.claudeFile = false;
}
if (argv.claudeFile) {
  argv.gitkeepFile = false;
}
```

### 3. Modify File Creation Logic
**File**: `src/solve.auto-pr.lib.mjs`
**Location**: Lines 50-211

Wrap CLAUDE.md creation in condition:
```javascript
if (argv.claudeFile) {
  // Existing CLAUDE.md creation logic (lines 50-103)
} else if (argv.gitkeepFile) {
  // Create .gitkeep directly (similar to fallback logic lines 145-154)
}
```

### 4. Update Tests
**File**: Create new file `experiments/test-claude-gitkeep-flags.mjs`

Test scenarios:
1. Default behavior (--claude-file enabled)
2. Explicit --gitkeep-file usage
3. Mutual exclusivity validation
4. Error when both disabled
5. Fallback still works when CLAUDE.md is ignored

## Proposed Solution

### Design Decisions:

1. **Backward Compatibility**:
   - Keep `--claude-file` as default (true) for now
   - This matches current behavior

2. **Explicit vs Implicit**:
   - Use explicit flags: `--claude-file` and `--gitkeep-file`
   - Support negation: `--no-claude-file` and `--no-gitkeep-file`
   - Implement mutual exclusivity after parsing

3. **Validation Approach**:
   - Check mutual exclusivity in `parseArguments()`
   - Throw clear error messages
   - Validate at least one is enabled

4. **Fallback Behavior**:
   - Keep existing fallback as safety net
   - Even with `--claude-file`, if CLAUDE.md is ignored, use .gitkeep
   - This prevents failures in repos that ignore CLAUDE.md

5. **File Content**:
   - CLAUDE.md: Keep current format (task info)
   - .gitkeep: Use metadata format from fallback (lines 147-151)

### Implementation Steps:

1. ✅ Add CLI flags to `src/solve.config.lib.mjs`
2. ✅ Add mutual exclusivity validation
3. ✅ Modify `handleAutoPrCreation()` to respect flags
4. ✅ Update or create tests
5. ✅ Run local CI checks
6. ✅ Test with real scenarios
7. ✅ Document changes
8. ✅ Update PR description

## Edge Cases to Handle

1. **Both flags disabled**: Error - need at least one file for PR creation
2. **Both flags enabled**: Error - mutually exclusive
3. **CLAUDE.md ignored + --claude-file**: Fallback to .gitkeep (existing behavior)
4. **--gitkeep-file explicitly set**: Create .gitkeep directly, skip CLAUDE.md
5. **--no-auto-pull-request-creation**: Flags should have no effect (no file created)

## Risk Assessment

### Low Risk:
- Adding new flags (backward compatible)
- Mutual exclusivity validation (clear error messages)
- Existing tests continue to work

### Medium Risk:
- Changing default in future (Phase 2) - will need migration guide
- Users with automated scripts may need updates

### Mitigation:
- Keep defaults unchanged for now
- Add comprehensive tests
- Document new flags in help text
- Test with actual repositories

## Next Steps

1. Implement CLI flags
2. Add mutual exclusivity logic
3. Modify file creation logic
4. Write comprehensive tests
5. Test locally
6. Run CI checks
7. Update documentation
8. Request review

---

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/804
- PR: https://github.com/link-assistant/hive-mind/pull/807
- Related code: `src/solve.auto-pr.lib.mjs` lines 50-211
- Related code: `src/solve.config.lib.mjs` lines 96-100
- Test: `experiments/test-gitkeep-fallback.mjs`
