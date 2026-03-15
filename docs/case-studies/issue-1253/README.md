# Case Study: Queue Threshold Configuration Enhancements (Issue #1253)

## Overview

This case study analyzes the requirements for making the Hive Mind solve queue configurable, allowing users to set both thresholds and handling strategies for various resource limits.

**Issue:** [#1253 - Solve queue enhancements](https://github.com/link-assistant/hive-mind/issues/1253)

**Key Requirements:**

1. Make queue thresholds configurable via links notation
2. Support different handling strategies per threshold: `reject`, `enqueue`, `dequeue-one-at-a-time`
3. Change default disk threshold behavior from `dequeue-one-at-a-time` to `reject`

## Current Implementation Analysis

### Existing Queue Configuration (`queue-config.lib.mjs`)

The current system uses environment variables with hardcoded defaults:

```javascript
export const QUEUE_CONFIG = {
  // Resource thresholds (ratios 0.0 - 1.0)
  RAM_THRESHOLD: 0.65, // Blocks (enqueue) if RAM >= 65%
  CPU_THRESHOLD: 0.65, // Blocks (enqueue) if CPU load >= 65%
  DISK_THRESHOLD: 0.9, // One-at-a-time if disk >= 90%

  // API limit thresholds
  CLAUDE_5_HOUR_SESSION_THRESHOLD: 0.65, // One-at-a-time
  CLAUDE_WEEKLY_THRESHOLD: 0.97, // One-at-a-time
  GITHUB_API_THRESHOLD: 0.75, // Blocks parallel commands
};
```

### Current Handling Modes

The system currently implements two handling modes:

1. **Enqueue (Block)** - Used by RAM and CPU thresholds
   - When exceeded, new commands wait in queue
   - Commands cannot start until metric drops below threshold

2. **One-at-a-Time (Dequeue)** - Used by Disk and API limits
   - When exceeded, allows exactly ONE command to run
   - Subsequent commands wait until the running one completes
   - Purpose: To let commands clean up resources

### Missing Handling Mode

3. **Reject** - Not currently implemented
   - Immediately reject the command with an error message
   - No queue waiting, immediate feedback to user
   - Suitable for unrecoverable situations (e.g., disk full + server restart = lost queue)

## Requirements Analysis

### Proposed Configuration Format (Links Notation)

The issue proposes using links notation for configuration:

```lino
(
   (disk (90% reject))
   (ram (65% enqueue))
)
```

This format aligns with the `links-notation` npm package already used in the codebase (via `lino.lib.mjs`).

### Threshold Configuration Structure

Each threshold needs:

1. **Resource Name** - Identifier for the metric (disk, ram, cpu, etc.)
2. **Threshold Value** - Percentage (0-100) when action is triggered
3. **Handling Strategy** - What to do when threshold is exceeded: `reject`, `enqueue`, `dequeue-one-at-a-time`

### Default Behavior Changes

Per the issue, the disk threshold should default to `reject` instead of `dequeue-one-at-a-time` because:

- Queue is stored in RAM (in-memory)
- Server restart clears the queue
- When disk is full, server often restarts
- Therefore, keeping items in queue when disk is full is counterproductive

## Technical Research

### Queue Management Patterns (Industry Standards)

From research on queue management patterns:

1. **Rejection Pattern**
   - Immediate error response
   - No resource consumption
   - Commonly used when: queue is full, system overloaded, unrecoverable state
   - Sources: [Queue Overflow and Underflow](https://csbranch.com/index.php/2024/08/29/queue-overflow-and-underflow/)

2. **Backpressure Pattern**
   - Producer waits until consumer is ready
   - Preserves data at cost of latency
   - Used in Node.js streams
   - Sources: [Node.js Backpressuring in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams)

3. **Drop-Oldest Pattern (TTL)**
   - Removes old messages to make room for new
   - Time-to-live mechanism
   - Sources: [Architecture Weekly - Queuing Patterns](https://www.architecture-weekly.com/p/architecture-weekly-190-queuing-backpressure)

4. **Rate Limiting Strategies**
   - Token Bucket
   - Leaky Bucket
   - Fixed/Sliding Window
   - Sources: [rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible)

### Existing Node.js Libraries

Relevant libraries for queue/rate limiting:

| Library                                                                      | Key Features                   | Relevance                       |
| ---------------------------------------------------------------------------- | ------------------------------ | ------------------------------- |
| [rate-limiter-flexible](https://www.npmjs.com/package/rate-limiter-flexible) | Modular, configurable policies | High - shows pattern for config |
| [qrate](https://github.com/glynnbird/qrate)                                  | Concurrency + rate limiting    | Medium - async.queue based      |
| [backpressure-queue](https://github.com/r-k-b/backpressure-queue)            | Pipes streams to async.queue   | Low - focused on streams        |

### Links Notation Format

The `links-notation` library (already used in codebase) provides:

- S-expression-like syntax with parentheses
- Hierarchical data representation
- Multi-language support (JavaScript, Rust, Python, etc.)
- Sources: [links-notation on npm](https://www.npmjs.com/package/links-notation)

Example parsing:

```javascript
import { Parser } from 'links-notation';
const parser = new Parser();
const links = parser.parse('(disk (90% reject))');
// Returns structured data representing the configuration
```

## Proposed Solutions

### Solution 1: Extend QUEUE_CONFIG with Strategy Field

**Description:** Add a handling strategy field to each threshold configuration.

**Configuration Schema:**

```javascript
// New QUEUE_CONFIG structure
export const QUEUE_CONFIG = {
  thresholds: {
    disk: {
      value: 0.9,
      strategy: 'reject', // 'reject' | 'enqueue' | 'dequeue-one-at-a-time'
    },
    ram: {
      value: 0.65,
      strategy: 'enqueue',
    },
    cpu: {
      value: 0.65,
      strategy: 'enqueue',
    },
    // ... API thresholds
  },
  // Timing configs remain the same
};
```

**Links Notation Parsing:**

```lino
(queue-config
  (disk (90% reject))
  (ram (65% enqueue))
  (cpu (65% enqueue))
  (claude-5-hour-session (65% dequeue-one-at-a-time))
  (claude-weekly (97% dequeue-one-at-a-time))
  (github-api (75% enqueue))
)
```

**Pros:**

- Unified configuration format
- Easy to understand and extend
- Aligns with existing lino usage

**Cons:**

- Requires parsing logic for percentage + strategy
- Breaking change to existing config structure

### Solution 2: Environment Variable Pairs

**Description:** Add strategy environment variables alongside threshold values.

**Configuration:**

```bash
HIVE_MIND_DISK_THRESHOLD=0.9
HIVE_MIND_DISK_STRATEGY=reject  # New

HIVE_MIND_RAM_THRESHOLD=0.65
HIVE_MIND_RAM_STRATEGY=enqueue  # New
```

**Pros:**

- Backwards compatible
- Simple to implement
- No new dependencies

**Cons:**

- Doubles the number of environment variables
- Not as elegant as single links notation config

### Solution 3: Links Notation via Single Environment Variable

**Description:** Use one environment variable with full links notation configuration.

**Configuration:**

```bash
HIVE_MIND_QUEUE_CONFIG='(
  (disk (90% reject))
  (ram (65% enqueue))
  (cpu (65% enqueue))
)'
```

**Pros:**

- Single configuration source
- Uses existing lino library
- Matches issue requirement exactly

**Cons:**

- More complex parsing
- Multi-line env vars can be tricky

### Recommended Solution: Hybrid Approach

Combine Solutions 1 and 3:

1. **Environment Variable** (`HIVE_MIND_QUEUE_CONFIG`) accepts links notation
2. **Fallback** to individual env vars for backwards compatibility
3. **Internal Config** uses structured object format

**Implementation Steps:**

1. Create `parseQueueConfig(linoString)` function
2. Update `QUEUE_CONFIG` to include strategy
3. Add `reject` handling mode to `SolveQueue.canStartCommand()`
4. Update `checkSystemResources()` and `checkApiLimits()` to use strategy
5. Change disk default from `dequeue-one-at-a-time` to `reject`

## Implementation Plan

### Phase 1: Add Strategy Field (No Breaking Changes)

1. Extend `QUEUE_CONFIG` with strategy defaults
2. Add `reject` handling mode to queue logic
3. Change disk default to `reject`

### Phase 2: Links Notation Parser

1. Create `parseQueueThreshold()` function
2. Add `HIVE_MIND_QUEUE_CONFIG` environment variable
3. Update `queue-config.lib.mjs` to parse lino

### Phase 3: Documentation and Testing

1. Add comprehensive tests
2. Update README with configuration examples
3. Add CONFIGURATION.md section for queue settings

## Impact Analysis

### Breaking Changes

- **Disk behavior change**: Default switches from `dequeue-one-at-a-time` to `reject`
  - Mitigation: Users can explicitly set `(disk (90% dequeue-one-at-a-time))` to restore old behavior

### Backwards Compatibility

- Existing env vars will continue to work
- New format is additive, not replacing

### Testing Requirements

1. Unit tests for links notation parsing
2. Integration tests for each strategy mode
3. Edge case tests (invalid config, missing values)

## References

### Internal Files

- `src/queue-config.lib.mjs` - Current queue configuration
- `src/telegram-solve-queue.lib.mjs` - Queue implementation
- `src/limits.lib.mjs` - Limit checking and display
- `src/lino.lib.mjs` - Links notation parser wrapper
- `tests/queue-config.test.mjs` - Existing queue config tests

### External Resources

- [links-notation npm package](https://www.npmjs.com/package/links-notation)
- [links-notation GitHub repository](https://github.com/link-foundation/links-notation)
- [Node.js Backpressuring in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams)
- [rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible)
- [Queue Data Structure Interview Questions](https://github.com/Devinterview-io/queue-data-structure-interview-questions)

## Conclusion

The proposed queue configuration enhancements require:

1. Adding a new `reject` handling strategy
2. Implementing links notation parsing for queue configuration
3. Changing disk threshold default behavior

The recommended hybrid approach maintains backwards compatibility while enabling the flexible configuration requested in the issue. The `links-notation` library already available in the codebase provides the parsing capability needed for the new configuration format.
