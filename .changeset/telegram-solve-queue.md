---
'@link-assistant/hive-mind': minor
---

Add producer/consumer queue for /solve command in Telegram bot

This feature implements resource-aware throttling to prevent system overload when multiple /solve commands are submitted simultaneously.

**Queue Configuration (using usage ratios 0.0-1.0):**

- `RAM_THRESHOLD: 0.5` - Stop new commands if RAM usage > 50%
- `CPU_THRESHOLD: 0.5` - Stop new commands if CPU usage > 50%
- `DISK_THRESHOLD: 0.95` - One-at-a-time mode if disk usage > 95%
- `CLAUDE_SESSION_THRESHOLD: 0.9` - Stop if Claude 5-hour limit > 90%
- `CLAUDE_WEEKLY_THRESHOLD: 0.99` - One-at-a-time mode if weekly limit > 99%
- `GITHUB_API_THRESHOLD: 0.8` - Stop if GitHub API > 80% with parallel claude commands
- 1-minute minimum interval between command starts
- Running claude process detection

**Status Flow:**

- `Queued` - Initial status when command is added to queue
- `Waiting` - When start conditions are not met (with human-readable reason)
- `Starting` - When command is being started
- `Started` - Terminal status with session info (message tracking is released)

**Caching:**

- API calls (Claude, GitHub): 3-minute cache
- System metrics (RAM, CPU, disk): 2-minute cache
- Shared cache between /solve queue and /limits command

**Files Changed:**

- `limits.lib.mjs` - Merged from `claude-limits.lib.mjs` with added caching layer (replaces both `claude-limits.lib.mjs` and `telegram-limits.lib.mjs`)
- `telegram-solve-queue.lib.mjs` - Queue implementation with status tracking

**User Experience:**

- Messages are updated in-place as status changes
- Clear waiting reasons displayed (e.g., "Disk usage is 96% (threshold: 95%)")
- Queue status added to /limits command output
