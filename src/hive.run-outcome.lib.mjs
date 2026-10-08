// A drained queue describes scheduling, not whether any solver completed work.
export const EXIT_CODE_HIVE_NO_WORK = 3;
export const EXIT_CODE_HIVE_INCOMPLETE = 4;
export const HIVE_EXISTING_PRS_HINT = 'To work on issues with existing PRs, use --no-skip-issues-with-prs --auto-continue. Parent issues wait until their sub-issues are closed.';

export class HiveRunReport {
  constructor() {
    this.beginDiscovery();
  }
  beginDiscovery() {
    this.found = 0;
    this.skipped = new Map();
    this.errors = [];
  }
  recordFound(issues) {
    this.found = issues.length;
  }
  recordSkipped(url, reason, pullRequests = []) {
    this.skipped.set(url, { reason, pullRequests });
  }
  recordError(error) {
    this.errors.push(error.message || String(error));
  }
  getOutcome(queue, { waitingIssues = [], dryRun = false } = {}) {
    const stats = queue.getStats();
    const skipped = new Map([...this.skipped, ...queue.skipped]);
    const pending = new Set([...waitingIssues, ...queue.waiting, ...queue.queue, ...queue.processing]).size;
    let exitCode = 0;
    let message = '✅ Hive run finished';
    if (this.errors.length || stats.failed) {
      exitCode = 1;
      message = '❌ Hive run failed';
    } else if (dryRun) {
      message = '🧪 Dry run finished; no issues processed';
    } else if (stats.completed === 0) {
      exitCode = EXIT_CODE_HIVE_NO_WORK;
      message = '⚠️ No issues processed';
    } else if (pending > 0) {
      exitCode = EXIT_CODE_HIVE_INCOMPLETE;
      message = '⚠️ Hive run finished with issues still waiting';
    }
    return { exitCode, message, found: this.found, completed: stats.completed, failed: stats.failed, skipped, pending, errors: [...this.errors] };
  }
  async logSummary(queue, options, log) {
    const outcome = this.getOutcome(queue, options);
    await log(`\n${outcome.message}`);
    await log(`   Found: ${outcome.found}`);
    await log(`   Completed: ${outcome.completed}`);
    await log(`   Failed: ${outcome.failed}`);
    await log(`   Skipped: ${outcome.skipped.size}`);
    await log(`   Waiting: ${outcome.pending}`);
    const reasons = new Map();
    const pullRequests = new Map();
    for (const [url, skip] of outcome.skipped) {
      reasons.set(skip.reason, (reasons.get(skip.reason) || 0) + 1);
      for (const pr of skip.pullRequests || []) {
        if (pr.state !== 'OPEN' || !pr.url) continue;
        if (!pullRequests.has(pr.url)) pullRequests.set(pr.url, new Set());
        pullRequests.get(pr.url).add(url);
      }
    }
    for (const [reason, count] of reasons) await log(`   ⏭️ ${count} skipped: ${reason}`);
    for (const [url, issues] of pullRequests) await log(`   🔗 Existing PR: ${url} (${issues.size} skipped issue(s))`);
    for (const error of outcome.errors) await log(`   ❌ Discovery error: ${error}`, { level: 'error' });
    if (pullRequests.size || reasons.has('existing open pull requests')) await log(`   ${HIVE_EXISTING_PRS_HINT}`);
    await log(`   Discovery details: ${JSON.stringify({ found: outcome.found, skipped: [...outcome.skipped], waiting: outcome.pending, errors: outcome.errors })}`, { verbose: true });
    return outcome;
  }
}
