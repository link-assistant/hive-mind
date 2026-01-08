---
'@link-assistant/hive-mind': minor
---

Add experimental --execute-tool-with-bun option to improve speed and memory usage

This feature adds the `--execute-tool-with-bun` option that allows users to execute the AI tool using `bunx claude` instead of `claude`, which may provide performance benefits in terms of speed and memory usage.

**Supported commands:**

- `solve` - Uses `bunx claude` when option is enabled
- `task` - Uses `bunx claude` when option is enabled
- `review` - Uses `bunx claude` when option is enabled
- `hive` - Passes the option through to the `solve` subprocess

**How It Works:**
When `--execute-tool-with-bun` is enabled, the `claudePath` variable is set to `'bunx claude'` instead of `'claude'` (or `CLAUDE_PATH` environment variable).

**Usage Examples:**

```bash
# Use with solve command
solve https://github.com/owner/repo/issues/123 --execute-tool-with-bun

# Use with task command
task "implement feature X" --execute-tool-with-bun

# Use with review command
review https://github.com/owner/repo/pull/456 --execute-tool-with-bun

# Use with hive command (passes through to solve)
hive https://github.com/owner/repo --execute-tool-with-bun
```

The option defaults to `false` to maintain backward compatibility.

Fixes #812
