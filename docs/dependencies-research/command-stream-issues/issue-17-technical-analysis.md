# Issue #17: Technical Analysis - Trace Logs in CI Environment

## Problem Statement

When the `CI` environment variable is set to `true`, command-stream emits verbose trace logs to stderr that break JSON parsing and cause test failures in CI/CD pipelines.

## Root Cause Analysis

### Trigger Condition
```javascript
process.env.CI === 'true'
```

### Affected Environments
- GitHub Actions (automatically sets `CI=true`)
- GitLab CI
- CircleCI  
- Jenkins with CI plugin
- Any local environment with `CI=true` set

### Log Format
```
[TRACE YYYY-MM-DDTHH:MM:SS.sssZ] [Component] message | {jsonData}
```

### Components That Emit Trace Logs
- `[Initialization]` - Virtual command registration
- `[VirtualCommands]` - Command registration and execution
- `[API]` - $tagged function calls
- `[Utils]` - buildShellCommand operations
- `[ProcessRunner]` - Process lifecycle management
- `[StreamMonitor]` - Stream monitoring setup
- `[SignalHandler]` - SIGINT handler management
- `[StreamEmitter]` - Event emission
- `[AnsiUtils]` - Output processing

## Impact on Our Codebase

### Affected Files
1. **memory-check.mjs**
   - JSON output corrupted when `--json` flag used
   - Tests parse mixed trace logs and JSON, causing failures

2. **tests/test-memory-check.mjs**
   - Tests fail when run in GitHub Actions
   - JSON parsing errors: "Unexpected token '[', \"[TRACE 2025\"..."

3. **solve.mjs**
   - Claude API responses may be corrupted if JSON output expected
   - Log file uploads may include trace logs

4. **hive.mjs**
   - Similar issues when processing multiple GitHub issues
   - JSON output from GitHub API calls may be corrupted

## Reproduction Steps

### Local Reproduction
```bash
# Without CI environment
./memory-check.mjs --quiet --json
# Output: Clean JSON

# With CI environment  
CI=true ./memory-check.mjs --quiet --json
# Output: JSON mixed with trace logs

# Demonstrate the issue
CI=true ./command-stream-issues/issue-17-trace-logs-in-ci.mjs
```

### Test Failure Pattern
```javascript
// Test code
const output = execCommand(`${memoryCheckPath} --quiet --json 2>&1`);
const result = JSON.parse(output); // Fails in CI

// Error in CI
// JSON Parse error: Unexpected token '[', "[TRACE 2025"... is not valid JSON
```

## Workarounds Implemented

### 1. Redirect stderr to /dev/null (memory-check.mjs)
```javascript
// Before
const { stdout } = await $silent`df -m . | tail -1 | awk '{print $4}'`;

// After  
const { stdout } = await $silent`df -m . 2>/dev/null | tail -1 | awk '{print $4}'`;
```

**Limitations:**
- Loses legitimate error messages
- Doesn't help when tests capture stderr with `2>&1`

### 2. Filter Trace Logs (test-memory-check.mjs)
```javascript
// Filter out trace/debug lines from output
const lines = output.split('\n');
let jsonOutput = '';
let inJson = false;

for (const line of lines) {
  if (line.trim().startsWith('{')) {
    inJson = true;
  }
  if (inJson && !line.startsWith('[TRACE') && !line.startsWith('[DEBUG')) {
    jsonOutput += line + '\n';
  }
  if (line.trim() === '}') {
    break;
  }
}
```

**Limitations:**
- Fragile - depends on trace log format
- Complex parsing logic required
- May miss nested JSON structures

### 3. Avoid `2>&1` in Tests
```javascript
// Don't capture stderr when expecting JSON
const output = execCommand(`${memoryCheckPath} --quiet --json`);
// Instead of
const output = execCommand(`${memoryCheckPath} --quiet --json 2>&1`);
```

**Limitations:**
- May miss real errors
- Not always possible in test frameworks

## Performance Impact

When CI=true, every command execution generates approximately:
- 50-100 trace log lines for simple commands
- 200+ lines for complex commands with pipes
- Each log line is ~100-200 characters

For a test suite with 100 commands, this adds:
- 10,000+ lines of trace logs
- 1-2 MB of extra output
- Significant parsing overhead

## Recommended Solutions

### For command-stream Library

1. **Add trace control option**
```javascript
const $silent = $({ 
  mirror: false, 
  capture: true, 
  trace: false  // New option to disable trace logs
});
```

2. **Respect mirror:false for all output**
- When `mirror: false`, suppress trace logs too
- Trace logs should go to a separate stream/file

3. **Environment variable override**
```javascript
// Allow disabling via env var
process.env.COMMAND_STREAM_TRACE = 'false';
```

### For Our Codebase (Until Fixed)

1. **Standardize stderr redirection**
   - Add `2>/dev/null` to all commands in CI-sensitive scripts
   - Document this pattern in CLAUDE.md

2. **Robust JSON parsing**
   - Always filter trace logs before JSON.parse()
   - Use try-catch with fallback parsing

3. **CI-specific test configuration**
   - Detect CI environment in tests
   - Use different command execution strategy

## Testing Recommendations

### Unit Tests
```javascript
describe('CI environment handling', () => {
  it('should parse JSON output even with trace logs', () => {
    const output = '[TRACE 2025...]\n{"status":"ok"}\n[TRACE...]';
    const result = parseJsonWithTraceLogs(output);
    expect(result.status).toBe('ok');
  });
});
```

### Integration Tests
```bash
# Test matrix
for ci_val in "" "true" "false"; do
  for json_flag in "" "--json"; do
    CI=$ci_val ./memory-check.mjs $json_flag --quiet
  done
done
```

## Related Issues

- Issue #16: Unwanted stdout output with mirror:false
- Issue #7: Stream output handling
- GitHub Actions test failures (workflow runs 17711040810, 17711023639, etc.)

## References

- [command-stream source](https://unpkg.com/command-stream)
- [GitHub Actions environment variables](https://docs.github.com/en/actions/learn-github-actions/environment-variables)
- [Our test failures](https://github.com/link-assistant/hive-mind/actions)

## Status

**Current:** Workarounds implemented, tests still fragile
**Needed:** Upstream fix in command-stream or migration to alternative

Last updated: 2025-09-14