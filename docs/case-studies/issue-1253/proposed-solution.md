# Proposed Solution: Configurable Queue Thresholds

## Summary

This document details the proposed implementation for making queue thresholds configurable with multiple handling strategies.

## Configuration Format

### Links Notation Schema

```lino
(queue-config
  (disk (90% reject))
  (ram (65% enqueue))
  (cpu (65% enqueue))
  (claude-5-hour (65% dequeue-one-at-a-time))
  (claude-weekly (97% dequeue-one-at-a-time))
  (github-api (75% enqueue))
)
```

Or simplified (when setting defaults):

```lino
(
  (disk (90% reject))
  (ram (65% enqueue))
)
```

### Threshold Format

Each threshold is a triplet: `(metric-name (percentage% strategy))`

- **metric-name**: Identifier matching the system metric
- **percentage%**: Number followed by `%` sign (0-100)
- **strategy**: One of `reject`, `enqueue`, `dequeue-one-at-a-time`

## Handling Strategies

### 1. Reject

**Behavior:**

- Immediately reject the command
- No queue insertion
- Clear error message returned to user
- No waiting, no retry

**Use Cases:**

- Disk full (queue lost on restart anyway)
- Critical resource exhaustion
- Quota exceeded (no point waiting)

**Implementation:**

```javascript
// In canStartCommand() or before enqueue()
if (limitCheck.reject) {
  return {
    canStart: false,
    rejected: true,
    reason: `Cannot process: ${limitCheck.rejectReason}`,
  };
}
```

### 2. Enqueue (Block)

**Behavior:**

- Command waits in queue
- Checked on each poll interval
- Cannot start until metric drops below threshold
- Multiple commands can queue up

**Use Cases:**

- RAM high (transient, will improve)
- CPU high (load will decrease)
- API rate limit (will reset)

**Implementation:**

```javascript
// Current behavior - blocks all commands
if (usedRatio >= threshold) {
  reasons.push(`${metric} is ${percent}% (threshold: ${thresholdPercent})`);
}
```

### 3. Dequeue-One-At-A-Time

**Behavior:**

- Allows exactly ONE command to run when above threshold
- Subsequent commands wait until running one completes
- Useful for cleanup/recovery scenarios

**Use Cases:**

- Disk space (let one command try to free space)
- API limits near max (let one command finish)

**Implementation:**

```javascript
// Current one-at-a-time implementation
if (usedRatio >= threshold) {
  oneAtATime = true;
  if (totalProcessing > 0) {
    reasons.push(`${metric} is ${percent}% - waiting for current command`);
  }
}
```

## Code Changes

### 1. New Types (`queue-config.lib.mjs`)

```javascript
/**
 * Threshold handling strategy
 * @typedef {'reject' | 'enqueue' | 'dequeue-one-at-a-time'} ThresholdStrategy
 */

/**
 * Threshold configuration
 * @typedef {Object} ThresholdConfig
 * @property {number} value - Threshold ratio (0.0 - 1.0)
 * @property {ThresholdStrategy} strategy - How to handle exceeded threshold
 */
```

### 2. Updated QUEUE_CONFIG

```javascript
export const QUEUE_CONFIG = {
  thresholds: {
    ram: {
      value: parseFloatWithDefault('HIVE_MIND_RAM_THRESHOLD', 0.65),
      strategy: getenv('HIVE_MIND_RAM_STRATEGY', 'enqueue'),
    },
    cpu: {
      value: parseFloatWithDefault('HIVE_MIND_CPU_THRESHOLD', 0.65),
      strategy: getenv('HIVE_MIND_CPU_STRATEGY', 'enqueue'),
    },
    disk: {
      value: parseFloatWithDefault('HIVE_MIND_DISK_THRESHOLD', 0.9),
      strategy: getenv('HIVE_MIND_DISK_STRATEGY', 'reject'), // Changed default!
    },
    claude5HourSession: {
      value: parseFloatWithDefault('HIVE_MIND_CLAUDE_5_HOUR_SESSION_THRESHOLD', 0.65),
      strategy: getenv('HIVE_MIND_CLAUDE_5_HOUR_SESSION_STRATEGY', 'dequeue-one-at-a-time'),
    },
    claudeWeekly: {
      value: parseFloatWithDefault('HIVE_MIND_CLAUDE_WEEKLY_THRESHOLD', 0.97),
      strategy: getenv('HIVE_MIND_CLAUDE_WEEKLY_STRATEGY', 'dequeue-one-at-a-time'),
    },
    githubApi: {
      value: parseFloatWithDefault('HIVE_MIND_GITHUB_API_THRESHOLD', 0.75),
      strategy: getenv('HIVE_MIND_GITHUB_API_STRATEGY', 'enqueue'),
    },
  },
  // ... timing configs
};
```

