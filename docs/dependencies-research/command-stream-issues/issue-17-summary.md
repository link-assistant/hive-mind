# Issue #17: CI Trace Logs - Summary

## Quick Facts

- **Trigger**: `CI=true` environment variable
- **Symptom**: Verbose trace logs mixed with command output
- **Impact**: Breaks JSON parsing, test failures in GitHub Actions
- **Severity**: Critical for CI/CD pipelines

## The Problem

```bash
# Normal execution
$ ./memory-check.mjs --json
{"ram":{"success":true},"disk":{"success":true}}

# In CI environment
$ CI=true ./memory-check.mjs --json
[TRACE 2025-09-14T13:25:23.048Z] [Initialization] Registering...
[TRACE 2025-09-14T13:25:23.048Z] [VirtualCommands] registerBuiltins()...
{"ram":{"success":true},"disk":{"success":true}}
[TRACE 2025-09-14T13:25:23.051Z] [ProcessRunner] Cleanup completed
```

## Files Affected in Our Codebase

1. **memory-check.mjs** - JSON output corrupted
2. **tests/test-memory-check.mjs** - Tests fail in GitHub Actions
3. **solve.mjs** - Potential issues with Claude API JSON responses
4. **hive.mjs** - GitHub API JSON parsing may fail
5. **.github/workflows/test.yml** - All tests using command-stream

## Current Workarounds

### Applied to memory-check.mjs

```javascript
// Redirect stderr to /dev/null for each command
const { stdout } = await $silent`df -m . 2>/dev/null | tail -1 | awk '{print $4}'`;
```

### Applied to test-memory-check.mjs

```javascript
// Filter trace logs before parsing JSON
const lines = output.split('\n');
let jsonOutput = '';
let inJson = false;

for (const line of lines) {
  if (line.trim().startsWith('{')) inJson = true;
  if (inJson && !line.startsWith('[TRACE')) {
    jsonOutput += line + '\n';
  }
  if (line.trim() === '}') break;
}
```

## Test Results

### Without CI environment

```bash
$ ./tests/test-memory-check.mjs
✅ All 10 tests pass
```

### With CI environment

```bash
$ CI=true ./tests/test-memory-check.mjs
❌ 4 tests fail (JSON parsing errors)
✅ 6 tests pass (non-JSON tests)
```

### With workarounds

```bash
$ CI=true ./memory-check.mjs --json 2>/dev/null
✅ Clean JSON output
```

## Trace Log Components

The following components emit trace logs when CI=true:

- `[Initialization]` - Virtual command registration
- `[VirtualCommands]` - Command registration (21 built-in commands)
- `[API]` - $tagged function calls
- `[ProcessRunner]` - Complete lifecycle logging
- `[StreamMonitor]` - Stream setup
- `[SignalHandler]` - SIGINT handler management
- `[StreamEmitter]` - Event emission
- `[AnsiUtils]` - Output processing
- `[Utils]` - buildShellCommand operations

## Performance Impact

- Simple echo command: ~50 trace log lines
- Command with pipes: ~100-200 trace log lines
- Test suite with 100 commands: ~10,000 lines, 1-2MB extra output

## Recommendations

### For Immediate Use

1. Always add `2>/dev/null` to commands expecting JSON output
2. Implement trace log filtering in test utilities
3. Document CI behavior in CLAUDE.md
4. Consider using execSync for critical JSON operations

### For command-stream Library

1. Add `trace: false` option to $ configuration
2. Respect `mirror: false` for trace logs
3. Provide `COMMAND_STREAM_TRACE=false` env var
4. Separate trace output from stderr

## Related Documentation

- `issue-17-trace-logs-in-ci.mjs` - Reproduction script
- `issue-17-technical-analysis.md` - Detailed technical analysis
- `README.md` - General command-stream issues overview

## Status

- **Discovered**: 2025-09-14
- **Workarounds**: Implemented
- **Upstream fix**: Not yet available
- **Impact**: Ongoing in CI environments
