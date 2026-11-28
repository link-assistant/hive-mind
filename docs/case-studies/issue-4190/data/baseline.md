# Repository baseline for issue #4190

The source observations are from [main commit 0c70286b9](https://github.com/link-assistant/hive-mind/tree/0c70286b991d699a1822184df9344559d4ea50b7). GitHub listed no issue comments, sub-issues, or initial PR reviews when the work started. The values below were searched in runtime source, tests, configuration, and deployment settings. Historical examples in the changelog and case studies describe their original releases.

## Admission inventory

| Metric           | Old default | Observed input                                 | Default response when the check triggers        |
| ---------------- | ----------- | ---------------------------------------------- | ----------------------------------------------- |
| RAM              | 65%         | Used memory as a share of measured total       | Enqueue                                         |
| CPU              | 65%         | Five-minute load per logical CPU               | Enqueue                                         |
| Disk             | 65%         | Used space on the working-directory filesystem | Enqueue                                         |
| Claude five-hour | 65%         | Provider current-session utilization           | Run one Claude task at a time                   |
| Claude weekly    | 97%         | Provider all-model weekly utilization          | Run one Claude task at a time                   |
| Codex five-hour  | 65%         | Provider current-session utilization           | Run one Codex task at a time                    |
| Codex weekly     | 97%         | Provider weekly utilization                    | Run one Codex task at a time                    |
| GitHub API       | 50%         | Used requests divided by primary core quota    | Enqueue when the requested tool has active work |

Source paths at the baseline are `src/queue-config.lib.mjs`, `src/telegram-solve-queue.throttling.lib.mjs`, and `src/limits.lib.mjs`. Structured overrides take priority over per-metric environment variables. The three admission strategies are `enqueue`, `reject`, and `dequeue-one-at-a-time`. A lower numerical threshold applies the selected strategy sooner.

## Nearby settings reviewed

| Value                              | Source and role                                       | Reason to retain the setting                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker CPU penalty release, 65%    | `docker-cpu-penalty.lib.mjs`, fraction of a task cap  | #2801 specifies recovery below 1.3 cores over a 15-minute window for the default two-core cap. A lower point would prolong the cap for already-running tasks. |
| Telegram 429 attribution, 50%      | `telegram-rate-limit.lib.mjs`, plausibility score     | It chooses which observed bucket likely caused a response after a 429. Raising it would discard some attribution evidence.                                    |
| Auto-resume context cutoff, 50%    | `auto-resume-uncommitted.lib.mjs`, usable context     | The cutoff avoids resuming an already context-heavy session. Raising it would reuse more of a depleted context budget.                                        |
| Gemini compaction estimate, 50%    | `pricing-tier.lib.mjs`, vendor setting estimate       | The local fallback describes the provider's compaction configuration and drives estimates. It needs to track the vendor default.                              |
| Helm CPU utilization target, 80%   | `helm/hive-mind/values.yaml`, optional autoscaler     | The target controls replica count and uses pod CPU requests as its basis. The Helm autoscaler is disabled by default.                                         |
| Minimum free disk, 10,240 MB       | `config.lib.mjs`, absolute solve preflight floor      | Absolute free space protects workloads on small volumes even when the relative used-space threshold has room.                                                 |
| Global start spacing, 10 minutes   | `queue-config.lib.mjs`, minimum time between starts   | The cooldown gives measured usage time to settle following task startup.                                                                                      |
| Merge and interactive queue counts | `config.lib.mjs`, `bidirectional-interactive.lib.mjs` | These limits count work items and use no resource-capacity denominator.                                                                                       |
