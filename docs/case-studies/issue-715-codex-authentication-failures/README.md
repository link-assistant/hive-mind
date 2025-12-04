# Case Study: Repeated Codex CLI Authentication Failures (401 Unauthorized)

## Issue Reference
- **Issue**: [#715 - Unable to complete pull request draft using Codex CLI](https://github.com/deep-assistant/hive-mind/issues/715)
- **Pull Request**: [#716](https://github.com/deep-assistant/hive-mind/pull/716)
- **Referenced PR with failures**: [veb86/zcadvelecAI#522](https://github.com/veb86/zcadvelecAI/pull/522)
- **Full log gist**: [bec2f59f1a5422e5ce6e1f35b2f61d71](https://gist.github.com/konard/bec2f59f1a5422e5ce6e1f35b2f61d71)

## Executive Summary

The Codex CLI repeatedly failed with **401 Unauthorized** errors during an attempt to solve issue #521 in the veb86/zcadvelecAI repository. The tool attempted to execute 27 consecutive sessions over approximately 18 minutes (12:19:39 - 12:37:39 UTC), and **every single session failed** with authentication errors after exhausting 5 retry attempts each.

Key findings:
- **27 failed authentication attempts** in total
- **54 total 401 Unauthorized errors** recorded (27 sessions × 2 error types: connection retry + turn.failed)
- **100% failure rate** - no session succeeded even partially
- **Zero actual work completed** - the AI never executed a single action
- **Auto-restart loop** triggered due to uncommitted files (codex_prompt.txt), but continued failing
- **Process interrupted** manually via Ctrl+C after 18+ minutes of continuous failures

## Evidence Timeline

### Session Overview
```
Duration: 18 minutes 47 seconds (12:18:52 - 12:37:39 UTC on 2025-11-11)
Total Sessions: 27 distinct Codex CLI sessions
Success Rate: 0/27 (0%)
Error Pattern: All sessions failed with "401 Unauthorized" after 5 reconnection attempts
```

### Detailed Timeline

#### Phase 1: Initial Setup and First Failure (12:18:52 - 12:20:11)
```
12:18:52 - solve v0.30.1 started
12:19:02 - Repository cloned: konard/zcadvelecAI (fork mode)
12:19:19 - Branch created: issue-521-0be368979d29
12:19:29 - PR #522 created (draft) on veb86/zcadvelecAI
12:19:39 - First Codex session started
           Session ID: 019a72db-80ed-7911-8a8a-94994ffc009b
12:19:44 - First reconnection attempt (1/5)
12:19:49 - Second reconnection attempt (2/5)
12:19:53 - Third reconnection attempt (3/5)
12:19:58 - Fourth reconnection attempt (4/5)
12:20:04 - Fifth reconnection attempt (5/5)
12:20:11 - FAILED: "exceeded retry limit, last status: 401 Unauthorized"
           Request ID: 99cdbe04acfb0b34-AMS
```

#### Phase 2: Auto-Restart Loop (12:20:11 - 12:37:31)
The system detected uncommitted changes (`codex_prompt.txt`) and triggered auto-restart, leading to 26 additional failed sessions:

| Session # | Start Time | Session ID | Request ID | Result |
|-----------|------------|------------|------------|--------|
| 1 | 12:19:39 | 019a72db-80ed-7911-8a8a-94994ffc009b | 99cdbe04acfb0b34-AMS | 401 Unauthorized |
| 2 | 12:20:25 | 019a72dc-34ca-7820-870e-f4dece70ce89 | 99cdbf27ee0ea01a-AMS | 401 Unauthorized |
| 3 | 12:21:04 | 019a72dc-ce20-7cd0-9bd8-7fee84abc663 | 99cdc01b2b079fd6-AMS | 401 Unauthorized |
| 4 | 12:21:43 | 019a72dd-65de-7d72-9b8e-644975d9931a | 99cdc1107b240b81-AMS | 401 Unauthorized |
| 5 | 12:22:22 | 019a72dd-ff70-7dc1-a8a4-252adf8da6bf | 99cdc207bcc5b994-AMS | 401 Unauthorized |
| 6 | 12:23:02 | 019a72de-99ee-7123-a5ef-fef4aead0a13 | 99cdc2fb48190e36-AMS | 401 Unauthorized |
| 7 | 12:23:41 | 019a72df-31a1-7af0-b3cf-0bbec0b9c3cf | 99cdc3f0de7f3466-AMS | 401 Unauthorized |
| 8 | 12:24:20 | 019a72df-cbbd-77d1-b27e-afd99bd5d5cc | 99cdc4e16bff06c8-AMS | 401 Unauthorized |
| 9 | 12:24:59 | 019a72e0-62d7-75a2-b306-5efc8de0e4b4 | 99cdc5d82ec1b8f7-AMS | 401 Unauthorized |
| 10 | 12:25:38 | 019a72e0-fc82-72f3-a2a8-4dc8d623014e | 99cdc6ca19e196e6-AMS | 401 Unauthorized |
| 11 | 12:26:17 | 019a72e1-939d-79b3-ba0b-6d3848ec2ff4 | 99cdc7c37cf48b43-AMS | 401 Unauthorized |
| 12 | 12:26:57 | 019a72e2-3027-7802-9eb5-98eadbbd5179 | 99cdc8b61bc1f794-AMS | 401 Unauthorized |
| 13 | 12:27:36 | 019a72e2-c854-7bc3-95ce-67b46812182a | 99cdc9b14d7266f1-AMS | 401 Unauthorized |
| 14 | 12:28:16 | 019a72e3-6482-7793-ba5b-3912f5bfb631 | 99cdcaab9ff1b594-AMS | 401 Unauthorized |
| 15 | 12:28:56 | 019a72e4-006e-7773-b282-47c5f82e9dd8 | 99cdcba43fc133c7-AMS | 401 Unauthorized |
| 16 | 12:29:36 | 019a72e4-9d87-7110-8f96-9bfc54bc1ba4 | 99cdcc991cc20a73-AMS | 401 Unauthorized |
| 17 | 12:30:15 | 019a72e5-350e-7652-a0ac-cc01b996cff1 | 99cdcd89a88a06d4-AMS | 401 Unauthorized |
| 18 | 12:30:54 | 019a72e5-ccf2-7020-b3d1-92d78abb37bf | 99cdce800db366fe-AMS | 401 Unauthorized |
| 19 | 12:31:33 | 019a72e6-67fd-7b13-9b21-0bed522bac51 | 99cdcf7c0b201add-AMS | 401 Unauthorized |
| 20 | 12:32:14 | 019a72e7-0688-76a0-8e99-606f7b7709d0 | 99cdd077cc4cfeb3-AMS | 401 Unauthorized |
| 21 | 12:32:54 | 019a72e7-a150-7d93-9332-bdc1404250f8 | 99cdd1743821b8be-AMS | 401 Unauthorized |
| 22 | 12:33:34 | 019a72e8-3dbf-70a3-bd00-2d468214a5da | 99cdd268fe549fbe-AMS | 401 Unauthorized |
| 23 | 12:34:13 | 019a72e8-d5fa-72b3-ac02-ea26810abc0b | 99cdd35db9e56616-AMS | 401 Unauthorized |
| 24 | 12:34:52 | 019a72e9-709c-7bd0-b738-72bac270b164 | 99cdd457aadf0b05-AMS | 401 Unauthorized |
| 25 | 12:35:32 | 019a72ea-0bbf-7463-bd99-83e6f91a2614 | 99cdd54bc9f80b05-AMS | 401 Unauthorized |
| 26 | 12:36:11 | 019a72ea-a56c-77f1-9a8a-0f9d93e227b4 | 99cdd646c9b38ea8-AMS | 401 Unauthorized |
| 27 | 12:36:51 | 019a72eb-4138-7d00-81bb-d7cbe9a6de76 | 99cdd73d79b8fba1-AMS | 401 Unauthorized |

#### Phase 3: Feedback Detection and Final Failure (12:37:25 - 12:37:39)
```
12:37:25 - Check #27 detected new PR comments (1 comment)
12:37:25 - PR description was edited after last commit
12:37:31 - Feedback detected: Auto-restart triggered again
12:37:31 - New session started: 019a72eb-dc57-79e2-b943-2951218f833c
12:37:35 - Reconnecting... 1/5
12:37:39 - Process interrupted manually (CTRL+C)
```

### Error Pattern Analysis

Each session followed an identical failure pattern:
1. **Session start** - Thread created, turn started
2. **Immediate failure** - Connection fails within 4-5 seconds
3. **Retry attempts** - 5 reconnection attempts with exponential backoff
4. **Final failure** - After ~30 seconds, error: "exceeded retry limit, last status: 401 Unauthorized"

**Timing Pattern** (typical session):
```
T+0s:  thread.started
T+0s:  turn.started
T+5s:  Reconnecting... 1/5
T+9s:  Reconnecting... 2/5
T+14s: Reconnecting... 3/5
T+19s: Reconnecting... 4/5
T+25s: Reconnecting... 5/5
T+32s: exceeded retry limit, last status: 401 Unauthorized
```

### Request IDs Analysis

All request IDs follow the pattern `99cd*-AMS`, indicating:
- **Routing location**: AMS (Amsterdam) data center
- **Consistent prefix**: `99cd` suggests same routing infrastructure
- **Sequential increment**: IDs show chronological progression
- **Geographic consistency**: All requests routed to same region

## Root Cause Analysis

### Primary Root Cause: Authentication Token Issues

The **401 Unauthorized** HTTP status code definitively indicates authentication failure. Based on the evidence:

#### 1. **Invalid or Expired API Token**
- Codex CLI requires valid authentication credentials
- The command was executed with `codex exec --model gpt-5 --json --full-auto`
- No explicit token was visible in the command (expected to come from environment/config)
- 100% failure rate suggests the token was invalid from the start

#### 2. **Token Configuration Issues**
Possible scenarios:
- **Missing token**: Codex CLI couldn't find authentication credentials
- **Expired token**: Token was valid previously but expired before this run
- **Wrong token**: Token doesn't have access to the requested model (gpt-5)
- **Revoked token**: Token was revoked or invalidated
- **Configuration error**: Token not properly loaded from config file or environment

#### 3. **Model Access Issues**
The command requested `--model gpt-5`, which might:
- Not exist or be unavailable
- Require special access/permissions
- Be incorrectly named (should be a different model identifier)
- Require different authentication scope than provided token

### Secondary Contributing Factors

#### 4. **Auto-Restart Loop Amplification**
The solve command has auto-restart logic that exacerbated the problem:

```
solve.mjs:918-933 (watchForFeedback logic)
├─ Detected uncommitted files: codex_prompt.txt
├─ Triggered auto-restart
└─ Repeated failed Codex execution 26 more times
```

**Why it happened:**
- First Codex session failed immediately (401)
- System detected "uncommitted changes" (the prompt file itself)
- Auto-restart triggered to handle "changes"
- Each restart encountered the same authentication error
- No circuit breaker to stop after repeated authentication failures

**Code location**: `solve.watch.lib.mjs` - watch mode doesn't detect authentication errors as terminal failures

#### 5. **Feedback Loop Detection**
Around session #27, the system detected:
- New PR comment (the auto-attached log from first failure)
- PR description edit
- Triggered yet another restart despite previous failures

**Code location**: Lines 12:37:26-12:37:31 in log

```javascript
// solve.watch.lib.mjs checks for feedback
💬 New PR comments: 1
📢 FEEDBACK DETECTED!
   • New comments on the pull request: 1
   • Pull request description was edited after last commit
🔄 Restarting: Re-running CODEX to handle feedback...
```

#### 6. **No Circuit Breaker for Authentication Errors**
The system lacks detection for systematic authentication failures:
- No tracking of consecutive 401 errors
- No early termination after N authentication failures
- Auto-restart treats 401 same as any other failure
- Could continue indefinitely without manual intervention

### Technical Details

#### Codex CLI Integration
The solve command integrates with Codex CLI via:

```bash
cd "/tmp/gh-issue-solver-1762863542921" && \
  cat "/tmp/gh-issue-solver-1762863542921/codex_prompt.txt" | \
  codex exec --model gpt-5 --json --full-auto
```

**Expected flow:**
1. Codex CLI reads credentials (from `~/.config/codex/` or environment)
2. Establishes connection to Codex backend
3. Authenticates with API token
4. Creates session and processes prompt
5. Streams results back as JSON

**Actual flow (broken):**
1. Codex CLI attempts to read credentials ✓
2. Attempts connection ✓
3. **Authentication fails (401)** ✗
4. Retries 5 times (all fail) ✗
5. Returns error to solve command ✗
6. Solve command misinterprets as recoverable, restarts ✗

#### HTTP 401 Unauthorized Details

From HTTP specification:
> The 401 (Unauthorized) status code indicates that the request has not been applied because it lacks valid authentication credentials for the target resource.

In this context:
- **Not a network issue** - Connection established (otherwise would be connection timeout)
- **Not a rate limit** - Would return 429 Too Many Requests
- **Not a service outage** - Would return 503 Service Unavailable
- **Definitively authentication** - Token invalid, expired, or missing

#### Amsterdam Data Center Routing

All requests routed to AMS (Amsterdam):
- Consistent geographic routing
- No failover to other regions attempted
- Suggests single-region configuration or closest region selection
- Not a regional availability issue (same error across all attempts)

## Impact Analysis

### Resource Wastage
- **Time wasted**: 18+ minutes of automated retries
- **API calls**: 27 session creation attempts
- **Network requests**: ~135 HTTP requests (27 sessions × 5 retries)
- **Compute resources**: Minimal (failed fast), but still spawned 27 sessions
- **User attention**: Required manual intervention to stop

### User Experience Impact
- **Frustration**: User waited 18+ minutes with no progress
- **Confusion**: Error messages are technical (401 Unauthorized)
- **No clear guidance**: System doesn't suggest how to fix authentication
- **PR left incomplete**: Created PR #522 but never populated with actual changes
- **Log pollution**: Created large gist with mostly failure logs

### Repository Impact
- **Draft PR created**: veb86/zcadvelecAI#522 left in WIP state
- **Branch created**: issue-521-0be368979d29 with only CLAUDE.md commit
- **No actual work done**: Issue #521 remains unsolved
- **PR needs cleanup**: Either delete or complete manually

### System Reliability
- **False positive PR creation**: System creates PR before validating Codex works
- **No early failure detection**: Continues retrying despite 100% authentication failure rate
- **Auto-restart misuse**: Auto-restart not appropriate for authentication errors
- **Resource inefficiency**: Unnecessary retries consume quota and time

## Related Code Locations

### Primary Files Involved

1. **`src/solve.mjs`** (Main orchestrator)
   - Lines ~790-800: Codex execution initiation
   - Lines ~918-933: Watch mode and auto-restart logic
   - Lines ~933+: Log attachment after completion

2. **`src/solve.watch.lib.mjs`** (Watch mode)
   - Feedback detection logic
   - Auto-restart trigger conditions
   - Lacks circuit breaker for authentication errors

3. **`src/claude.lib.mjs`** (Claude/Codex execution)
   - `executeClaudeCommand()` function
   - Codex CLI command construction
   - Error handling and retry logic
   - Lines ~900-1000: Stream parsing and error detection

4. **Codex CLI** (External tool)
   - Binary: `codex exec`
   - Config location: `~/.config/codex/` (typical)
   - Environment variables: `CODEX_API_KEY` or similar
   - Authentication mechanism: Bearer token in HTTP headers

## Proposed Solutions

### Solution 1: Add Authentication Failure Detection (Critical Priority)

**Approach**: Detect 401 errors specifically and fail fast without retrying.

**Implementation**:

```javascript
// In claude.lib.mjs - executeClaudeCommand()

// After receiving error from Codex CLI
if (data.type === 'error' && data.message.includes('401 Unauthorized')) {
  await log(`❌ AUTHENTICATION FAILURE: Codex CLI authentication failed (401)`, { color: 'red' });
  await log(``, { verbose: true });
  await log(`🔧 Troubleshooting steps:`, { verbose: true });
  await log(`   1. Check if Codex CLI is properly authenticated`, { verbose: true });
  await log(`   2. Run: codex auth status`, { verbose: true });
  await log(`   3. If not authenticated, run: codex auth login`, { verbose: true });
  await log(`   4. Verify API key has access to model: gpt-5`, { verbose: true });
  await log(``, { verbose: true });

  return {
    success: false,
    error: 'AUTHENTICATION_FAILURE',
    sessionId: null,
    authenticationRequired: true  // Special flag
  };
}
```

**In solve.mjs - after Codex execution**:
```javascript
const { success, sessionId, authenticationRequired, error } = toolResult;

if (authenticationRequired) {
  await log(`❌ Cannot proceed: Authentication required for Codex CLI`);
  await log(`   Please authenticate and try again.`);
  process.exit(1);  // Exit immediately, don't retry
}
```

**Pros**:
- Immediate feedback to user
- Prevents wasteful retries
- Clear troubleshooting guidance
- Minimal code changes

**Cons**:
- Requires error message parsing (fragile if message format changes)
- Need to handle multiple authentication error formats

### Solution 2: Add Circuit Breaker for Repeated Failures (High Priority)

**Approach**: Track consecutive failures and abort after threshold.

**Implementation**:

```javascript
// In solve.watch.lib.mjs

let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;
const AUTHENTICATION_ERROR_THRESHOLD = 2;
let authenticationErrors = 0;

while (true) {
  // ... existing check logic ...

  if (shouldRestart) {
    toolResult = await executeClaude({ ... });

    if (!toolResult.success) {
      consecutiveFailures++;

      // Track authentication-specific errors
      if (toolResult.error === 'AUTHENTICATION_FAILURE') {
        authenticationErrors++;
      }

      // Circuit breaker
      if (authenticationErrors >= AUTHENTICATION_ERROR_THRESHOLD) {
        await log(`❌ Circuit breaker triggered: ${authenticationErrors} authentication failures`);
        await log(`   Cannot proceed without valid authentication.`);
        break;  // Exit watch loop
      }

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        await log(`❌ Circuit breaker triggered: ${consecutiveFailures} consecutive failures`);
        await log(`   Stopping auto-restart to prevent infinite loop.`);
        break;  // Exit watch loop
      }
    } else {
      // Reset on success
      consecutiveFailures = 0;
      authenticationErrors = 0;
    }
  }
}
```

**Pros**:
- Prevents infinite retry loops
- Handles authentication and other error types
- Configurable thresholds
- Provides clear exit reason

**Cons**:
- Adds complexity to watch mode logic
- Need to determine appropriate thresholds
- May need different thresholds for different error types

### Solution 3: Pre-flight Authentication Check (Medium Priority)

**Approach**: Validate Codex authentication before creating PR and starting work.

**Implementation**:

```javascript
// In solve.mjs - before PR creation

if (tool === 'codex') {
  await log(`🔐 Checking Codex CLI authentication...`);

  // Test command: codex auth status or simple echo test
  const authCheck = await execPromise('codex auth status', { timeout: 5000 });

  if (authCheck.error || authCheck.exitCode !== 0) {
    await log(`❌ Codex CLI authentication check failed`, { color: 'red' });
    await log(`   Please authenticate first: codex auth login`);
    await log(`   Or check your CODEX_API_KEY environment variable`);
    process.exit(1);
  }

  await log(`✅ Codex CLI authentication verified`);
}
```

**Pros**:
- Fails fast before any work
- Prevents unnecessary PR/branch creation
- Clear user guidance
- Simple implementation

**Cons**:
- Requires knowing correct authentication check command
- May not catch all authentication issues (different models/permissions)
- Adds startup time

### Solution 4: Improve Error Messages and User Guidance (Low Priority)

**Approach**: When authentication fails, provide actionable troubleshooting steps.

**Implementation**:

Add to error handling in multiple locations:

```javascript
// Comprehensive troubleshooting guide
const CODEX_AUTH_TROUBLESHOOTING = `
╔═══════════════════════════════════════════════════════════╗
║         CODEX CLI AUTHENTICATION FAILURE                  ║
╚═══════════════════════════════════════════════════════════╝

The Codex CLI returned a 401 Unauthorized error, which means
authentication is not properly configured.

📋 Troubleshooting Steps:

1️⃣  Check authentication status:
   $ codex auth status

2️⃣  If not authenticated, login:
   $ codex auth login

   Follow the prompts to authenticate with your account.

3️⃣  Verify your API key (if using environment variable):
   $ echo $CODEX_API_KEY

   Make sure it's set and not expired.

4️⃣  Check model access:
   The command requested model: gpt-5

   Verify your account has access to this model.
   You may need to:
   - Request access through the Codex dashboard
   - Use a different model name
   - Upgrade your account tier

5️⃣  Check Codex CLI version:
   $ codex --version

   Make sure you're using a recent version.

📚 Documentation:
   - Codex CLI docs: [URL]
   - Authentication guide: [URL]
   - Model access: [URL]

💡 Quick fix attempts:
   $ codex auth logout && codex auth login
`;

// Display when authentication error detected
await log(CODEX_AUTH_TROUBLESHOOTING);
```

**Pros**:
- Greatly improves user experience
- Reduces support burden
- Self-service troubleshooting
- Educational

**Cons**:
- Takes up console space
- May become outdated if Codex CLI changes
- Assumes access to documentation

### Solution 5: Add `--verify-auth` Flag (Enhancement)

**Approach**: Add optional flag to test authentication before execution.

**Implementation**:

```bash
# User can verify before running expensive operations
$ solve [issue-url] --tool codex --verify-auth

🔐 Verifying Codex CLI authentication...
✅ Authentication successful
✅ Model access verified: gpt-5
✅ Token expiry: 29 days remaining

# Then proceed with actual solve if verification passed
```

**Pros**:
- User-controlled verification
- Can be used in CI/CD pipelines
- Debugging tool
- No impact on normal usage

**Cons**:
- Requires maintenance
- Users need to know about the flag
- Doesn't help users who don't use it

## Recommended Implementation Plan

### Phase 1: Critical Fixes (Immediate - Day 1)
1. ✅ **Implement Solution 1**: Authentication failure detection with clear error messages
2. ✅ **Implement Solution 2**: Circuit breaker for repeated failures
3. ✅ **Test**: Verify early termination on authentication errors

### Phase 2: Prevention (Short term - Week 1)
4. ✅ **Implement Solution 3**: Pre-flight authentication check
5. ✅ **Update documentation**: Document authentication requirements
6. ✅ **Add logging**: Better visibility into authentication process

### Phase 3: User Experience (Medium term - Month 1)
7. ⚠️ **Implement Solution 4**: Comprehensive error messages and troubleshooting
8. ⚠️ **Add monitoring**: Track authentication failure rates
9. ⚠️ **Update examples**: Show proper authentication setup

### Phase 4: Enhancement (Long term - Quarter 1)
10. 💡 **Implement Solution 5**: Verification flags and tools
11. 💡 **Add health checks**: Periodic authentication validation
12. 💡 **Improve documentation**: Video tutorials, troubleshooting flowcharts

## Testing Strategy

### Test Cases

#### TC1: Authentication Failure Detection
**Setup**: Configure invalid Codex API key
**Execute**: Run solve command with Codex tool
**Expected**:
- ✅ Error detected within first attempt
- ✅ Clear "401 Unauthorized" message shown
- ✅ Troubleshooting steps displayed
- ✅ Process exits immediately (no retries)
- ✅ Exit code: 1

#### TC2: Circuit Breaker Activation
**Setup**: Simulate repeated authentication failures
**Execute**: Trigger auto-restart scenario
**Expected**:
- ✅ First failure: Logged and counted
- ✅ Second failure: Logged and counted
- ✅ Third failure: Circuit breaker triggered
- ✅ Auto-restart stops
- ✅ Clear explanation of why it stopped

#### TC3: Pre-flight Check Success
**Setup**: Configure valid Codex authentication
**Execute**: Run solve command with Codex tool
**Expected**:
- ✅ Authentication verified before PR creation
- ✅ Success message displayed
- ✅ Normal execution proceeds
- ✅ No unnecessary authentication checks during execution

#### TC4: Pre-flight Check Failure
**Setup**: No Codex authentication configured
**Execute**: Run solve command with Codex tool
**Expected**:
- ✅ Authentication check fails immediately
- ✅ Error message with troubleshooting displayed
- ✅ No PR created
- ✅ No branch created
- ✅ Process exits cleanly

#### TC5: Valid Authentication End-to-End
**Setup**: Properly authenticated Codex CLI
**Execute**: Complete solve workflow
**Expected**:
- ✅ Authentication checks pass
- ✅ Codex executes successfully
- ✅ PR created and updated
- ✅ No authentication errors logged

### Validation Criteria

For each solution implemented:
- ✅ Authentication failures detected within 10 seconds
- ✅ No more than 3 retry attempts for authentication errors
- ✅ Clear error messages with actionable steps
- ✅ Process exits cleanly (no hanging)
- ✅ No orphaned PRs or branches
- ✅ Proper exit codes for scripting
- ✅ Logs contain troubleshooting information

## Prevention Measures

### For Users
1. **Before running solve with Codex**:
   ```bash
   # Verify authentication
   codex auth status

   # If needed, authenticate
   codex auth login

   # Test with simple command
   echo "test" | codex exec --model gpt-5
   ```

2. **Set up environment properly**:
   ```bash
   # Add to ~/.bashrc or ~/.zshrc
   export CODEX_API_KEY="your-key-here"

   # Or use config file
   ~/.config/codex/config.yaml
   ```

3. **Use pre-flight check** (once implemented):
   ```bash
   solve [issue] --tool codex --verify-auth
   ```

### For Developers
1. **Add authentication tests** to CI/CD
2. **Monitor authentication failure rates** in production
3. **Document authentication requirements** prominently
4. **Add authentication to troubleshooting guide**
5. **Consider fallback mechanisms** (switch to Claude Code if Codex fails?)

### For System Design
1. **Separate authentication check from execution**
2. **Fail fast on non-retriable errors** (4xx client errors)
3. **Different retry strategies** for different error types:
   - 401/403: Don't retry (auth issue)
   - 429: Retry with backoff (rate limit)
   - 500/503: Retry (server issue)
   - Network: Retry with backoff
4. **Circuit breakers** for all automated retry loops
5. **Monitoring and alerts** for repeated failures

## Lessons Learned

### What Went Wrong
1. **No authentication validation** before expensive operations
2. **Retry logic didn't distinguish** between retriable and non-retriable errors
3. **Auto-restart triggered** on non-retriable authentication failures
4. **No circuit breaker** to prevent infinite loops
5. **Poor error visibility** - 401 errors not surfaced clearly to user
6. **Resource waste** - 27 attempts over 18 minutes

### What Went Right
1. **Comprehensive logging** - Full visibility into what happened
2. **PR creation succeeded** - At least repository structure was set up
3. **Graceful handling** of Ctrl+C interrupt
4. **Logs attached** to PR for debugging
5. **Fork mode worked** correctly
6. **Branch management** was clean

### Improvements Made
1. ✅ Detailed case study documenting the issue
2. ✅ Clear root cause identification
3. ✅ Multiple solution options with pros/cons
4. ✅ Implementation plan with phases
5. ✅ Test cases for validation
6. ✅ Prevention measures documented

## Related Issues

- Session management and authentication state
- Retry logic for different error types
- Auto-restart trigger conditions
- Circuit breaker patterns in automation
- Error message clarity and actionability
- Pre-flight checks for external dependencies

## References

- **Issue**: https://github.com/deep-assistant/hive-mind/issues/715
- **Failed PR**: https://github.com/veb86/zcadvelecAI/pull/522
- **Original Issue**: https://github.com/veb86/zcadvelecAI/issues/521
- **Full Logs**: https://gist.github.com/konard/bec2f59f1a5422e5ce6e1f35b2f61d71
- **HTTP 401 Specification**: RFC 7235 Section 3.1
- **Codex CLI**: (Add actual documentation URL when known)

## Appendix: Sample Error Messages

### Current Error (Unhelpful)
```
{"type":"error","message":"exceeded retry limit, last status: 401 Unauthorized, request id: 99cdbe04acfb0b34-AMS"}
{"type":"turn.failed","error":{"message":"exceeded retry limit, last status: 401 Unauthorized, request id: 99cdbe04acfb0b34-AMS"}}
```

### Proposed Error (Helpful)
```
╔═══════════════════════════════════════════════════════════╗
║  ❌ AUTHENTICATION FAILURE: Codex CLI (401 Unauthorized)  ║
╚═══════════════════════════════════════════════════════════╝

The Codex CLI could not authenticate your request.

🔍 What this means:
   Your API credentials are missing, invalid, or expired.

🔧 How to fix:

   1. Check authentication status:
      $ codex auth status

   2. If not authenticated, login:
      $ codex auth login

   3. Verify model access for: gpt-5

📚 More help:
   - Documentation: https://docs.codex.com/authentication
   - Support: https://support.codex.com

Request ID: 99cdbe04acfb0b34-AMS
Timestamp: 2025-11-11T12:20:11.834Z
```

## Statistics Summary

| Metric | Value |
|--------|-------|
| Total duration | 18 minutes 47 seconds |
| Total sessions attempted | 27 |
| Total authentication failures | 27 (100%) |
| Total 401 errors logged | 54 |
| Average time per session | ~42 seconds |
| Retry attempts per session | 5 |
| Total retry attempts | 135 |
| Time wasted on retries | ~18 minutes |
| User intervention required | Yes (Ctrl+C) |
| Work completed | 0% |
| PR created but incomplete | 1 |

## Conclusion

This case study documents a complete failure of the solve command due to **Codex CLI authentication issues**. The root cause was definitively a **401 Unauthorized error**, indicating invalid or missing authentication credentials. The problem was severely amplified by:

1. **Lack of authentication validation** before starting work
2. **Inappropriate retry logic** that didn't distinguish authentication errors
3. **Auto-restart loop** that repeated the same failure 27 times
4. **No circuit breaker** to detect and stop systematic failures

The recommended solutions focus on:
- **Fast failure detection** for authentication errors
- **Clear user guidance** for troubleshooting
- **Circuit breakers** to prevent wasteful retries
- **Pre-flight checks** to validate before expensive operations

Implementing these solutions will prevent similar issues in the future and significantly improve the user experience when authentication problems occur.
