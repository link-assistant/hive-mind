# Case Study: No HTTP Request/Response Logs in `--verbose` Mode for `--tool agent`

**Issue:** [#1521](https://github.com/link-assistant/hive-mind/issues/1521)
**Date:** 2026-04-01 (reported), 2026-04-03 (analyzed)

## Summary

When using `--tool agent --verbose`, the solution draft logs do not contain HTTP request/response entries (e.g., API calls to LLM providers). The same agent CLI, when invoked directly from the terminal with `--verbose`, correctly outputs all HTTP request/response details.

## Reproduction

### Working case (direct terminal):

```bash
echo "hi" | agent --verbose
```

Produces HTTP log entries like:

```json
{
  "type": "log",
  "service": "http",
  "message": "HTTP request",
  "url": "https://models.dev/api.json"
}
```

### Broken case (via hive-mind solve command):

```bash
node solve https://github.com/.../issues/843 --tool agent --verbose
```

Produces NO HTTP log entries. The agent outputs `"verboseAtCreation": false` despite `--verbose` being passed.

## Timeline of Events

1. Hive-mind `solve` command parses `--verbose` flag, sets `global.verboseMode = true`
2. `agent.lib.mjs` constructs agent CLI arguments: `--model opencode/minimax-m2.5-free --verbose`
3. Agent process starts via command-stream: `$({ cwd, mirror: false })\`cat ${promptFile} | ${agentPath} ${agentArgs}\``
4. Inside agent, `Flag.OPENCODE_VERBOSE` is initialized from environment variable `OPENCODE_VERBOSE` or `LINK_ASSISTANT_AGENT_VERBOSE` → **false** (not set in environment)
5. Yargs middleware calls `Flag.setVerbose(true)` from `argv.verbose`
6. But provider SDK instances log `"verboseAtCreation": false` at creation time
7. HTTP verbose fetch wrappers check `Flag.OPENCODE_VERBOSE` at call time, but the flag appears to remain **false** during actual HTTP calls
8. Result: 0 HTTP request/response log entries vs 18 in the working case

## Root Cause Analysis

### Primary Cause: Missing Environment Variable Propagation

The `agent.lib.mjs` module in hive-mind passes `--verbose` only as a CLI argument:

```javascript
// agent.lib.mjs line 488-489
if (argv.verbose) {
  agentArgs += ' --verbose';
}
```

But it does NOT set the `OPENCODE_VERBOSE` or `LINK_ASSISTANT_AGENT_VERBOSE` environment variable when spawning the agent process. Compare with `claude.lib.mjs` which correctly sets `ANTHROPIC_LOG=debug`:

```javascript
// claude.lib.mjs line 819
if (argv.verbose) claudeEnv.ANTHROPIC_LOG = 'debug';
```

### Secondary Cause: Agent CLI `--verbose` Flag Not Fully Effective

Inside the `@link-assistant/agent` package, `Flag.OPENCODE_VERBOSE` is initialized from environment variables at module load time (`flag.ts` line 60):

```typescript
export let OPENCODE_VERBOSE = truthyCompat('LINK_ASSISTANT_AGENT_VERBOSE', 'OPENCODE_VERBOSE');
```

The yargs middleware later calls `Flag.setVerbose(true)` when `--verbose` is detected. The HTTP verbose fetch wrapper checks `Flag.OPENCODE_VERBOSE` at call time (not creation time), so it should work. However, the evidence shows it doesn't:

- `verboseAtCreation: false` — expected, since env var is not set
- `globalVerboseFetchInstalled: true` — the global fetch interceptor IS installed
- 0 HTTP log entries — the fetch interceptor's `Flag.OPENCODE_VERBOSE` check returns `false`

This suggests a potential issue with how TypeScript namespace `export let` live bindings work in Bun's runtime, or a race condition where provider SDKs cache the verbose state.

## Evidence

### Working log (agent-cli-log.txt):

- Agent version: 0.18.3
- `verboseAtCreation: true` (env var set or flag propagated correctly)
- 18 HTTP request/response log entries
- Source: https://gist.githubusercontent.com/konard/6a7107ae7987ef5ed19653d4b3b707cb/raw/

### Broken log (solution-draft-log.txt):

- Agent version: 0.18.1
- `verboseAtCreation: false`
- 0 HTTP request/response log entries
- `globalVerboseFetchInstalled: true` (interceptor installed but not firing)
- Source: https://gist.githubusercontent.com/konard/79a96bcdf4b1e91ba83ba7bced26976c/raw/

### Key log comparison:

| Metric                        | Working (direct) | Broken (via solve) |
| ----------------------------- | ---------------- | ------------------ |
| Agent version                 | 0.18.3           | 0.18.1             |
| `verboseAtCreation`           | `true`           | `false`            |
| `globalVerboseFetchInstalled` | `true`           | `true`             |
| HTTP log entries              | 18               | 0                  |
| `--verbose` in command        | Yes              | Yes                |
| `OPENCODE_VERBOSE` env var    | Set (terminal)   | **Not set**        |

## Solution

### Fix in hive-mind (this PR)

Pass `OPENCODE_VERBOSE=true` and `LINK_ASSISTANT_AGENT_VERBOSE=true` environment variables to the agent process when `--verbose` is enabled. This mirrors the pattern used by `claude.lib.mjs` which sets `ANTHROPIC_LOG=debug`.

```javascript
// Build environment for agent process
const agentEnv = { ...process.env };
if (argv.verbose) {
  agentEnv.OPENCODE_VERBOSE = 'true';
  agentEnv.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
}

execCommand = $({
  cwd: tempDir,
  mirror: false,
  env: agentEnv,
})`cat ${promptFile} | ${agentPath} ${agentArgs}`;
```

### Upstream issue filed

Filed [link-assistant/agent#229](https://github.com/link-assistant/agent/issues/229) for the `--verbose` CLI flag not properly enabling HTTP logging when the `OPENCODE_VERBOSE` environment variable is not set. The `--verbose` flag should be fully equivalent to setting the environment variable.

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1521
- Working log: https://gist.githubusercontent.com/konard/6a7107ae7987ef5ed19653d4b3b707cb/raw/
- Broken log: https://gist.githubusercontent.com/konard/79a96bcdf4b1e91ba83ba7bced26976c/raw/
- Agent CLI source: https://github.com/link-assistant/agent
- Related agent issues: #206, #215, #217, #221
- command-stream auto-quoting: https://github.com/link-assistant/hive-mind/docs/dependencies-research/command-stream-issues/issue-18-auto-quoting-control.mjs
