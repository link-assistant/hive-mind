#!/usr/bin/env node

/**
 * Issue #2132: single source of truth for *where* context/cost budget statistics
 * may be published.
 *
 * Rules encoded here:
 *   1. Budget stats belong to the working session **log** comment only. The
 *      "Working session summary" comment reports what the AI did, never how many
 *      tokens or dollars it took (see `attachSolutionSummary`).
 *   2. `--attach-logs` disabled ⇒ no log comment ⇒ no published budget stats.
 *      `--tokens-budget-stats` alone is not enough to publish them to GitHub; it
 *      only controls the local terminal rendering of the same facts.
 *
 * Keeping this in one module means the top-level run, the watch loop and the
 * auto-restart-until-mergeable loop cannot drift apart again.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2132
 */

/** Whether `--attach-logs` is enabled (both camelCase and kebab-case forms). */
export const isAttachLogsEnabled = argv => !!(argv && (argv.attachLogs || argv['attach-logs']));

/** Whether `--tokens-budget-stats` is enabled (both camelCase and kebab-case forms). */
export const isTokensBudgetStatsEnabled = argv => !!(argv && (argv.tokensBudgetStats || argv['tokens-budget-stats']));

/**
 * Whether context/cost budget statistics may be published to GitHub for this run.
 * Requires BOTH `--tokens-budget-stats` and `--attach-logs`.
 */
export const shouldPublishBudgetStats = argv => isTokensBudgetStatsEnabled(argv) && isAttachLogsEnabled(argv);
