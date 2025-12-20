# Technical Summary: Codex CLI 401 Authentication Failures

## Quick Facts
- **Date**: 2025-11-11
- **Duration**: 18m 47s (12:18:52 - 12:37:39 UTC)
- **Failure Count**: 27 consecutive sessions
- **Error Type**: 401 Unauthorized
- **Success Rate**: 0/27 (0%)
- **Root Cause**: Invalid/missing Codex CLI authentication credentials

## Technical Root Cause

### HTTP 401 Unauthorized
Every Codex CLI session failed with:
```json
{
  "type": "turn.failed",
  "error": {
    "message": "exceeded retry limit, last status: 401 Unauthorized, request id: 99cd*-AMS"
  }
}
```

**Meaning**: Authentication credentials are invalid, expired, or missing.

**Not**: Network issue, rate limit, or service outage.

### Command Executed
```bash
cd "/tmp/gh-issue-solver-1762863542921" && \
  cat "/tmp/gh-issue-solver-1762863542921/codex_prompt.txt" | \
  codex exec --model gpt-5 --json --full-auto
```

### Authentication Flow Failure
1. Codex CLI attempts to authenticate
2. Reads credentials from:
   - Environment: `$CODEX_API_KEY`
   - Config: `~/.config/codex/config.yaml`
   - Other provider-specific locations
3. **Fails**: Credentials invalid/missing
4. Returns HTTP 401
5. Retries 5 times (all fail)
6. Returns to solve command

## System Design Issues

### Issue 1: No Pre-flight Authentication Check
```javascript
// solve.mjs - Current behavior
if (tool === 'codex') {
  // ❌ No authentication validation
  await executeClaude({ ... });  // Fails here
}

// Proposed
if (tool === 'codex') {
  // ✅ Validate first
  await validateCodexAuth();
  await executeClaude({ ... });
}
```

### Issue 2: Retry Logic Doesn't Distinguish Error Types
```javascript
// claude.lib.mjs - Current retry logic
if (data.type === 'error') {
  // ❌ Retries ALL errors, including 401
  retryCount++;
  if (retryCount < 5) retry();
}

// Proposed
if (data.type === 'error') {
  if (is401Unauthorized(data)) {
    // ✅ Don't retry auth errors
    throw new AuthenticationError();
  }
  // Retry other errors
  retryCount++;
  if (retryCount < 5) retry();
}
```

### Issue 3: Auto-restart on Authentication Failures
```javascript
// solve.watch.lib.mjs - Current behavior
while (true) {
  toolResult = await executeClaude({ ... });
  if (!toolResult.success) {
    // ❌ Restarts regardless of error type
    continue;
  }
}

// Proposed
while (true) {
  toolResult = await executeClaude({ ... });
  if (!toolResult.success) {
    if (toolResult.authenticationRequired) {
      // ✅ Exit on auth errors
      break;
    }
    continue;
  }
}
```

### Issue 4: No Circuit Breaker
```javascript
// Current: Infinite retry potential
let failureCount = 0;
while (true) {
  result = await execute();
  if (!result.success) failureCount++;
  // ❌ No limit
}

// Proposed: Circuit breaker
let failureCount = 0;
const MAX_FAILURES = 3;
while (true) {
  result = await execute();
  if (!result.success) {
    failureCount++;
    if (failureCount >= MAX_FAILURES) {
      // ✅ Stop after 3 failures
      break;
    }
  } else {
    failureCount = 0;  // Reset on success
  }
}
```

## Code Changes Required

### Change 1: Add Authentication Error Detection
**File**: `src/claude.lib.mjs`
**Location**: Line ~900-950 (error handling in executeClaudeCommand)

```javascript
// Detect 401 Unauthorized specifically
if (data.type === 'error' &&
    (data.message.includes('401 Unauthorized') ||
     data.message.includes('401 unauthorized'))) {

  await log(`❌ AUTHENTICATION FAILURE: Codex CLI returned 401 Unauthorized`,
           { color: 'red' });

  return {
    success: false,
    error: 'AUTHENTICATION_FAILURE',
    authenticationRequired: true,
    sessionId: null
  };
}
```

