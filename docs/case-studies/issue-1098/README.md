# Case Study: Issue #1098 - Socket Connection Closed Unexpectedly with `--tool agent`

## Summary

When using the `--tool agent` option with the Grok Code Fast model via OpenCode Zen, the agent process fails approximately 12 seconds after startup with the error:

```
Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()
```

This is a **known issue with Bun's `fetch()` implementation** that affects long-running HTTP connections, streaming responses, and certain network configurations.

## Timeline of Events

| Timestamp (UTC)          | Event                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------- |
| 2026-01-10T21:19:50.024Z | Solve v0.54.4 initiated with Grok Code Fast model                                  |
| 2026-01-10T21:19:55.929Z | Disk/memory checks passed, validation skipped                                      |
| 2026-01-10T21:20:00.888Z | Fork created: `konard/veb86-GristWidgets`                                          |
| 2026-01-10T21:20:07.502Z | Initial commit with CLAUDE.md created                                              |
| 2026-01-10T21:20:15.688Z | Draft PR #2 created successfully                                                   |
| 2026-01-10T21:20:22.852Z | Agent CLI execution started with `opencode/grok-code` model                        |
| 2026-01-10T21:20:23.285Z | Agent entered continuous listening mode (stdin-stream)                             |
| 2026-01-10T21:20:34.712Z | **FAILURE**: Socket connection closed unexpectedly (~12 seconds after agent start) |
| 2026-01-10T21:20:34.713Z | UnhandledRejection error propagated                                                |
| 2026-01-10T21:20:35.036Z | Cleanup: CLAUDE.md commit reverted                                                 |
| 2026-01-10T21:20:37.799Z | PR converted from draft to ready for review                                        |

**Key observation**: The failure occurred ~12 seconds after the agent started, which aligns with Bun's default `idleTimeout` of 10 seconds in `Bun.serve()` contexts.

## Root Cause Analysis

### Primary Root Cause: Bun's `fetch()` Socket Connection Issues

The error is a **known bug in Bun** affecting its `fetch()` API implementation. Multiple issues have been reported across Bun, OpenCode, and related projects:

1. **Bun Issue #14439** - `ConnectionClosed` when trying to `fetch` for more than 10s
   - Default `idleTimeout` in `Bun.serve()` is 10 seconds
   - Workaround: Set `idleTimeout: 120` for longer connections
   - Status: CLOSED (workaround documented)

2. **Bun Issue #16719** - bun dev server fails with ConnectionClosed after 10+ minutes
   - Affects SSE/EventStream connections
   - DevCycle support confirmed this is a known Bun bug

3. **Bun Issue #9881** - ConnectionClosed with various external URLs
   - Multiple users affected, tagged as needing reproduction

### Secondary Contributing Factors

1. **Streaming API Responses**: The Grok Code model uses streaming responses which require maintaining long-lived HTTP connections. Bun's socket handling for streaming may be unstable.

2. **Upstream Provider Connection Drops**: Per OpenCode maintainer feedback, this error can occur "when the upstream provider is dropping your connection."

3. **Git Repository Context**: OpenCode issue #2304 documented that operating in a directory with a `.git` folder can cause a 30-second hang followed by this same socket error. This may be related to snapshot/caching operations.

### Error Details from Logs

```json
{
  "type": "error",
  "timestamp": 1768080034712,
  "sessionID": "ses_45637e0dcffeqxaDRRDyQRd69N",
  "error": {
    "name": "UnknownError",
    "data": {
      "message": "Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"
    }
  }
}
```

The error manifests as:

- `UnknownError` error type
- `UnhandledRejection` exception type
- No additional verbose information was collected (verbose mode not enabled)

## Evidence Collected

All evidence has been saved to `./evidence/`:

1. `solution-draft-log.txt` - Full execution log from the failed session
2. `pr-comment.json` - The PR comment containing the log upload
3. `related-issues.md` - Summary of related GitHub issues across Bun and OpenCode

## Related Issues Across Projects

### Bun (oven-sh/bun)

