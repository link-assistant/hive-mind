# Code Analysis: Temporary Prompt Files in Repository Workspace

## Affected Files

### 1. src/codex.lib.mjs (Lines 280-282)
```javascript
// Write the combined prompt to a file for piping
const promptFile = path.join(tempDir, 'codex_prompt.txt');
await fs.writeFile(promptFile, combinedPrompt);
```

**Issue**: Creates `codex_prompt.txt` in the repository workspace (`tempDir`)

### 2. src/opencode.lib.mjs (Lines 270-272)
```javascript
// Write the combined prompt to a file for piping
const promptFile = path.join(tempDir, 'opencode_prompt.txt');
await fs.writeFile(promptFile, combinedPrompt);
```

**Issue**: Creates `opencode_prompt.txt` in the repository workspace (`tempDir`)

### 3. src/claude.lib.mjs
**Status**: Does NOT create temporary prompt files in workspace (uses stdin directly or API calls)

## Context

Both `codex.lib.mjs` and `opencode.lib.mjs` use these prompt files to pipe content to their respective CLI tools:

### Codex Usage (Line 285):
```javascript
const fullCommand = `(cd "${tempDir}" && cat "${promptFile}" | ${codexPath} ${codexArgs})`;
```

### OpenCode Usage (Line 275):
```javascript
const fullCommand = `(cd "${tempDir}" && cat "${promptFile}" | ${opencodePath} ${opencodeArgs})`;
```

## Problem

The `tempDir` variable refers to the cloned repository workspace, NOT a system temporary directory.
When these files are created:
1. They pollute the git working directory
2. They may be accidentally committed to version control
3. They trigger "uncommitted changes" warnings
4. They can interfere with git operations

## Evidence in Case Study #715

In the issue-715 case study, we see this pattern:
```
"Auto-restart loop triggered due to uncommitted files (codex_prompt.txt)"
```

This shows that the `codex_prompt.txt` file creation was causing operational issues.

## Root Cause

The files are being created for legitimate technical reasons (piping to CLI tools), but in the wrong location.
They should be created in the OS temporary directory, not in the repository workspace.
