# Case Study: Issue #1320 - Version Information Gathering Performance

## Issue Summary

**Title:** `Gathering version information...` is too slow

**Problem:** The current `getVersionInfo()` function in `src/version-info.lib.mjs` executes version commands sequentially (one after another) using `execSync`, causing significant delays when gathering version information for many tools.

**Impact:** Users experience noticeable lag when using the `/version` command in the Telegram bot, as each tool version check must complete before the next one starts.

## Root Cause Analysis

### Current Implementation Issues

1. **Sequential Execution:** The current code uses `execSync` for each version check, blocking the event loop:

   ```javascript
   // Current approach - sequential and slow
   const claudeVersion = execCommand('claude --version 2>&1', verbose);
   // Wait...
   const playwrightVersion = execCommand('playwright --version 2>&1', verbose);
   // Wait...
   const nodeVersion = process.version;
   // ... and so on for 30+ commands
   ```

2. **Individual Timeouts:** Each command has a 5-second timeout, meaning worst-case execution could take several minutes if many commands timeout.

3. **Missing Tool Versions:** The supported `--tool` options (agent, codex, opencode, qwen-code, gemini, copilot) are not being checked.

4. **Unorganized Output:** Telegram bot displays tools in generic categories rather than grouped by programming language.

5. **Redundant Version Display:** Shows bot, solve, and hive versions separately even though they're all the same package version.

## Proposed Solution

### 1. Parallel Version Checking with Promise.all

Convert from synchronous `execSync` to asynchronous `exec` wrapped in `Promise.all`:

```javascript
// Proposed approach - parallel execution
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

async function execCommandAsync(command, timeout = 5000) {
  try {
    const { stdout } = await execAsync(command, { timeout });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function getVersionInfo(verbose = false) {
  // All version checks run in parallel
  const [claude, playwright, node, python, ...rest] = await Promise.all([
    execCommandAsync('claude --version 2>&1'),
    execCommandAsync('playwright --version 2>&1'),
    Promise.resolve(process.version), // Already available
    execCommandAsync('python --version 2>&1'),
    // ... all other commands
  ]);
}
```

### 2. Add Missing Tool Versions

Add version checks for all supported `--tool` options:

- `agent --version` (Agent CLI)
- `codex --version` (OpenAI Codex)
- `opencode --version` (OpenCode AI)
- `qwen-code --version` (Qwen Code)
- `gemini --version` (Google Gemini CLI)
- `copilot --version` (GitHub Copilot)

### 3. Group Output by Programming Language

Reorganize the Telegram message format to group tools by language:

```
*🤖 Hive-Mind*
• Version: `1.23.12`
⚠️ Warning: Process version differs from installed

*🎭 AI Agents*
• Claude Code: `2.1.41`
• OpenAI Codex: `1.0.0`
• Agent CLI: `1.0.0`
• OpenCode: `1.0.0`
• Qwen Code: `1.0.0`
• Gemini CLI: `1.0.0`
• GitHub Copilot: `1.0.0`

*📦 JavaScript/Node.js*
• Node.js: `v20.20.0`
• Bun: `1.3.9`
• Deno: `deno 2.6.9`
• NPM: `11.10.0`
• NVM: `0.40.3`

*🐍 Python*
• Python: `3.14.3`
• Pyenv: `2.6.22`

*🦀 Rust*
• Rustc: `1.93.1`
• Cargo: `1.93.1`

*☕ Java*
• Java: `21 LTS`
• SDKMAN: `5.18.2`

*🐘 PHP*
• PHP: `8.3.30`

*🔷 Go*
• Go: `go1.26.0`

*💎 Perl*
• Perl: `5.42.0`
• Perlbrew: `1.02`

*🐫 OCaml/Rocq*
• OCaml: `4.14.1`
• Opam: `2.1.5`
• Rocq: `9.1.0`

*📐 Lean*
• Lean: `4.x.x`
• Elan: `4.1.2`
• Lake: `1.x.x`

*🔨 C/C++*
• GCC: `13.3.0`
• G++: `13.3.0`
• Clang: `18.1.3`
• LLVM: `18.1.3`
• LLD: `18.1.3`
• Make: `4.3`
• CMake: `3.28.3`

*📦 .NET*
• .NET SDK: `8.0.123`

*🔧 Development Tools*
• Git: `2.43.0`
• GitHub CLI: `2.86.0`
• Playwright: `1.58.2`
• Playwright MCP: `0.0.64`
• Homebrew: `5.0.14`

*💻 Platform*
• System: `linux (x64)`
```

### 4. Single Package Version with Warning

Show single hive-mind version and add warning if running process version differs from installed:

```javascript
// Check if process version differs from installed npm package
const processVersion = currentProcessVersion; // From startup
const installedVersion = await getVersion(); // From npm
const needsRestart = processVersion !== installedVersion;
```

## Expected Performance Improvement

**Before (Sequential):** ~30 commands × ~1-5s each = 30-150 seconds worst case

**After (Parallel):** All commands execute simultaneously, limited by slowest command (~5s timeout)

This represents a potential **6-30x speedup** in version gathering.

## Libraries and Patterns Used

1. **Promise.all()** - Native JavaScript for parallel async execution
2. **util.promisify()** - Convert callback-based exec to Promise-based
3. **AbortController** - For timeout management (Node.js 16+)

## Related Prior Work

- Issue #1096: Previous work on version info display
- Issue #952: Rocq/Coq theorem prover integration
- Issue #1004: Keeping user's home directory clean
- Issue #1084: Architecture-specific browser installation

## Files to Modify

1. `src/version-info.lib.mjs` - Main version gathering logic
2. `tests/version-info.test.mjs` - New test file

## Testing Strategy

1. Unit tests for `execCommandAsync` function
2. Integration test for `getVersionInfo()` performance
3. Verify Telegram message formatting
4. Test version mismatch warning
