#!/usr/bin/env node

import process from 'node:process';

/**
 * Read-only live probe for issue #2286's `/fix --ci-cd` run collector.
 *
 * Usage:
 *   node experiments/issue-2286/live-ci-collector.mjs [owner/repository]
 */

import { prepareCiCdIssue } from '../../src/fix.ci-cd-issue.lib.mjs';
import { parseFixRepository } from '../../src/fix.ci-cd.lib.mjs';

const target = process.argv[2] || 'link-assistant/hive-mind';
const repository = parseFixRepository(target);

if (!repository) {
  globalThis.console.error(`Invalid repository: ${target}`);
  process.exitCode = 2;
} else {
  const prepared = await prepareCiCdIssue({ repository, log: globalThis.console.log });
  globalThis.console.log(
    JSON.stringify(
      {
        repository: prepared.repository.fullName,
        defaultBranch: prepared.defaultBranch,
        latestCommit: prepared.commit?.sha,
        runsSource: prepared.runsSource,
        fetchedRuns: prepared.fetchedRuns,
        duplicateRuns: prepared.duplicateRuns,
        inactiveWorkflowRuns: prepared.inactiveWorkflowRuns,
        runs: prepared.runs,
      },
      null,
      2
    )
  );
}
