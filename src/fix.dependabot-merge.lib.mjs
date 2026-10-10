/**
 * Dependabot auto-merge step of `/fix --update-all-dependencies` (issue #2885).
 *
 * Before the "update every dependency" issue is created, open Dependabot
 * version bump PRs are merged through the same sequential, CI-gated merge
 * queue that `/merge <repo> --dependabot` uses. Whatever Dependabot already
 * proposed and CI accepted lands first, and the generated issue only has to
 * cover what is left. The step is on by default for this mode and turned off
 * with `--no-auto-merge-dependabot`.
 *
 * It is best-effort: a failure here is reported and never blocks the issue or
 * the `/solve` handoff.
 */

import { FIX_MODE_UPDATE_ALL_DEPENDENCIES } from './fix.args.lib.mjs';

/**
 * Whether `/fix` should merge Dependabot PRs for the parsed arguments: an
 * explicit `--[no-]auto-merge-dependabot` wins, otherwise it is on for
 * `--update-all-dependencies` only.
 */
export function shouldAutoMergeDependabot(parsed) {
  if (typeof parsed?.autoMergeDependabot === 'boolean') return parsed.autoMergeDependabot;
  return parsed?.mode === FIX_MODE_UPDATE_ALL_DEPENDENCIES;
}

function describePr(pr) {
  return { number: pr.number, title: pr.title, url: pr.url };
}

/**
 * Merge open Dependabot PRs of `repository` sequentially, waiting for CI.
 *
 * @param {Object} params
 * @param {{owner: string, repo: string, fullName: string}} params.repository
 * @param {boolean} [params.dryRun=false] - Only list the PRs that would be merged
 * @param {boolean} [params.verbose=false]
 * @param {Function} [params.log]
 * @param {Function} [params.createProcessor] - Injectable for tests; defaults to a `MergeQueueProcessor`
 * @param {Function} [params.fetchDependabotPullRequests] - Injectable for tests (dry run)
 * @returns {Promise<{dryRun: boolean, found: number, merged: Array, unmerged: Array, error: string|null}>}
 */
export async function runDependabotAutoMerge({ repository, dryRun = false, verbose = false, log = message => console.log(message), createProcessor = null, fetchDependabotPullRequests = null }) {
  const summary = { dryRun, found: 0, merged: [], unmerged: [], error: null };
  const { owner, repo } = repository;
  try {
    if (dryRun) {
      const fetchPrs = fetchDependabotPullRequests || (await import('./github-merge-dependabot.lib.mjs')).fetchDependabotPullRequests;
      const prs = await fetchPrs(owner, repo, verbose);
      summary.found = prs.length;
      summary.unmerged = prs.map(pr => ({ ...describePr(pr), reason: 'dry run' }));
      log(`🤖 Dependabot auto-merge (dry run): would merge ${prs.length} open Dependabot PR(s)${prs.length ? ':' : '.'}`);
      for (const pr of prs) log(`   #${pr.number} ${pr.title}`);
      return summary;
    }

    const create =
      createProcessor ||
      (async options => {
        const { MergeQueueProcessor } = await import('./telegram-merge-queue.lib.mjs');
        return new MergeQueueProcessor(options);
      });
    const processor = await create({ owner, repo, verbose, dependabot: true, includeReadyPRs: false });
    const init = await processor.initialize();
    if (!init.success) throw new Error(init.error || 'merge queue initialization failed');
    if (init.message) {
      log(`🤖 Dependabot auto-merge: ${init.message}.`);
      return summary;
    }
    summary.found = init.count;
    log(`🤖 Dependabot auto-merge: merging ${init.count} open Dependabot PR(s) one by one, waiting for CI after each merge...`);
    const result = await processor.run();
    for (const item of processor.items) {
      if (item.status === 'merged') {
        summary.merged.push(describePr(item.pr));
        log(`   ✅ Merged #${item.pr.number} ${item.pr.title}`);
      } else {
        const reason = item.error || (item.status === 'pending' ? 'not processed' : item.status);
        summary.unmerged.push({ ...describePr(item.pr), reason });
        log(`   ⏭️  Not merged #${item.pr.number} ${item.pr.title} (${reason})`);
      }
    }
    if (!result.success && result.error) summary.error = result.error;
  } catch (error) {
    summary.error = error.message || String(error);
  }
  if (summary.error) {
    log(`⚠️  Dependabot auto-merge did not finish: ${summary.error}. Continuing with the dependency update issue.`);
  }
  return summary;
}

/**
 * Markdown lines for the generated issue's context block, so the solving
 * agent knows which Dependabot PRs already landed and which are still open
 * (and will be superseded by its own update).
 */
export function buildDependabotMergeContextLines(summary) {
  if (!summary || summary.dryRun) return [];
  const lines = [`- **Dependabot PRs merged by \`/fix\`:** ${summary.merged.length}${summary.merged.length ? ` (${summary.merged.map(pr => `#${pr.number}`).join(', ')})` : ''}`];
  if (summary.unmerged.length) {
    lines.push(`- **Dependabot PRs left open:** ${summary.unmerged.map(pr => `#${pr.number} (${pr.reason})`).join(', ')}. Cover these updates in this issue's pull request as well.`);
  }
  if (summary.error) lines.push(`- **Dependabot auto-merge stopped early:** ${summary.error}`);
  return lines;
}
