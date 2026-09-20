# Research Sources: Progress Bar Threshold Visualization

## Online Resources

### Progress Bar Design Patterns

1. **Progress Bar Design Best Practices** - UX Planet
   - URL: https://uxplanet.org/progress-bar-design-best-practices-526f4d0a3c30
   - Key insight: Determinate progress bars provide better user experience with clear visual indication of progress
   - Relevant for: Understanding UX principles for progress visualization

2. **Progress Trackers and Indicators** - UserGuiding
   - URL: https://userguiding.com/blog/progress-trackers-and-indicators
   - Key insight: Keep previous, current and next steps visually distinct; give fixed position for tracker
   - Relevant for: Multi-zone visualization approaches

3. **Status Indicator Pattern** - Carbon Design System
   - URL: https://carbondesignsystem.com/patterns/status-indicator-pattern/
   - Key insight: Color palette for status - Red (danger), Orange (serious warning), Yellow (regular warning), Green (success), Blue (info)
   - Relevant for: Zone coloring in threshold visualization

4. **Progress Indicators** - Material Design 3
   - URL: https://m3.material.io/components/progress-indicators/specs
   - Key insight: Accessibility considerations and specification for progress indicators
   - Relevant for: Ensuring accessibility in threshold markers

### CLI Progress Bar Libraries

5. **cli-progress** - npm package
   - URL: https://www.npmjs.com/package/cli-progress
   - Key features: Multi-bar support, custom formatters, barGlue option for colorization
   - Relevant for: Implementation reference for customizable bars

6. **ascii-progress** - GitHub
   - URL: https://github.com/bubkoo/ascii-progress
   - Key features: ASCII-based progress bars for terminal
   - Relevant for: Character-based progress visualization

7. **Make better CLI progress bars with Unicode** - Mike42.me
   - URL: https://mike42.me/blog/2018-06-make-better-cli-progress-bars-with-unicode-block-characters
   - Key insight: UTF-8 support is now ubiquitous, allowing rich Unicode progress bars
   - Relevant for: Unicode character selection

8. **Unicode Progress Bars** - Interactive Tool
   - URL: https://changaco.oy.lc/unicode-progress-bars/
   - Key features: Lists all Unicode block characters for progress bars
   - Character sets documented:
     - Eighths block: ▁▂▃▄▅▆▇█
     - Braille patterns: ⣀⣄⣤⣦⣶⣷⣿
     - Circles: ○◔◐◕⬤
     - Squares: □◱◧▣■
     - Shade blocks: ░▒▓█ (used in current implementation)

### Framework Progress Components

9. **Bootstrap Progress Bars** - W3Schools/Bootstrap
   - URL: https://getbootstrap.com/docs/5.3/components/progress/
   - Key features: Stacked progress bars, multiple segments, color variants
   - Relevant for: Multi-segment visualization inspiration

10. **Progress Bar with Thresholds** - DevExpress
    - URL: https://supportcenter.devexpress.com/ticket/details/t807210/progress-bar-with-thresholds
    - Key insight: Commercial component support for threshold markers
    - Relevant for: Enterprise pattern reference

### Telegram-Specific Considerations

11. **Telegram Monospace Font Issues** - GitHub Issues
    - URLs:
      - https://github.com/telegramdesktop/tdesktop/issues/4323
      - https://github.com/telegramdesktop/tdesktop/issues/7776
      - https://github.com/telegramdesktop/tdesktop/issues/25204
    - Key insight: Telegram's monospace rendering can have inconsistencies with certain Unicode characters
    - Relevant for: Testing character compatibility

12. **Telegram Text Formatting** - SendPulse
    - URL: https://sendpulse.com/blog/telegram-text-formatting
    - Key insight: Triple backticks for monospace code blocks
    - Relevant for: Ensuring proper rendering in Telegram messages

## Internal Codebase References

### Current Implementation

- **Progress bar function**: `src/limits.lib.mjs:631-636`
  - Uses `▓` (U+2593) for filled and `░` (U+2591) for empty
  - 30 character total width
  - No threshold visualization

- **Queue thresholds**: `src/telegram-solve-queue.lib.mjs:34-58`
  - RAM_THRESHOLD: 0.65
  - CPU_THRESHOLD: 0.65
  - DISK_THRESHOLD: 0.90
  - CLAUDE_5_HOUR_SESSION_THRESHOLD: 0.65
  - CLAUDE_WEEKLY_THRESHOLD: 0.97
  - GITHUB_API_THRESHOLD: 0.75

### Related Case Studies

- **Issue #1133**: Math.floor for percentage display
  - Key change: 100% only appears when exactly 100%
  - Relevant for: Precision in threshold visualization

- **Issue #1078**: Queue stuck at CPU threshold
  - Key insight: Cached values can cause incorrect threshold decisions
  - Relevant for: Understanding threshold impact on user experience

- **Issue #1137**: CPU load average decisions
  - Key change: Use 5-minute load average instead of 1-minute
  - Relevant for: Understanding threshold calculation context

### Test Files

- **limits-display.test.mjs**: `tests/limits-display.test.mjs`
  - Tests: getProgressBar, calculateTimePassedPercentage, formatUsageMessage
  - Relevant for: Adding threshold visualization tests

- **test-limits-display.mjs**: `experiments/test-limits-display.mjs`
  - Manual testing script for /limits output formatting
  - Relevant for: Visual verification of changes

## Unicode Characters Reference

### Currently Used

| Character | Unicode | Name        |
| --------- | ------- | ----------- |
| ▓         | U+2593  | Dark shade  |
| ░         | U+2591  | Light shade |

### Candidates for Threshold Markers

| Character | Unicode | Name                                    | Notes                       |
| --------- | ------- | --------------------------------------- | --------------------------- |
| │         | U+2502  | Box drawings light vertical             | Recommended - clear divider |
| ┃         | U+2503  | Box drawings heavy vertical             | Bold alternative            |
| ┆         | U+2506  | Box drawings light triple dash vertical | Dashed alternative          |
| ║         | U+2551  | Box drawings double vertical            | Double line                 |
| ▏         | U+258F  | Left one eighth block                   | Thin marker                 |
| ❘         | U+2758  | Light vertical bar                      | Thin line                   |
| ⎸         | U+23B8  | Left vertical box line                  | Math bracket                |

### Zone Differentiation Characters

| Character | Unicode | Name         | Suggested Use         |
| --------- | ------- | ------------ | --------------------- |
| ░         | U+2591  | Light shade  | Safe zone (empty)     |
| ▒         | U+2592  | Medium shade | Warning zone (empty)  |
| ▓         | U+2593  | Dark shade   | Safe zone (filled)    |
| █         | U+2588  | Full block   | Warning zone (filled) |

### Status Indicators

| Character | Name          | Suggested Use   |
| --------- | ------------- | --------------- |
| ⚠️        | Warning sign  | Above threshold |
| ✅        | Check mark    | Below threshold |
| ❌        | Cross mark    | Blocked state   |
| 🔴        | Red circle    | Critical        |
| 🟡        | Yellow circle | Warning         |
| 🟢        | Green circle  | OK              |

## Search Queries Used

1. "progress bar with threshold markers visualization UI design patterns 2026"
2. "text progress bar threshold indicator terminal CLI ASCII 2026"
3. "progress bar color zones threshold warning critical levels UI visualization"
4. "npm cli-progress multi bar threshold marker custom format"
5. "Telegram monospace font progress bar ASCII art rendering"

## Date of Research

Research conducted: February 9, 2026
