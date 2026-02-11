# Current Queue Implementation Details

## File: `src/queue-config.lib.mjs`

### Current Thresholds (as of v1.20.0)

| Metric | Threshold | Mode | Environment Variable |
|--------|-----------|------|---------------------|
| RAM | 65% | Enqueue (block) | `HIVE_MIND_RAM_THRESHOLD` |
| CPU | 65% | Enqueue (block) | `HIVE_MIND_CPU_THRESHOLD` |
| Disk | 90% | Dequeue-one-at-a-time | `HIVE_MIND_DISK_THRESHOLD` |
| Claude 5-hour Session | 65% | Dequeue-one-at-a-time | `HIVE_MIND_CLAUDE_5_HOUR_SESSION_THRESHOLD` |
| Claude Weekly | 97% | Dequeue-one-at-a-time | `HIVE_MIND_CLAUDE_WEEKLY_THRESHOLD` |
| GitHub API | 75% | Enqueue (with parallel check) | `HIVE_MIND_GITHUB_API_THRESHOLD` |

### Timing Configuration

| Setting | Default | Environment Variable |
|---------|---------|---------------------|
| Min Start Interval | 60000ms (1 min) | `HIVE_MIND_MIN_START_INTERVAL_MS` |
| Consumer Poll Interval | 60000ms (1 min) | `HIVE_MIND_CONSUMER_POLL_INTERVAL_MS` |
| Message Update Interval | 60000ms (1 min) | `HIVE_MIND_MESSAGE_UPDATE_INTERVAL_MS` |

## File: `src/telegram-solve-queue.lib.mjs`

### Queue Item States

```javascript
export const QueueItemStatus = {
  QUEUED: 'queued',
  WAITING: 'waiting',
  STARTING: 'starting',
  STARTED: 'started',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};
```

### Key Methods

#### `canStartCommand(options)`

Current logic flow:
1. Check minimum interval since last start
2. Count running claude processes
3. Check system resources (RAM, CPU, disk)
4. Check API limits (Claude, GitHub)
5. Determine if "claude running" should be a blocking reason

Returns:
- `canStart: boolean`
- `reason?: string`
- `reasons?: string[]`
- `oneAtATime?: boolean`

#### `checkSystemResources(totalProcessing)`

Current behavior:
- **RAM**: If >= threshold, adds blocking reason (enqueue mode)
- **CPU**: If >= threshold, adds blocking reason (enqueue mode)
- **Disk**: If >= threshold, sets `oneAtATime = true`, only blocks if `totalProcessing > 0`

#### `checkApiLimits(hasRunningClaude, claudeProcessingCount, tool)`

Current behavior:
- **Claude 5-hour**: If >= threshold, sets `oneAtATime = true`, blocks if `totalClaudeProcessing > 0`
- **Claude Weekly**: Same as 5-hour
- **GitHub API**: If >= threshold AND claude running, adds blocking reason

## File: `src/lino.lib.mjs`

### LinksNotationManager Class

```javascript
class LinksNotationManager {
  parse(input)          // Returns array of values from link
  parseNumericIds(input) // Returns numeric values only
  parseStringValues(input) // Returns string values only
  format(values)        // Converts values to lino format
  saveToCache(filename, values) // Persists to ~/.hive-mind/
  loadFromCache(filename)       // Loads from cache
}
```

### Example Usage

```javascript
const lino = new LinksNotationManager();

// Parse simple list
lino.parse("(a b c)"); // ["a", "b", "c"]

// Parse nested structure
lino.parse("papa (loves mama)");
// Returns parsed link structure
```

## Current Handling Mode Implementation

### Enqueue Mode (Block Unconditionally)

Location: `checkSystemResources()` for RAM and CPU

```javascript
if (usedRatio >= QUEUE_CONFIG.RAM_THRESHOLD) {
  reasons.push(formatWaitingReason('ram', ...));
  this.recordThrottle('ram_high');
}
```

### Dequeue-One-At-A-Time Mode

Location: `checkSystemResources()` for Disk

```javascript
if (usedRatio >= QUEUE_CONFIG.DISK_THRESHOLD) {
  oneAtATime = true;
  this.recordThrottle('disk_high');
  // Only block if something is already processing
  if (totalProcessing > 0) {
    reasons.push(formatWaitingReason('disk', ...));
  }
}
```

### Missing: Reject Mode

Not currently implemented. Would need:
1. Immediate return with error
2. No queueing
3. Clear error message to user

## Related Issues and PRs

- [#1242](https://github.com/link-assistant/hive-mind/issues/1242) - Centralized queue configuration
- [#1155](https://github.com/link-assistant/hive-mind/issues/1155) - Disk threshold behavior
- [#1133](https://github.com/link-assistant/hive-mind/issues/1133) - One-at-a-time mode for Claude limits
- [#1078](https://github.com/link-assistant/hive-mind/issues/1078) - Claude process detection is metric, not blocking
- [#1159](https://github.com/link-assistant/hive-mind/issues/1159) - Separate tool queues