### Change 2: Add Pre-flight Check
**File**: `src/solve.mjs`
**Location**: Before line ~790 (before executeClaude call)

```javascript
// Validate Codex authentication before starting
if (tool === 'codex' && !argv['skip-auth-check']) {
  await log(`🔐 Validating Codex CLI authentication...`);

  try {
    const authResult = await execPromise('codex auth status', {
      timeout: 5000
    });

    if (authResult.exitCode !== 0) {
      throw new Error('Not authenticated');
    }

    await log(`✅ Codex authentication validated`);
  } catch (authError) {
    await log(`❌ Codex authentication failed`, { color: 'red' });
    await log(`   Run: codex auth login`);
    process.exit(1);
  }
}
```

### Change 3: Handle Authentication Errors in Main Flow
**File**: `src/solve.mjs`
**Location**: After line ~797 (after executeClaude returns)

```javascript
const { success, sessionId, authenticationRequired, error } = toolResult;

if (authenticationRequired) {
  await log(`❌ Cannot proceed: Codex CLI authentication required`);
  await log(`   Please authenticate: codex auth login`);
  process.exit(1);
}
```

### Change 4: Add Circuit Breaker to Watch Mode
**File**: `src/solve.watch.lib.mjs`
**Location**: In watchForFeedback function

```javascript
let consecutiveAuthFailures = 0;
const MAX_AUTH_FAILURES = 2;

while (true) {
  // ... existing check logic ...

  if (shouldRestart) {
    toolResult = await executeClaude({ ... });

    if (toolResult.authenticationRequired) {
      consecutiveAuthFailures++;

      if (consecutiveAuthFailures >= MAX_AUTH_FAILURES) {
        await log(`❌ Circuit breaker: ${consecutiveAuthFailures} auth failures`);
        break;
      }
    } else {
      consecutiveAuthFailures = 0;
    }
  }
}
```

## Testing Requirements

### Test 1: Authentication Failure Detection
```bash
# Setup: Invalid API key
export CODEX_API_KEY="invalid"

# Execute
solve [issue-url] --tool codex

# Expected:
# - Error detected in < 10 seconds
# - Clear "401 Unauthorized" message
# - Troubleshooting steps shown
# - Process exits (no retries)
# - Exit code: 1
```

### Test 2: Circuit Breaker
```bash
# Setup: Simulate repeated auth failures in watch mode

# Expected:
# - First failure: Logged
# - Second failure: Logged
# - Third failure: Circuit breaker activated
# - Process stops
# - Clear exit message
```

### Test 3: Pre-flight Check
```bash
# Setup: No authentication

# Execute
solve [issue-url] --tool codex

# Expected:
# - Auth check runs before PR creation
# - Fails immediately
# - No PR created
# - No branch created
# - Exit code: 1
```

### Test 4: Successful Authentication
```bash
# Setup: Valid authentication

# Execute
solve [issue-url] --tool codex

# Expected:
# - Auth check passes
# - Codex executes successfully
# - PR created and updated
# - No auth errors
```

## Performance Metrics

### Current State (Broken)
- Time to first error: ~5 seconds
- Time to give up: ~32 seconds per session
- Total wasted time: 18 minutes 47 seconds
- User intervention: Required (Ctrl+C)

### Target State (Fixed)
- Time to first error: ~5 seconds
- Time to give up: ~5 seconds (no retries on 401)
- Total wasted time: < 10 seconds
- User intervention: Not required

### Improvement
- **95% faster failure detection** (~32s → ~5s)
- **99% reduction in wasted time** (18m → 10s)
- **Zero unnecessary retries** (135 → 0)

## Error Classification

### Non-retriable Errors (4xx Client Errors)
**Action**: Fail fast, no retry
- 400 Bad Request
- 401 Unauthorized ← **This case**
- 403 Forbidden
- 404 Not Found
- 422 Unprocessable Entity

### Retriable Errors with Backoff (Rate Limits)
**Action**: Retry with exponential backoff
- 429 Too Many Requests

