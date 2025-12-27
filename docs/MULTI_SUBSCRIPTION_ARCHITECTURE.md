# Multiple Claude MAX Subscriptions Architecture

This document analyzes architecture options for supporting multiple Claude MAX subscriptions in the Hive Mind ecosystem, as requested in [issue #978](https://github.com/link-assistant/hive-mind/issues/978).

## Problem Statement

Currently, the Hive Mind system uses a single Claude MAX subscription per instance. When running multiple concurrent AI operations (via `/solve` or `/hive` commands from the Telegram bot), all operations share the same subscription's rate limits. This can lead to:

1. **Rate limit bottlenecks** - Multiple concurrent operations exhaust limits faster
2. **Reduced throughput** - Operations must wait for limit resets
3. **Single point of failure** - If one subscription has issues, all operations are affected

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Telegram Bot                                │
│  (telegram-bot.mjs)                                                 │
│                                                                     │
│   /solve ──────────────┐                                            │
│   /hive  ──────────────┼─────► start-screen ─────► solve/hive.mjs   │
│   /limits ─────────────┘                                            │
└───────────────────────────────────────────────────────────────────┬─┘
                                                                    │
                                                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Claude Credentials                               │
│  (~/.claude/.credentials.json)                                      │
│                                                                     │
│   Single OAuth token with access to one Claude MAX subscription     │
└───────────────────────────────────────────────────────────────────┬─┘
                                                                    │
                                                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Claude API                                       │
│  (api.anthropic.com)                                                │
│                                                                     │
│   Rate limited per subscription                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Related Components

### 1. Claude Profiles (github.com/link-assistant/claude-profiles)

A CLI tool that manages multiple Claude configuration profiles stored as GitHub Gists:

- **Store/Restore**: Backs up `~/.claude/` directory including credentials
- **Cross-Platform**: Handles macOS Keychain ↔ Linux credential conversion
- **Watch Mode**: Auto-saves configuration changes
- **Profile Names**: Lowercase alphanumeric with hyphens (e.g., `work`, `personal`, `server-1`)

### 2. Telegram Bot (telegram-bot.mjs)

The interface where users request AI operations:

- `/solve <url>` - Solve a GitHub issue
- `/hive <url>` - Run hive orchestration
- `/limits` - Check current usage limits
- Validates models, handles overrides, spawns screen sessions

### 3. Solve/Hive Commands

Execute Claude operations in isolated temp directories:

- Read credentials from `~/.claude/.credentials.json`
- Call Claude CLI with specified model
- Report results back to PRs

## Architecture Options

### Option A: Profile Switching at Bot Level

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Telegram Bot                                │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              Profile Manager (NEW)                          │    │
│  │                                                             │    │
│  │  profiles: [profile-1, profile-2, profile-3]                │    │
│  │  selection: round-robin | least-loaded | random             │    │
│  │                                                             │    │
│  │  selectProfile() ──► claude-profiles --restore <name>       │    │
│  │                                                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                            │                                        │
│   /solve ──────────────────┼─────► start-screen ─────► solve.mjs    │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Claude Credentials                                  │
│  (Switched per operation via claude-profiles)                       │
└─────────────────────────────────────────────────────────────────────┘
```

**Pros:**

- Centralized profile management
- Leverages existing `claude-profiles` tool
- Simple round-robin or load-based selection

**Cons:**

- Profile switching affects global state (`~/.claude/`)
- Race conditions if multiple operations run concurrently
- Cannot run truly parallel operations with different profiles

**Implementation Effort:** Medium

---

### Option B: Docker-Based Profile Isolation

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Telegram Bot                                │
│                                                                     │
│   /solve ──► Docker Container Pool Manager (NEW)                    │
│                                                                     │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│   │ Container 1  │  │ Container 2  │  │ Container 3  │              │
│   │ Profile: A   │  │ Profile: B   │  │ Profile: C   │              │
│   │ Status: busy │  │ Status: idle │  │ Status: idle │              │
│   └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

**Pros:**

- True isolation between profiles
- Parallel operations without race conditions
- Matches existing Docker infrastructure
- Can scale horizontally

**Cons:**

- Higher resource usage (memory, disk per container)
- More complex orchestration
- Container startup latency
- Credential management per container

**Implementation Effort:** High

---

### Option C: Environment Variable-Based Profile Selection

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Telegram Bot                                │
│                                                                     │
│  New options:                                                       │
│    --profile <name>     Select Claude profile                       │
│    --profile-rotation   Enable auto-rotation                        │
│                                                                     │
│   /solve --profile work ──► CLAUDE_PROFILE=work solve.mjs           │
└────────────────────────────────────────────────────────────────────┬┘
                                                                     │
                                                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│               solve.mjs / claude.lib.mjs                            │
│                                                                     │
│  if (process.env.CLAUDE_PROFILE) {                                  │
│    // Restore profile before execution                              │
│    await $`claude-profiles --restore ${profile}`;                   │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

**Pros:**

- Minimal changes to existing code
- User can explicitly choose profile
- Easy to implement incrementally

**Cons:**

- Still has global state race condition
- Requires user to know profile names
- No automatic load balancing

**Implementation Effort:** Low

---

### Option D: Temporary Directory Isolation with Profile Copy

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Telegram Bot                                │
│                                                                     │
│  Profile Pool Manager (NEW):                                        │
│    - Available profiles: [A, B, C]                                  │
│    - selectLeastLoaded() → profile                                  │
│                                                                     │
│   /solve ──► create temp dir ──► copy profile credentials           │
│              /tmp/solve-xxx/        HOME=/tmp/solve-xxx solve.mjs   │
└─────────────────────────────────────────────────────────────────────┘
```

**Pros:**

- True isolation without Docker overhead
- Parallel operations possible
- Uses existing temp directory pattern in solve.mjs

**Cons:**

- Requires credential duplication logic
- HOME environment manipulation complexity
- May break Claude CLI assumptions

**Implementation Effort:** Medium-High

---

### Option E: Kubernetes Multi-Pod with Service Mesh

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Kubernetes Cluster                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                  Telegram Bot Pod                            │    │
│  │                  (Load Balancer)                             │    │
│  └────────────────────────┬────────────────────────────────────┘    │
│                           │                                         │
│  ┌────────────────────────┼────────────────────────────────────┐    │
│  │                        ▼                                    │    │
│  │   ┌──────────┐   ┌──────────┐   ┌──────────┐                │    │
│  │   │ Worker   │   │ Worker   │   │ Worker   │                │    │
│  │   │ Pod A    │   │ Pod B    │   │ Pod C    │                │    │
│  │   │ Profile A│   │ Profile B│   │ Profile C│                │    │
│  │   └──────────┘   └──────────┘   └──────────┘                │    │
│  │                 Worker Deployment                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ConfigMaps/Secrets: Claude credentials per profile                 │
└─────────────────────────────────────────────────────────────────────┘
```

**Pros:**

- Enterprise-grade scalability
- Proper credential management via Secrets
- Health checking, auto-restart
- Uses existing Helm chart infrastructure

**Cons:**

- Requires Kubernetes infrastructure
- Complex setup and maintenance
- Overkill for small deployments

**Implementation Effort:** High

---

## Recommended Approach

### Phase 1: Environment Variable Approach (Option C)

**Target: Quick win, minimal changes**

1. Add `--profile` option to `/solve` and `/hive` commands
2. Bot passes profile to solve/hive via environment variable
3. Before Claude execution, run `claude-profiles --restore <profile>` if specified
4. Document that concurrent operations with same profile share limits

### Phase 2: Temp Directory Isolation (Option D)

**Target: True parallelism**

1. Extend solve.mjs to copy profile credentials to temp directory
2. Set HOME environment variable for Claude CLI execution
3. Implement profile pool with usage tracking
4. Automatic profile selection based on least-loaded

### Phase 3: Kubernetes Multi-Pod (Option E)

**Target: Production scale**

1. Extend Helm chart with worker deployment
2. Store credentials in Kubernetes Secrets
3. Implement queue-based task distribution
4. Add monitoring and alerting

## Configuration Design

```yaml
# Example LINO configuration for Telegram bot
TELEGRAM_BOT_TOKEN: 'xxx'
TELEGRAM_ALLOWED_CHATS: -1002975819706
TELEGRAM_CLAUDE_PROFILES:
  - name: profile-a
    gist: personal-gist-id
  - name: profile-b
    gist: work-gist-id
  - name: profile-c
    gist: team-gist-id
TELEGRAM_PROFILE_SELECTION: round-robin # or: least-loaded, random
```

## Open Questions

1. **Credential Security**: How to safely store/transfer multiple subscription credentials?
2. **Usage Tracking**: Should we track usage per profile and report in `/limits`?
3. **Profile Health**: How to detect and handle exhausted/invalid profiles?
4. **User Experience**: Should users choose profiles or should it be automatic?

## Implementation Priority

Given the issue states this is primarily the Telegram bot's responsibility:

1. **First**: Add profile support to telegram-bot.mjs with manual selection
2. **Second**: Add automatic profile rotation in telegram-bot.mjs
3. **Third**: Extend to hive.mjs for concurrent workers
4. **Fourth**: Consider Docker/Kubernetes isolation for production

## Related Files

| File                        | Changes Needed                           |
| --------------------------- | ---------------------------------------- |
| `src/telegram-bot.mjs`      | Add `--profile` option handling          |
| `src/solve.mjs`             | Read CLAUDE_PROFILE env, restore profile |
| `src/hive.mjs`              | Profile pool for concurrent workers      |
| `src/claude.lib.mjs`        | Profile-aware credential reading         |
| `src/claude-limits.lib.mjs` | Multi-profile usage display              |

## References

- [Issue #978](https://github.com/link-assistant/hive-mind/issues/978)
- [claude-profiles repository](https://github.com/link-assistant/claude-profiles)
- [Docker documentation](./DOCKER.md)
- [Helm chart](./HELM.md)