### 3. Links Notation Parser

```javascript
/**
 * Parse queue configuration from links notation
 * @param {string} linoConfig - Configuration in links notation format
 * @returns {Object} Parsed threshold configurations
 */
export function parseQueueConfig(linoConfig) {
  if (!linoConfig) return {};

  const parser = new LinksNotationManager();
  const links = parser.parse(linoConfig);

  const config = {};

  for (const link of links) {
    // Each link: (metric-name (percentage% strategy))
    const metricName = link.id || link.values?.[0]?.id;
    const settings = link.values?.[1]; // The nested (percentage% strategy)

    if (metricName && settings) {
      const percentStr = settings.values?.[0]?.id || settings.id;
      const strategy = settings.values?.[1]?.id;

      // Parse "90%" -> 0.9
      const match = percentStr?.match(/^(\d+)%$/);
      if (match) {
        const value = parseInt(match[1]) / 100;
        config[normalizeMetricName(metricName)] = {
          value,
          strategy: validateStrategy(strategy),
        };
      }
    }
  }

  return config;
}

function normalizeMetricName(name) {
  // disk -> disk
  // ram -> ram
  // claude-5-hour -> claude5HourSession
  // etc.
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function validateStrategy(strategy) {
  const valid = ['reject', 'enqueue', 'dequeue-one-at-a-time'];
  return valid.includes(strategy) ? strategy : 'enqueue';
}
```

### 4. Updated canStartCommand Logic

```javascript
async canStartCommand(options = {}) {
  const tool = options.tool || 'claude';
  const reasons = [];
  let oneAtATime = false;
  let rejected = false;
  let rejectReason = null;

  // Check system resources with strategy support
  const resourceCheck = await this.checkSystemResourcesWithStrategy(totalProcessing);

  if (resourceCheck.rejected) {
    rejected = true;
    rejectReason = resourceCheck.rejectReason;
  } else {
    if (!resourceCheck.ok) {
      reasons.push(...resourceCheck.reasons);
    }
    if (resourceCheck.oneAtATime) {
      oneAtATime = true;
    }
  }

  // ... rest of checks

  return {
    canStart: reasons.length === 0 && !rejected,
    rejected,
    rejectReason,
    reason: reasons.length > 0 ? reasons.join('\n') : undefined,
    reasons,
    oneAtATime,
    // ... other properties
  };
}
```

### 5. Updated checkSystemResources

```javascript
async checkSystemResourcesWithStrategy(totalProcessing = 0) {
  const reasons = [];
  let oneAtATime = false;
  let rejected = false;
  let rejectReason = null;

  // Check each resource with its configured strategy
  const checks = [
    { name: 'ram', getValue: getCachedMemoryInfo, config: QUEUE_CONFIG.thresholds.ram },
    { name: 'cpu', getValue: getCachedCpuInfo, config: QUEUE_CONFIG.thresholds.cpu },
    { name: 'disk', getValue: getCachedDiskInfo, config: QUEUE_CONFIG.thresholds.disk },
  ];

  for (const check of checks) {
    const result = await check.getValue(this.verbose);
    if (!result.success) continue;

    const usedRatio = this.getUsageRatio(check.name, result);
    if (usedRatio >= check.config.value) {
      switch (check.config.strategy) {
        case 'reject':
          rejected = true;
          rejectReason = formatWaitingReason(check.name, usedRatio * 100, check.config.value);
          break;

        case 'enqueue':
          reasons.push(formatWaitingReason(check.name, usedRatio * 100, check.config.value));
          break;

        case 'dequeue-one-at-a-time':
          oneAtATime = true;
          if (totalProcessing > 0) {
            reasons.push(formatWaitingReason(check.name, usedRatio * 100, check.config.value) + ' (waiting for current command)');
          }
          break;
      }
      this.recordThrottle(`${check.name}_${check.config.strategy}`);
    }
  }

  return { ok: reasons.length === 0 && !rejected, reasons, oneAtATime, rejected, rejectReason };
}
```