### Retriable Errors (5xx Server Errors)
**Action**: Retry with backoff
- 500 Internal Server Error
- 502 Bad Gateway
- 503 Service Unavailable
- 504 Gateway Timeout

### Retriable Errors (Network)
**Action**: Retry with backoff
- Connection timeout
- Connection refused
- DNS resolution failure

## Implementation Priority

### P0 (Critical - Ship in next release)
1. ✅ Authentication error detection
2. ✅ Circuit breaker for auth failures
3. ✅ Clear error messages with troubleshooting

### P1 (High - Ship within month)
4. ⚠️ Pre-flight authentication check
5. ⚠️ Proper error classification (4xx vs 5xx vs network)
6. ⚠️ Documentation updates

### P2 (Medium - Ship within quarter)
7. 💡 Monitoring and alerting
8. 💡 `--verify-auth` flag
9. 💡 Enhanced troubleshooting guides

## Related Code Files

| File | Lines | Purpose | Changes Needed |
|------|-------|---------|----------------|
| `src/solve.mjs` | ~790-800 | Main orchestration | Add pre-flight check, handle auth errors |
| `src/solve.mjs` | ~918-933 | Watch mode trigger | Don't trigger on auth errors |
| `src/solve.watch.lib.mjs` | ~200-400 | Watch loop | Add circuit breaker |
| `src/claude.lib.mjs` | ~900-1000 | Error handling | Detect 401, classify errors |
| `src/claude.lib.mjs` | ~700-800 | Retry logic | Skip retries for 4xx errors |

## Monitoring Recommendations

### Metrics to Track
```javascript
// Add to monitoring
metrics.increment('codex.auth.failures');
metrics.increment('codex.sessions.total');
metrics.gauge('codex.failure.rate', failureRate);
metrics.histogram('codex.time_to_failure', timeMs);
```

### Alerts to Set Up
- **Critical**: Auth failure rate > 50% over 5 minutes
- **Warning**: Auth failure rate > 10% over 15 minutes
- **Info**: Individual auth failure

### Logs to Capture
- Authentication status at startup
- Each authentication failure with request ID
- Circuit breaker activations
- Pre-flight check results

## Dependencies

### External
- **Codex CLI**: Authentication mechanism
- **Network**: Connection to Codex API
- **Credentials**: API keys, config files

### Internal
- `src/solve.mjs`: Main flow
- `src/solve.watch.lib.mjs`: Watch mode
- `src/claude.lib.mjs`: Execution
- `src/github.lib.mjs`: PR management

## Rollout Plan

### Phase 1: Development (Week 1)
- Implement P0 changes
- Unit tests for auth error detection
- Integration tests for circuit breaker

### Phase 2: Testing (Week 2)
- Manual testing with invalid credentials
- Test all error scenarios
- Validate error messages

### Phase 3: Staging (Week 3)
- Deploy to staging environment
- Monitor for false positives
- Gather user feedback

### Phase 4: Production (Week 4)
- Gradual rollout (10% → 50% → 100%)
- Monitor authentication failure rates
- Incident response ready

## Success Criteria

✅ **Must Have**:
- Authentication failures detected within 10 seconds
- No more than 1 retry for 401 errors
- Clear error message with troubleshooting steps
- Process exits cleanly

✅ **Should Have**:
- Pre-flight authentication check
- Circuit breaker prevents > 3 consecutive auth failures
- Monitoring and alerting in place

✅ **Nice to Have**:
- `--verify-auth` flag
- Enhanced documentation
- Video tutorials

## Conclusion

The Codex CLI 401 authentication failure can be completely prevented with:

1. **Pre-flight checks** - Validate before work starts
2. **Error classification** - Don't retry client errors (4xx)
3. **Circuit breakers** - Stop after repeated failures
4. **Clear messaging** - Help users troubleshoot

**Impact**: 95% faster failure detection, 99% less wasted time, better UX.

**Risk**: Low - changes are defensive and improve reliability.

**Effort**: ~3 days development + 1 week testing.
