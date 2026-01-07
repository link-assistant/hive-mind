---
'@link-assistant/hive-mind': patch
---

fix(queue): prevent stuck queue due to stale cached resource values

- **Force-refresh cached values when above threshold**: When CPU or RAM cached values exceed
  their thresholds, the queue now fetches fresh values to confirm before blocking. This prevents
  the queue from getting stuck on stale cached values from transient spikes.

- **Reorder reason messages**: "Claude process is already running" is now shown at the end of
  the reasons list instead of the beginning, since it's supplementary information rather than
  the primary blocking reason.

- **Add periodic message updates**: Waiting queue messages now update every minute to show
  current status, giving users visibility into why they're waiting.

- **Add comprehensive unit tests**: New test suite for queue behavior with 27 tests covering
  configuration, status transitions, message updates, throttling, and more.

Fixes #1078
