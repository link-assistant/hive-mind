# Implementation Plan

## Timeline of Events (Reconstructed)

1. **2025-11-12 11:47:04** - Session started (Session ID: 019a77e4-0716-7152-8396-b642e26c3e20)
2. **2025-11-12 11:47:04** - Turn started
3. **2025-11-12 11:47:04** - Error occurred: "You've hit your usage limit"
4. **2025-11-12 11:47:04** - Turn failed
5. **Issue observed**: Command shown as successful instead of failed
6. **Issue observed**: User had to dig through logs to find the error
7. **Expected**: Clear, prominent message about usage limit at top level

## Root Cause Analysis

### Primary Issue
The usage limit error is only detected as a generic "rate limit" without proper handling for the specific "usage limit" error type that includes reset time information.

### Secondary Issues
1. Error message pattern not comprehensive enough
2. No extraction of reset time from error messages
3. GitHub comment format doesn't distinguish usage limits from other failures
4. User has to read full logs to understand what happened

### Why Current Implementation Fails

1. **Detection Gap**: Current patterns don't match "You've hit your usage limit"
   - Claude checks: `rate_limit_exceeded`, `You have exceeded your rate limit`, `rate limit`
   - Codex checks: `rate_limit`, `limit`
   - OpenCode checks: `rate_limit`, `limit`
   - **None check**: "You've hit your usage limit"

2. **No Time Extraction**: Reset time is in the error message but not extracted

3. **Generic Failure Format**: Usage limits use same comment format as other failures

## Proposed Solutions

### Solution 1: Enhanced Error Detection (MUST HAVE)

**Location**: All three tool files
- `src/claude.lib.mjs`
- `src/codex.lib.mjs`
- `src/opencode.lib.mjs`

**Implementation**:
1. Create shared utility function for usage limit detection
2. Add pattern: "You've hit your usage limit"
3. Add pattern: "hit your usage limit"
4. Extract reset time using regex
5. Return structured data: `{ isUsageLimit, resetTime }`

**Code location**: Create new file `src/usage-limit.lib.mjs`

### Solution 2: Enhanced Result Objects (MUST HAVE)

**Location**: All three tool execution functions

**Current return**:
```javascript
{
  success: false,
  sessionId,
  limitReached: true
}
```

**Enhanced return**:
```javascript
{
  success: false,
  sessionId,
  limitReached: true,
  limitResetTime: "12:16 PM",
  errorType: "usage_limit"
}
```

### Solution 3: New GitHub Comment Format (MUST HAVE)

**Location**: `src/github.lib.mjs`

**Add new format function**: `formatUsageLimitComment()`

**Format structure**:
```markdown
## ⏳ Usage Limit Reached

The automated solution draft was interrupted because the AI tool hit its usage limit.

### 📊 Limit Information
- **Tool**: [tool-name]
- **Limit Type**: Usage limit
- **Reset Time**: [time] (if available)
- **Session ID**: [session-id]

### 🔄 How to Continue

Once the limit resets, you can resume this session by running:
```
[resume command]
```

[Optional: logs section if --attach-logs]

---
*This session was interrupted due to usage limits. You can resume once the limit resets.*
```

### Solution 4: Enhanced Console Output (SHOULD HAVE)

**Location**: All three tool files

**Current output**:
```
⏳ Rate limit reached. The session can be resumed later.
```

**Enhanced output**:
```
⏳ Usage Limit Reached!

Your AI tool usage limit has been reached.
The limit will reset at: 12:16 PM

To resume this session after the limit resets, run:
   [resume command]

Session ID: [session-id]
```

## Implementation Steps

### Step 1: Create Usage Limit Detection Module
- [ ] Create `src/usage-limit.lib.mjs`
- [ ] Implement `detectUsageLimit(message)` function
- [ ] Implement `extractResetTime(message)` function
- [ ] Add unit tests

### Step 2: Update Claude Tool
- [ ] Import usage limit detection function
- [ ] Replace existing rate limit detection (lines 1111-1120)
- [ ] Enhance console output
- [ ] Return enhanced result object
- [ ] Test with sample errors

### Step 3: Update Codex Tool
- [ ] Import usage limit detection function
- [ ] Replace existing rate limit detection (lines 394-396)
- [ ] Enhance console output
- [ ] Return enhanced result object
- [ ] Test with sample errors

### Step 4: Update OpenCode Tool
- [ ] Import usage limit detection function
- [ ] Replace existing rate limit detection (lines 330-332)
- [ ] Enhance console output
- [ ] Return enhanced result object
- [ ] Test with sample errors

### Step 5: Update GitHub Comment Formatting
- [ ] Add `formatUsageLimitComment()` to `github.lib.mjs`
- [ ] Update `attachLogFileToTarget()` to handle usage limit type
- [ ] Check for `limitReached` and `errorType` in result
- [ ] Route to appropriate formatter
- [ ] Include logs when --attach-logs is set

### Step 6: Update Result Handlers
- [ ] Find where tool results are processed
- [ ] Ensure `limitResetTime` is passed through
- [ ] Ensure `errorType` is passed through
- [ ] Update any result validators

### Step 7: Testing
- [ ] Create test scenarios for each tool
- [ ] Test usage limit detection
- [ ] Test reset time extraction
- [ ] Test comment formatting
- [ ] Test with --attach-logs flag
- [ ] Test without --attach-logs flag
- [ ] Verify logs are sanitized

### Step 8: Documentation
- [ ] Update README if needed
- [ ] Add comments to new code
- [ ] Document the new error format

## Files to Create

1. `src/usage-limit.lib.mjs` - Detection utilities
2. `src/usage-limit.test.mjs` - Unit tests (optional but recommended)

## Files to Modify

1. `src/claude.lib.mjs` - Lines ~1111-1120
2. `src/codex.lib.mjs` - Lines ~394-396
3. `src/opencode.lib.mjs` - Lines ~330-332
4. `src/github.lib.mjs` - Add new format function
5. Result handler files (need to identify where results are processed)

## Testing Strategy

### Unit Tests
```javascript
// Test usage limit detection
test('detects usage limit with reset time', () => {
  const message = "You've hit your usage limit. try again at 12:16 PM.";
  const result = detectUsageLimit(message);
  assert.equal(result.isUsageLimit, true);
  assert.equal(result.resetTime, "12:16 PM");
});
```

### Integration Tests
1. Mock a usage limit error from each tool
2. Verify detection works
3. Verify result object is correct
4. Verify comment is formatted correctly
5. Verify logs are attached when requested

### Manual Testing
1. Test with real usage limit (if possible)
2. Verify user experience matches requirements
3. Verify resume commands work

## Risk Assessment

### Low Risk
- Adding new detection patterns (backward compatible)
- Adding new comment format (doesn't break existing)
- Extracting reset time (optional field)

### Medium Risk
- Modifying existing error handling logic
- Changes to result object structure (need to verify all consumers)

### Mitigation
- Keep existing error detection as fallback
- Make new fields optional
- Add comprehensive tests
- Use feature flags if needed

## Success Metrics

1. ✅ Usage limit errors are detected with 100% accuracy
2. ✅ Reset time is extracted when available
3. ✅ Special comment format is used for usage limits
4. ✅ Users can identify the issue without reading logs
5. ✅ Resume instructions are clear and correct
6. ✅ All three tools behave consistently