### 6. Handle Rejection in Queue

```javascript
// In telegram-bot.mjs or command handler
async function handleSolveCommand(ctx, url, args) {
  const queue = getSolveQueue();

  // Pre-check for rejection before queuing
  const preCheck = await queue.canStartCommand({ tool: 'claude' });

  if (preCheck.rejected) {
    await ctx.reply(`❌ Cannot process request: ${preCheck.rejectReason}\n\nPlease try again later.`);
    return;
  }

  // Normal enqueue flow
  const item = queue.enqueue({ url, args, ctx /* ... */ });
  // ...
}
```

## Testing Plan

### Unit Tests

1. **Parser Tests**
   - Parse valid links notation
   - Handle malformed input
   - Validate strategy values

2. **Strategy Tests**
   - Test reject behavior
   - Test enqueue behavior
   - Test dequeue-one-at-a-time behavior

3. **Integration Tests**
   - End-to-end queue with different strategies
   - Mixed strategies in single config

### Test Cases

```javascript
// tests/queue-config-strategy.test.mjs

test('parseQueueConfig parses valid lino', () => {
  const config = parseQueueConfig('((disk (90% reject)) (ram (65% enqueue)))');
  assert.equal(config.disk.value, 0.9);
  assert.equal(config.disk.strategy, 'reject');
  assert.equal(config.ram.value, 0.65);
  assert.equal(config.ram.strategy, 'enqueue');
});

test('reject strategy prevents queueing', async () => {
  const queue = new SolveQueue({
    thresholds: {
      disk: { value: 0.1, strategy: 'reject' }, // Low threshold to trigger
    },
  });
  const check = await queue.canStartCommand();
  assert.equal(check.rejected, true);
});

test('enqueue strategy adds to queue', async () => {
  const queue = new SolveQueue({
    thresholds: {
      ram: { value: 0.1, strategy: 'enqueue' },
    },
  });
  const check = await queue.canStartCommand();
  assert.equal(check.rejected, false);
  assert.ok(check.reasons.length > 0);
});

test('dequeue-one-at-a-time allows first command', async () => {
  const queue = new SolveQueue({
    thresholds: {
      disk: { value: 0.1, strategy: 'dequeue-one-at-a-time' },
    },
  });
  const check = await queue.canStartCommand();
  assert.equal(check.canStart, true);
  assert.equal(check.oneAtATime, true);
});
```

## Migration Guide

### For Users

**Before (using old defaults):**

- Disk: One-at-a-time mode when >= 90%

**After (new defaults):**

- Disk: Reject mode when >= 90%

**To restore old behavior:**

```bash
HIVE_MIND_DISK_STRATEGY=dequeue-one-at-a-time
```

Or via links notation:

```bash
HIVE_MIND_QUEUE_CONFIG='((disk (90% dequeue-one-at-a-time)))'
```

### Version Requirements

- Requires Hive Mind version >= 1.21.0 (after this implementation)
- No breaking changes to existing environment variables
- New `HIVE_MIND_QUEUE_CONFIG` environment variable added

## Open Questions

1. **Priority of configuration sources?**
   - Proposal: `HIVE_MIND_QUEUE_CONFIG` > individual env vars > defaults

2. **Runtime reconfiguration?**
   - Currently: Requires restart
   - Future: Could add `/config` command

3. **Backward compatibility period?**
   - Proposal: Log warning when using old disk behavior for 2 versions
