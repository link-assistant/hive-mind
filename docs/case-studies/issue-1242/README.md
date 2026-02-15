# Case Study: Progress Bar Threshold Visualization (Issue #1242)

## Overview

This case study analyzes the enhancement request to visually display queue thresholds within the `/limits` command progress bars. The goal is to help users understand not just current usage levels but also the thresholds at which system behavior changes (e.g., one-at-a-time mode activation, command blocking).

## Problem Statement

Currently, the `/limits` command shows progress bars with usage percentages, but users cannot easily see:

1. **Where thresholds are located** - At what percentage does the queue behavior change?
2. **How close to thresholds** - Are they approaching a behavior change point?
3. **Threshold context** - What happens when a threshold is crossed?

### Current Display Example

```
CPU
▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░ 25% used
0.04/6 CPU cores used

RAM
▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░ 27% used
3.2/11.7 GB used

Claude 5 hour session
▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░ 22% used
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░ 80% passed
Resets in 1h 34m (Dec 3, 6:59pm UTC)
```

Users see usage but cannot tell:

- CPU threshold is at 65% (not visible)
- RAM threshold is at 65% (not visible)
- Claude 5-hour session threshold is at 65% (not visible)

## Queue Thresholds Analysis

From `src/telegram-solve-queue.lib.mjs`, the following thresholds control queue behavior:

### System Resource Thresholds

| Resource | Threshold  | Behavior                                                        |
| -------- | ---------- | --------------------------------------------------------------- |
| RAM      | 65% (0.65) | **Blocks** new commands when usage >= 65%                       |
| CPU      | 65% (0.65) | **Blocks** new commands when 5-min load avg >= 65% of CPU count |
| Disk     | 90% (0.90) | **One-at-a-time** mode when usage >= 90%                        |

### API Limit Thresholds

| Limit                 | Threshold  | Behavior                                        |
| --------------------- | ---------- | ----------------------------------------------- |
| Claude 5-hour session | 65% (0.65) | **One-at-a-time** mode when usage >= 65%        |
| Claude weekly         | 97% (0.97) | **One-at-a-time** mode when usage >= 97%        |
| GitHub API            | 75% (0.75) | **Blocks** parallel claude commands when >= 75% |

### Threshold Impact

When thresholds are crossed:

- **Blocks**: New commands cannot start until usage drops below threshold
- **One-at-a-time**: Only one command runs at a time; others queue and wait

## Current Implementation Analysis

### Progress Bar Function

From `src/limits.lib.mjs:631-636`:

```javascript
export function getProgressBar(percentage) {
  const totalBlocks = 30;
  const filledBlocks = Math.round((percentage / 100) * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  return '\u2593'.repeat(filledBlocks) + '\u2591'.repeat(emptyBlocks);
}
```

**Characteristics:**

- Uses 30 character blocks
- Uses Unicode shade characters: `▓` (filled) and `░` (empty)
- No threshold visualization
- Monospace font compatible (important for Telegram)

### Unicode Characters Available

| Character | Code Point  | Description         |
| --------- | ----------- | ------------------- |
| ░         | U+2591      | Light shade (empty) |
| ▒         | U+2592      | Medium shade        |
| ▓         | U+2593      | Dark shade (filled) |
| █         | U+2588      | Full block          |
| ▏▎▍▌▋▊▉   | U+258F-2589 | Fractional blocks   |
| ▁▂▃▄▅▆▇   | U+2581-2587 | Lower blocks        |

## Research: Threshold Visualization Techniques

### 1. Marker-Based Approaches

**Inline Threshold Marker:**

```
▓▓▓▓▓▓▓░░░░░░░░░░░░│░░░░░░░░░░ 25% (threshold: 65%)
                    ↑ threshold at 65%
```

**Multiple Markers:**

```
▓▓▓▓▓▓▓░░░░░░░░░░░░|░░░░░░░░░|░ 25% used
                   65%       90%
```

### 2. Zone-Based Approaches

**Color Zones (with ANSI colors):**

```
[████████████░░░░░░░░░░░░░░░░░░] 40% - Safe Zone
[█████████████████████░░░░░░░░░] 70% - Warning Zone
[████████████████████████████░░] 93% - Critical Zone
```

**Character Differentiation:**

```
▓▓▓▓▓▓▓░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒░ 25% (warning zone at 65%+)
        safe        warning   critical
```

### 3. Dual-Line Approaches

**Threshold Line Below:**

```
▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░ 25% used
───────────────────┬──────────  threshold: 65%
```

**Legend Line:**

```
▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░ 25% used
0%─────────────────65%──────100%
```

### 4. Compact Threshold Notation

**Inline Text:**

```
▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░ 25% used [threshold: 65%]
```

**Bracketed Format:**

```
▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░ 25/65% used
```

## Proposed Solutions

### Solution 1: Inline Threshold Marker (Recommended)

Add a visible marker character at the threshold position within the progress bar.

**Implementation:**