- [#14439](https://github.com/oven-sh/bun/issues/14439) - ConnectionClosed when fetch > 10s (CLOSED)
- [#16719](https://github.com/oven-sh/bun/issues/16719) - Dev server fails after 10+ minutes (OPEN)
- [#9881](https://github.com/oven-sh/bun/issues/9881) - ConnectionClosed with various URLs (OPEN)
- [#12730](https://github.com/oven-sh/bun/issues/12730) - Fetch to wrangler dev server crashes (OPEN)
- [#17434](https://github.com/oven-sh/bun/issues/17434) - Fetch not working with proxy (OPEN)

### OpenCode (sst/opencode, anomalyco/opencode)

- [#1692](https://github.com/sst/opencode/issues/1692) - Same socket error
- [#3511](https://github.com/anomalyco/opencode/issues/3511) - Socket error from MCP server
- [#2304](https://github.com/sst/opencode/issues/2304) - Error with .git folder (CLOSED)
- [#555](https://github.com/sst/opencode/issues/555) - Hit and miss chats (CLOSED)
- [#2519](https://github.com/anomalyco/opencode/issues/2519) - Tool calling frequently fails

### Other Projects

- [Factory-AI/factory#570](https://github.com/Factory-AI/factory/issues/570) - Connection issues
- [onlook-dev/onlook#3030](https://github.com/onlook-dev/onlook/issues/3030) - Self-hosted web client fails

## Proposed Solutions

### Immediate Workarounds

1. **Use Node.js Instead of Bun for Critical Operations**
   - The fetch issues are specific to Bun's implementation
   - Node.js does not exhibit these socket timeout issues
   - Could wrap the agent CLI execution with Node.js

2. **Enable `verbose: true` in Fetch Calls**
   - Add verbose mode to fetch calls to capture more diagnostic information
   - In `provider.ts`, modify the custom fetch wrapper:

   ```typescript
   options['fetch'] = async (input: any, init?: BunFetchRequestInit) => {
     return fetchFn(input, {
       ...rest,
       signal: combined,
       verbose: true, // Add this for debugging
     });
   };
   ```

3. **Increase Timeout/IdleTimeout Configuration**
   - Set explicit timeout values higher than the default 10 seconds
   - The agent already has timeout configuration in `provider.ts`:

   ```typescript
   if (options['timeout'] !== undefined && options['timeout'] !== null) {
     signals.push(AbortSignal.timeout(options['timeout']));
   }
   ```

   - Ensure this is set appropriately (e.g., 120000ms = 2 minutes)

4. **Retry Logic for Transient Failures**
   - Implement automatic retry when socket connection errors occur
   - The error is often transient and succeeds on retry

### Long-term Solutions for link-assistant/agent

1. **Add Explicit Timeout Configuration**
   - Document and enforce minimum timeout values for streaming operations
   - Add configuration option: `fetchTimeout` or similar

2. **Implement Robust Error Handling**
   - Catch `socket connection was closed unexpectedly` errors specifically
   - Implement exponential backoff retry logic
   - Log detailed diagnostics when these errors occur

3. **Consider Alternative HTTP Libraries**
   - For critical streaming operations, consider using a more stable HTTP client
   - Options: undici (Node.js), got, axios with streaming support

4. **Report Upstream to Bun**
   - Create a minimal reproducible example for the Bun team
   - Link to existing related issues for context

## Recommendations for Issue Report to link-assistant/agent

A new issue should be created at https://github.com/link-assistant/agent with:

1. **Title**: `Socket connection closed unexpectedly during streaming API responses with Bun`

2. **Reproducible Example**:

   ```bash
   # Using agent with grok-code model
   echo '{"message": "Hello"}' | agent --model opencode/grok-code
   # Or via solve.mjs
   node solve.mjs https://github.com/example/repo/issues/1 --tool agent
   ```

3. **Expected Behavior**: Agent should successfully process the request and return a response

4. **Actual Behavior**: After ~10-12 seconds, the connection fails with socket closed error

5. **Workaround**:
   - Use a different tool (e.g., Claude Code) instead of agent
   - Retry the operation (often succeeds on second attempt)

6. **Suggested Fix**:
   - Add retry logic for socket errors
   - Increase default timeouts
   - Add verbose mode for better debugging

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1098
- Failed PR: https://github.com/veb86/GristWidgets/pull/2
- PR Comment with Log: https://github.com/veb86/GristWidgets/pull/2#issuecomment-3733564917
- Bun Issue (10s timeout): https://github.com/oven-sh/bun/issues/14439
- OpenCode .git Issue: https://github.com/sst/opencode/issues/2304

## Conclusion

The socket connection error is a known issue with Bun's `fetch()` implementation, particularly affecting:

- Long-running HTTP connections (> 10 seconds)
- Streaming API responses
- Operations in git repository contexts

The most effective immediate workaround is implementing retry logic, as the error is often transient. Long-term, the agent CLI should either switch to Node.js for these operations or implement robust error handling with retry mechanisms.
