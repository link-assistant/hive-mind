import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { summarizeGitHubCompareFailure } from './solve.repository-recovery-message.lib.mjs';

const resultText = result => `${result?.stderr?.toString?.() || ''}${result?.stdout?.toString?.() || ''}`.trim();
const resultStdout = result => result?.stdout?.toString?.().trim() || '';
const shortSha = sha => String(sha || '').slice(0, 12);

const branchLabel = branch => {
  const subject = branch.subject ? ` ${branch.subject}` : '';
  return `${branch.ref} (${branch.uniqueCommitCount} commit(s), ${shortSha(branch.sha)}${subject})`;
};

export function buildReplacementBranchSafetyDescription({ uniqueBranches = [], branchCount = 0, failureOutput = '' } = {}) {
  if (failureOutput) {
    return `Local Git branch reachability check failed (${summarizeGitHubCompareFailure(failureOutput)}), so Hive Mind could not prove all replacement repository branches are preserved upstream.`;
  }

  if (uniqueBranches.length > 0) {
    const examples = uniqueBranches.slice(0, 3).map(branchLabel).join('; ');
    const remaining = uniqueBranches.length > 3 ? `; and ${uniqueBranches.length - 3} more` : '';
    return `Local Git branch reachability found ${uniqueBranches.length} replacement branch tip(s) with commits not reachable from upstream branches or PR refs: ${examples}${remaining}.`;
  }

  return `Local Git branch reachability found all ${branchCount} replacement branch tip(s) reachable from upstream branches or PR refs.`;
}

async function runStep(commandPromise, failurePrefix) {
  const result = await commandPromise;
  if (result.code !== 0) {
    return {
      ok: false,
      output: `${failurePrefix}: ${resultText(result) || `exit ${result.code}`}`,
    };
  }
  return { ok: true, result };
}

const parseReplacementRefs = output =>
  String(output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [ref, sha] = line.split(/\s+/, 2);
      return { ref, sha };
    })
    .filter(item => item.ref && item.sha);

/**
 * Verify that deleting a non-fork replacement repository will not remove branch
 * tips that are absent from the upstream repository. This is intentionally used
 * only in the rare fork-replacement recovery path.
 */
export async function checkReplacementRepositoryBranchSafety({ $, owner, repo, existingRepository, tempRoot = os.tmpdir() }) {
  const tempDir = await fs.mkdtemp(path.join(tempRoot, 'hive-mind-fork-replacement-'));

  try {
    const init = await runStep($({ cwd: tempDir })`git init -q 2>&1`, 'git init failed');
    if (!init.ok) {
      return {
        safeToDelete: false,
        branchCount: 0,
        uniqueBranches: [],
        safetyCheckDescription: buildReplacementBranchSafetyDescription({ failureOutput: init.output }),
      };
    }

    const upstreamUrl = `https://github.com/${owner}/${repo}.git`;
    const replacementUrl = `https://github.com/${existingRepository}.git`;

    const upstreamFetch = await runStep($({ cwd: tempDir })`git fetch --filter=blob:none ${upstreamUrl} '+refs/heads/*:refs/remotes/upstream/*' '+refs/pull/*/head:refs/remotes/upstream-pr/*' 2>&1`, 'upstream fetch failed');
    if (!upstreamFetch.ok) {
      return {
        safeToDelete: false,
        branchCount: 0,
        uniqueBranches: [],
        safetyCheckDescription: buildReplacementBranchSafetyDescription({ failureOutput: upstreamFetch.output }),
      };
    }

    const replacementFetch = await runStep($({ cwd: tempDir })`git fetch --filter=blob:none ${replacementUrl} '+refs/heads/*:refs/remotes/replacement/*' 2>&1`, 'replacement fetch failed');
    if (!replacementFetch.ok) {
      return {
        safeToDelete: false,
        branchCount: 0,
        uniqueBranches: [],
        safetyCheckDescription: buildReplacementBranchSafetyDescription({ failureOutput: replacementFetch.output }),
      };
    }

    const refsResult = await runStep($({ cwd: tempDir })`git for-each-ref --format='%(refname:short) %(objectname)' refs/remotes/replacement 2>&1`, 'replacement ref listing failed');
    if (!refsResult.ok) {
      return {
        safeToDelete: false,
        branchCount: 0,
        uniqueBranches: [],
        safetyCheckDescription: buildReplacementBranchSafetyDescription({ failureOutput: refsResult.output }),
      };
    }

    const replacementRefs = parseReplacementRefs(resultStdout(refsResult.result));
    const uniqueBranches = [];

    for (const { ref, sha } of replacementRefs) {
      const countResult = await runStep($({ cwd: tempDir })`git rev-list --count ${ref} --not --remotes=upstream --remotes=upstream-pr 2>&1`, `unique commit count failed for ${ref}`);
      if (!countResult.ok) {
        return {
          safeToDelete: false,
          branchCount: replacementRefs.length,
          uniqueBranches,
          safetyCheckDescription: buildReplacementBranchSafetyDescription({ failureOutput: countResult.output }),
        };
      }

      const uniqueCommitCount = Number.parseInt(resultStdout(countResult.result), 10);
      if (!Number.isFinite(uniqueCommitCount)) {
        return {
          safeToDelete: false,
          branchCount: replacementRefs.length,
          uniqueBranches,
          safetyCheckDescription: buildReplacementBranchSafetyDescription({ failureOutput: `invalid unique commit count for ${ref}: ${resultStdout(countResult.result)}` }),
        };
      }

      if (uniqueCommitCount > 0) {
        const subjectResult = await $({ cwd: tempDir })`git log -1 --format=%s ${ref} 2>&1`;
        uniqueBranches.push({
          ref: ref.replace(/^replacement\//, ''),
          sha,
          uniqueCommitCount,
          subject: subjectResult.code === 0 ? resultStdout(subjectResult) : '',
        });
      }
    }

    return {
      safeToDelete: uniqueBranches.length === 0,
      branchCount: replacementRefs.length,
      uniqueBranches,
      safetyCheckDescription: buildReplacementBranchSafetyDescription({ uniqueBranches, branchCount: replacementRefs.length }),
    };
  } catch (error) {
    return {
      safeToDelete: false,
      branchCount: 0,
      uniqueBranches: [],
      safetyCheckDescription: buildReplacementBranchSafetyDescription({ failureOutput: error.message }),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