```javascript
export function getProgressBarWithThreshold(percentage, thresholdPercentage = null) {
  const totalBlocks = 30;
  const filledBlocks = Math.round((percentage / 100) * totalBlocks);

  if (thresholdPercentage === null) {
    // No threshold - original behavior
    const emptyBlocks = totalBlocks - filledBlocks;
    return '\u2593'.repeat(filledBlocks) + '\u2591'.repeat(emptyBlocks);
  }

  const thresholdPos = Math.round((thresholdPercentage / 100) * totalBlocks);
  let bar = '';

  for (let i = 0; i < totalBlocks; i++) {
    if (i === thresholdPos) {
      bar += '│'; // Threshold marker
    } else if (i < filledBlocks) {
      bar += '▓'; // Filled
    } else {
      bar += '░'; // Empty
    }
  }

  return bar;
}
```

**Visual Example:**

```
CPU
▓▓▓▓▓▓▓░░░░░░░░░░░░│░░░░░░░░░░ 25% used (blocks at 65%)
0.04/6 CPU cores used

RAM
▓▓▓▓▓▓▓▓░░░░░░░░░░░│░░░░░░░░░░ 27% used (blocks at 65%)
3.2/11.7 GB used

Disk space
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░│░░░ 76% used (1-at-a-time at 90%)
72.8/95.8 GB used
```

**Pros:**

- Clear visual indicator of threshold position
- Maintains 30-character bar width (marker replaces one block)
- Works in monospace fonts (Telegram)
- Minimal code changes

**Cons:**

- Slightly reduces bar resolution (29 blocks + 1 marker)
- Single threshold per bar only

---

### Solution 2: Dual-Character Zone Differentiation

Use different fill characters for regions above/below threshold.

**Implementation:**

```javascript
export function getProgressBarWithZones(percentage, thresholdPercentage) {
  const totalBlocks = 30;
  const filledBlocks = Math.round((percentage / 100) * totalBlocks);
  const thresholdPos = Math.round((thresholdPercentage / 100) * totalBlocks);

  let bar = '';
  for (let i = 0; i < totalBlocks; i++) {
    if (i < filledBlocks) {
      // Filled: use different char above threshold
      bar += i >= thresholdPos ? '█' : '▓';
    } else {
      // Empty: use different char above threshold
      bar += i >= thresholdPos ? '▒' : '░';
    }
  }

  return bar;
}
```

**Visual Example:**

```
CPU
▓▓▓▓▓▓▓░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒ 25% used
        safe zone   ↑ blocks zone (65%+)

Claude 5 hour session
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓█▒▒▒▒▒▒▒▒▒▒ 70% used
                   ↑ one-at-a-time zone (65%+)
```

**Pros:**

- Visual distinction between safe and threshold zones
- Full 30-block resolution maintained
- No marker character needed

**Cons:**

- Subtle visual difference may be hard to notice
- Requires explanation in legend

---

### Solution 3: Percentage with Threshold Context

Add threshold information in the percentage display, not the bar itself.

**Implementation:**

```javascript
function formatPercentageWithThreshold(percentage, threshold, behavior) {
  if (percentage >= threshold) {
    return `${percentage}% used ⚠️ ${behavior} active`;
  }
  return `${percentage}% used (${behavior} at ${threshold}%)`;
}
```

**Visual Example:**

```
CPU
▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░ 25% used (blocks at 65%)

Claude 5 hour session
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░ 70% used ⚠️ one-at-a-time active
```

**Pros:**

- Clear textual explanation
- No changes to bar rendering
- Can show threshold behavior description

**Cons:**

- Longer text lines
- Less visual and more textual

---

### Solution 4: Legend Line Below Bar

Add a scale/legend line showing threshold positions.

**Implementation:**

```javascript
function getProgressBarWithLegend(percentage, thresholds) {
  const bar = getProgressBar(percentage);
  const legend = buildLegendLine(thresholds);
  return `${bar} ${percentage}% used\n${legend}`;
}

function buildLegendLine(thresholds) {
  // Create a 30-char legend line with threshold markers
  const line = '─'.repeat(30);
  const chars = line.split('');

  for (const [percent, label] of thresholds) {
    const pos = Math.round((percent / 100) * 30);
    chars[pos] = '┬';
  }

  return chars.join('');
}
```

**Visual Example:**

```
CPU
▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░ 25% used
───────────────────┬──────────  ↑ blocks (65%)

Disk space
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░ 76% used
───────────────────────────┬──  ↑ 1-at-a-time (90%)
```

**Pros:**

- Very clear threshold position
- Can show multiple thresholds
- Preserves original bar appearance

**Cons:**

- Takes extra vertical space
- More complex implementation
- May clutter the display

---

### Solution 5: Hybrid Approach (Recommended for Implementation)

Combine inline marker with contextual percentage text.

**Implementation:**

```javascript
export function getProgressBarWithThreshold(percentage, thresholdPercentage = null) {
  const totalBlocks = 30;
  const filledBlocks = Math.round((percentage / 100) * totalBlocks);

  if (thresholdPercentage === null) {
    const emptyBlocks = totalBlocks - filledBlocks;
    return '\u2593'.repeat(filledBlocks) + '\u2591'.repeat(emptyBlocks);
  }

  const thresholdPos = Math.round((thresholdPercentage / 100) * totalBlocks);
  let bar = '';

  for (let i = 0; i < totalBlocks; i++) {
    if (i === thresholdPos) {
      bar += '│';
    } else if (i < filledBlocks) {
      bar += '▓';
    } else {
      bar += '░';
    }
  }

  return bar;
}

export function formatUsageWithThreshold(label, percentage, threshold, thresholdType) {
  const bar = getProgressBarWithThreshold(percentage, threshold);
  const status = percentage >= threshold ? '⚠️' : '';
  return `${label}\n${bar} ${percentage}% ${status}\n`;
}
```

**Visual Example:**

```
Current time: Feb 9, 6:45pm UTC

CPU
▓▓▓▓▓▓▓░░░░░░░░░░░░│░░░░░░░░░░ 25%
0.04/6 CPU cores used

RAM
▓▓▓▓▓▓▓▓░░░░░░░░░░░│░░░░░░░░░░ 27%
3.2/11.7 GB used

Disk space
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░│░░░ 76%
72.8/95.8 GB used

Claude 5 hour session
▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░│░░░░░░░░░░ 45% passed
▓▓▓▓▓▓░░░░░░░░░░░░░│░░░░░░░░░░ 22%
Resets in 1h 34m (Dec 3, 6:59pm UTC)

Current week (all models)
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░│░ 77% passed
▓░░░░░░░░░░░░░░░░░░░░░░░░░░░│░ 3%
Resets in 6d 20h 13m (Dec 10, 5:59pm UTC)

Current week (all models) - above threshold example:
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓ 98% ⚠️
Resets in 2d 5h 10m (Dec 6, 12:00pm UTC)
```

## Existing Libraries and Components

### JavaScript/Node.js Libraries

1. **[cli-progress](https://www.npmjs.com/package/cli-progress)** - Highly customizable CLI progress bars
   - Supports custom formatters
   - Multi-bar support
   - Can be extended for threshold markers

2. **[ascii-progress](https://github.com/bubkoo/ascii-progress)** - ASCII progress bars
   - Simple API
   - Customizable characters

3. **[progress](https://www.npmjs.com/package/progress)** - Classic progress bar
   - Lightweight
   - Template-based formatting

### Unicode Character Resources

- **[Unicode Progress Bars](https://changaco.oy.lc/unicode-progress-bars/)** - Interactive tool showing various Unicode block characters for progress visualization

### Design System References

- **[Carbon Design System - Status Indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/)** - Best practices for color-based status visualization
- **[Material Design - Progress Indicators](https://m3.material.io/components/progress-indicators/specs)** - Accessibility and UX guidelines
- **[Bootstrap Progress Bars](https://getbootstrap.com/docs/5.3/components/progress/)** - Multi-segment and stacked progress bar patterns

## Recommendations

### Phase 1: Quick Win (Inline Marker)

1. Implement `getProgressBarWithThreshold()` function in `limits.lib.mjs`
2. Update `formatUsageMessage()` to pass threshold values for relevant metrics
3. Add unit tests for new function

**Estimated effort:** 2-4 hours

### Phase 2: Enhanced Display

1. Add threshold behavior text (e.g., "blocks at 65%")
2. Add warning emoji when threshold is exceeded
3. Consider color support for terminal output (ANSI codes)

**Estimated effort:** 4-6 hours

### Phase 3: Configuration

1. Make threshold display optional (config flag)
2. Support different visualization styles
3. Add threshold tooltips/help text

**Estimated effort:** 6-8 hours

## Testing Considerations

1. **Visual Testing:** Verify progress bars render correctly in Telegram's monospace code blocks
2. **Edge Cases:** 0%, 100%, exactly at threshold, threshold at 0%, threshold at 100%
3. **Character Alignment:** Ensure marker character doesn't break monospace alignment
4. **Unicode Support:** Test on different platforms/fonts

## References

### Internal

- Issue #1133: Math.floor for percentage display
- Issue #1078: Queue stuck at CPU threshold
- Issue #1137: CPU load average for queue decisions

### External

- [Unicode Progress Bars](https://changaco.oy.lc/unicode-progress-bars/)
- [cli-progress npm](https://www.npmjs.com/package/cli-progress)
- [Carbon Design Status Indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/)
- [Make better CLI progress bars with Unicode](https://mike42.me/blog/2018-06-make-better-cli-progress-bars-with-unicode-block-characters)
- [Progress Bar Design Best Practices](https://uxplanet.org/progress-bar-design-best-practices-526f4d0a3c30)

## Conclusion

The recommended approach is **Solution 5: Hybrid Approach** which combines:

- Inline threshold marker (`│`) for visual positioning
- Optional warning emoji when threshold is exceeded
- Clean, minimal changes to existing code structure

This solution provides clear visual feedback about threshold positions while maintaining compatibility with Telegram's monospace rendering and keeping the implementation straightforward.
