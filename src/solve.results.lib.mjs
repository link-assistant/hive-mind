#!/usr/bin/env node

// Results processing module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// Use use-m to dynamically import modules for cross-runtime compatibility
// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $: __rawDollar$ } = await use('command-stream');
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry(__rawDollar$);
const path = (await use('path')).default;

// Import shared library functions
const lib = await import('./lib.mjs');
const { log, getLogFile, formatAligned } = lib;

// Import exit handler
import { safeExit } from './exit-handler.lib.mjs';

// Import GitHub-related functions
const githubLib = await import('./github.lib.mjs');
const { sanitizeLogContent, attachLogToGitHub } = githubLib;

// Import continuation functions (session resumption, PR detection)
const autoContinue = await import('./solve.auto-continue.lib.mjs');
const { autoContinueWhenLimitResets } = autoContinue;

// Import Claude-specific command builders
// These are used to generate copy-pasteable Claude CLI resume commands for users
// Pattern: (cd "/tmp/gh-issue-solver-..." && claude --resume <session-id>)
const claudeCommandBuilder = await import('./claude.command-builder.lib.mjs');
export const { buildClaudeResumeCommand, buildClaudeInitialCommand } = claudeCommandBuilder;

/**
 * Build a solve.mjs resume command for tools that do not have a first-party interactive
 * resume CLI flow like Claude Code. This keeps the invocation within hive-mind so the
 * original tool selection and working directory can be preserved.
 *
 * @param {Object} options
 * @param {string} options.issueUrl - The issue URL passed to solve.mjs
 * @param {string} options.sessionId - The session ID to resume
 * @param {string|null} [options.tool] - Tool name (codex, opencode, agent, gemini)
 * @param {string|null} [options.model] - Model name to preserve
 * @param {string|null} [options.fallbackModel] - Explicit fallback model to preserve
 * @param {string|null} [options.tempDir] - Working directory to preserve
 * @param {string} [options.nodePath] - Node binary path
 * @param {string} [options.scriptPath] - solve.mjs path
 * @returns {string}
 */
export const buildSolveResumeCommand = ({ issueUrl, sessionId, tool = null, model = null, fallbackModel = null, tempDir = null, nodePath = process.argv[0], scriptPath = process.argv[1] }) => {
  const shellQuote = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

  const args = [shellQuote(scriptPath), shellQuote(issueUrl), '--resume', shellQuote(sessionId)];

  if (tool && tool !== 'claude') {
    args.push('--tool', shellQuote(tool));
  }

  if (model) {
    args.push('--model', shellQuote(model));
  }

  if (fallbackModel) {
    args.push('--fallback-model', shellQuote(fallbackModel));
  }

  if (tempDir) {
    args.push('--working-directory', shellQuote(tempDir));
  }

  return `${shellQuote(nodePath)} ${args.join(' ')}`;
};

// Import error handling functions
// const errorHandlers = await import('./solve.error-handlers.lib.mjs'); // Not currently used
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

// Import pull request issue-link preservation helpers
const prIssueLinking = await import('./pr-issue-linking.lib.mjs');
const { buildIssueReference, ensureIssueLinkInPullRequestBody } = prIssueLinking;

/**
 * Placeholder patterns used to detect auto-generated PR content that was not updated by the agent.
 * These patterns match the initial WIP PR created by solve.auto-pr.lib.mjs.
 */
export const PR_TITLE_PLACEHOLDER_PREFIX = '[WIP]';

export const PR_BODY_PLACEHOLDER_PATTERNS = ['_Details will be added as the solution draft is developed..._', '**Work in Progress** - The AI assistant is currently analyzing and implementing the solution draft.', '### 🚧 Status'];

/**
 * Check if PR title still contains auto-generated placeholder content
 * @param {string} title - PR title
 * @returns {boolean} - true if title has placeholder content
 */
export const hasPRTitlePlaceholder = title => {
  return title && title.startsWith(PR_TITLE_PLACEHOLDER_PREFIX);
};

/**
 * Check if PR body still contains auto-generated placeholder content
 * @param {string} body - PR body
 * @returns {boolean} - true if body has placeholder content
 */
export const hasPRBodyPlaceholder = body => {
  return body && PR_BODY_PLACEHOLDER_PATTERNS.some(pattern => body.includes(pattern));
};

/**
 * Build a short factual hint for auto-restart when PR title/description was not updated.
 * Uses neutral, fact-stating language (no forcing words).
 * @param {boolean} titleNotUpdated - Whether the PR title still has placeholder
 * @param {boolean} descriptionNotUpdated - Whether the PR description still has placeholder
 * @returns {string[]} - Array of feedback lines to pass as hint to the restarted session
 */
export const buildPRNotUpdatedHint = (titleNotUpdated, descriptionNotUpdated) => {
  const lines = [];
  if (titleNotUpdated && descriptionNotUpdated) {
    lines.push('Pull request title and description were not updated.');
  } else if (titleNotUpdated) {
    lines.push('Pull request title was not updated.');
  } else if (descriptionNotUpdated) {
    lines.push('Pull request description was not updated.');
  }
  return lines;
};

export const REQUIREMENTS_TRACKING_DOCS_DIRECTORY = 'docs/requirements/';

export const normalizeChangedFilePath = filePath => {
  return String(filePath || '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '');
};

export const isRequirementsTrackingDocumentPath = filePath => {
  const normalized = normalizeChangedFilePath(filePath);
  return normalized.startsWith(REQUIREMENTS_TRACKING_DOCS_DIRECTORY) && normalized.endsWith('.md');
};

export const hasRequirementsTrackingDocumentChange = filePaths => {
  return Array.isArray(filePaths) && filePaths.some(isRequirementsTrackingDocumentPath);
};

export const parseChangedFilesOutput = output => {
  return String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
};

export const getPullRequestChangedFiles = async ({ prNumber, owner, repo, command = $, logger = log } = {}) => {
  if (!prNumber || !owner || !repo) {
    return { checked: false, files: [], error: 'missing_pull_request_context' };
  }

  try {
    const diffFilesResult = await command`gh pr diff ${prNumber} --repo ${owner}/${repo} --name-only`;
    if (diffFilesResult.code !== 0) {
      const stderr = diffFilesResult.stderr ? diffFilesResult.stderr.toString().trim() : '';
      if (logger) await logger(`  ⚠️  Could not list pull request files for requirements tracking${stderr ? `: ${stderr}` : ''}`);
      return { checked: false, files: [], error: stderr || 'gh_pr_diff_failed' };
    }

    return {
      checked: true,
      files: parseChangedFilesOutput(diffFilesResult.stdout?.toString()),
      error: null,
    };
  } catch (error) {
    if (logger) await logger(`  ⚠️  Could not list pull request files for requirements tracking: ${error.message}`);
    return { checked: false, files: [], error: error.message };
  }
};

export const buildRequirementsDocsNotUpdatedHint = () => ['Requirements tracking is enabled, but this pull request does not modify docs/requirements/*.md.', 'Read docs/requirements/README.md if it exists, then create or update docs/requirements/*.md to reflect repository requirements from the issue and pull request discussion.', 'If no repository requirement changed, update the pull request description with that justification.'];

/**
 * Ensure an existing pull request body contains a GitHub closing keyword for the issue.
 *
 * @param {Object} options
 * @param {string|number} options.prNumber - Pull request number
 * @param {string|number} options.issueNumber - Issue number to link
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {Object} [options.argv] - Parsed CLI arguments
 * @param {Function} [options.command] - command-stream tagged template
 * @param {Function} [options.logger] - Logger function
 * @returns {Promise<{checked: boolean, updated: boolean, body: string, issueRef: string, error?: string}>}
 */
export const ensurePullRequestIssueLink = async ({ prNumber, issueNumber, owner, repo, argv = {}, command = $, logger = log }) => {
  if (!prNumber || !issueNumber || !owner || !repo) {
    return { checked: false, updated: false, body: '', issueRef: buildIssueReference({ issueNumber, owner, repo, fork: argv.fork }), error: 'missing required pull request or issue data' };
  }

  let prBody = '';
  const prBodyResult = await command`gh pr view ${prNumber} --repo ${owner}/${repo} --json body --jq .body`;
  if (prBodyResult.code !== 0) {
    const error = prBodyResult.stderr ? prBodyResult.stderr.toString().trim() : 'Unknown error';
    await logger(`  ⚠️  Could not read PR body for issue link check: ${error}`);
    return { checked: false, updated: false, body: prBody, issueRef: buildIssueReference({ issueNumber, owner, repo, fork: argv.fork }), error };
  }

  prBody = prBodyResult.stdout.toString();
  const linkResult = ensureIssueLinkInPullRequestBody(prBody, {
    issueNumber,
    owner,
    repo,
    fork: argv.fork,
  });

  if (!linkResult.updated) {
    await logger('  ✅ PR body already contains issue reference');
    return { checked: true, updated: false, body: linkResult.body, issueRef: linkResult.issueRef };
  }

  await logger(`  📝 Updating PR body to link issue #${issueNumber}...`);

  const fs = (await use('fs')).promises;
  const tempBodyFile = `/tmp/pr-body-update-${prNumber}-${Date.now()}.md`;
  await fs.writeFile(tempBodyFile, linkResult.body);

  try {
    const updateResult = await command`gh pr edit ${prNumber} --repo ${owner}/${repo} --body-file "${tempBodyFile}"`;
    await fs.unlink(tempBodyFile).catch(() => {});

    if (updateResult.code === 0) {
      await logger(`  ✅ Updated PR body to include "Fixes ${linkResult.issueRef}"`);
      return { checked: true, updated: true, body: linkResult.body, issueRef: linkResult.issueRef };
    }

    const error = updateResult.stderr ? updateResult.stderr.toString().trim() : 'Unknown error';
    await logger(`  ⚠️  Could not update PR body: ${error}`);
    return { checked: true, updated: false, body: prBody, issueRef: linkResult.issueRef, error };
  } catch (updateError) {
    await fs.unlink(tempBodyFile).catch(() => {});
    throw updateError;
  }
};

export const verifyPullRequestIssueLinkAfterAutoRestart = async ({ prNumber, issueNumber, owner, repo, argv = {}, cleanErrorMessage = error => error.message }) => {
  if (!prNumber) {
    return { checked: false, updated: false, body: '', issueRef: buildIssueReference({ issueNumber, owner, repo, fork: argv.fork }) };
  }

  await log('🔗 Verifying PR issue link after auto-restart...');
  try {
    return await ensurePullRequestIssueLink({ prNumber, issueNumber, owner, repo, argv });
  } catch (issueLinkError) {
    await log(`⚠️  Could not verify PR issue link after auto-restart: ${cleanErrorMessage(issueLinkError)}`, { level: 'warning' });
    return { checked: false, updated: false, body: '', issueRef: buildIssueReference({ issueNumber, owner, repo, fork: argv.fork }), error: issueLinkError.message };
  }
};

/**
 * Detect the CLAUDE.md or .gitkeep commit hash from branch structure when not available in session
 * This handles continue mode where the commit hash was lost between sessions
 *
 * Safety checks to prevent Issue #617 (wrong commit revert):
 * 1. Only look at commits on the PR branch (not default branch commits)
 * 2. Verify the commit message matches our expected pattern
 * 3. Verify the commit ONLY adds CLAUDE.md or .gitkeep (no other files changed)
 * 4. Verify there are additional commits after it (actual work was done)
 *
 * @param {string} tempDir - The temporary directory with the git repo
 * @param {string} branchName - The PR branch name
 * @returns {string|null} - The detected commit hash or null if not found/safe
 */
const detectClaudeMdCommitFromBranch = async (tempDir, branchName) => {
  try {
    await log('   Attempting to detect CLAUDE.md or .gitkeep commit from branch structure...', { verbose: true });

    // First check if CLAUDE.md or .gitkeep exists in current branch
    const claudeMdExistsResult = await $({ cwd: tempDir })`git ls-files CLAUDE.md 2>&1`;
    const gitkeepExistsResult = await $({ cwd: tempDir })`git ls-files .gitkeep 2>&1`;
    const claudeMdExists = claudeMdExistsResult.code === 0 && claudeMdExistsResult.stdout && claudeMdExistsResult.stdout.trim();
    const gitkeepExists = gitkeepExistsResult.code === 0 && gitkeepExistsResult.stdout && gitkeepExistsResult.stdout.trim();

    if (!claudeMdExists && !gitkeepExists) {
      await log('   Neither CLAUDE.md nor .gitkeep exists in current branch', { verbose: true });
      return null;
    }

    // Get the default branch to find the fork point
    const defaultBranchResult = await $({ cwd: tempDir })`git symbolic-ref refs/remotes/origin/HEAD 2>&1`;
    let defaultBranch = 'main';
    if (defaultBranchResult.code === 0 && defaultBranchResult.stdout) {
      const match = defaultBranchResult.stdout.toString().match(/refs\/remotes\/origin\/(.+)/);
      if (match) {
        defaultBranch = match[1].trim();
      }
    }
    await log(`   Using default branch: ${defaultBranch}`, { verbose: true });

    // Find the merge base (fork point) between current branch and default branch
    const mergeBaseResult = await $({ cwd: tempDir })`git merge-base origin/${defaultBranch} HEAD 2>&1`;
    if (mergeBaseResult.code !== 0 || !mergeBaseResult.stdout) {
      await log('   Could not find merge base, cannot safely detect initial commit', { verbose: true });
      return null;
    }
    const mergeBase = mergeBaseResult.stdout.toString().trim();
    await log(`   Merge base: ${mergeBase.substring(0, 7)}`, { verbose: true });

    // Get all commits on the PR branch (commits after the merge base)
    // Format: hash|message|files_changed
    const branchCommitsResult = await $({ cwd: tempDir })`git log ${mergeBase}..HEAD --reverse --format="%H|%s" 2>&1`;
    if (branchCommitsResult.code !== 0 || !branchCommitsResult.stdout) {
      await log('   No commits found on PR branch', { verbose: true });
      return null;
    }

    const branchCommits = branchCommitsResult.stdout.toString().trim().split('\n').filter(Boolean);
    if (branchCommits.length === 0) {
      await log('   No commits found on PR branch', { verbose: true });
      return null;
    }

    await log(`   Found ${branchCommits.length} commit(s) on PR branch`, { verbose: true });

    // Safety check: Must have at least 2 commits (CLAUDE.md commit + actual work)
    if (branchCommits.length < 2) {
      await log('   Only 1 commit on branch - not enough commits to safely revert CLAUDE.md', { verbose: true });
      await log('   (Need at least 2 commits: CLAUDE.md initial + actual work)', { verbose: true });
      return null;
    }

    // Get the first commit on the PR branch
    const firstCommitLine = branchCommits[0];
    const [firstCommitHash, firstCommitMessage] = firstCommitLine.split('|');

    await log(`   First commit on branch: ${firstCommitHash.substring(0, 7)} - "${firstCommitMessage}"`, {
      verbose: true,
    });

    // Safety check: Verify commit message matches expected pattern (CLAUDE.md or .gitkeep)
    const expectedMessagePatterns = [/^Initial commit with task details/i, /^Add CLAUDE\.md/i, /^CLAUDE\.md/i, /^Add \.gitkeep/i, /\.gitkeep/i];

    const messageMatches = expectedMessagePatterns.some(pattern => pattern.test(firstCommitMessage));
    if (!messageMatches) {
      await log('   First commit message does not match expected pattern', { verbose: true });
      await log('   Expected patterns: "Initial commit with task details...", "Add CLAUDE.md", ".gitkeep", etc.', {
        verbose: true,
      });
      return null;
    }

    // Safety check: Verify the commit ONLY adds CLAUDE.md or .gitkeep file (no other files)
    const filesChangedResult = await $({
      cwd: tempDir,
    })`git diff-tree --no-commit-id --name-only -r ${firstCommitHash} 2>&1`;
    if (filesChangedResult.code !== 0 || !filesChangedResult.stdout) {
      await log('   Could not get files changed in first commit', { verbose: true });
      return null;
    }

    const filesChanged = filesChangedResult.stdout.toString().trim().split('\n').filter(Boolean);
    await log(`   Files changed in first commit: ${filesChanged.join(', ')}`, { verbose: true });

    // Check if CLAUDE.md or .gitkeep is in the files changed
    const hasClaudeMd = filesChanged.includes('CLAUDE.md');
    const hasGitkeep = filesChanged.includes('.gitkeep');
    if (!hasClaudeMd && !hasGitkeep) {
      await log('   First commit does not include CLAUDE.md or .gitkeep', { verbose: true });
      return null;
    }

    const targetFile = hasClaudeMd ? 'CLAUDE.md' : '.gitkeep';

    // CRITICAL SAFETY CHECK: Only allow revert if the target file is the ONLY file changed
    // This prevents Issue #617 where reverting a commit deleted .gitignore, LICENSE, README.md
    if (filesChanged.length > 1) {
      await log(`   ⚠️  First commit changes more than just ${targetFile} (${filesChanged.length} files)`, {
        verbose: true,
      });
      await log(`   Files: ${filesChanged.join(', ')}`, { verbose: true });
      await log('   Refusing to revert to prevent data loss (Issue #617 safety)', { verbose: true });
      return null;
    }

    // All safety checks passed!
    await log(`   ✅ Detected ${targetFile} commit: ${firstCommitHash.substring(0, 7)}`, { verbose: true });
    await log(`   ✅ Commit only contains ${targetFile} (safe to revert)`, { verbose: true });
    await log(`   ✅ Branch has ${branchCommits.length - 1} additional commit(s) (work was done)`, { verbose: true });

    return firstCommitHash;
  } catch (error) {
    reportError(error, {
      context: 'detect_initial_commit',
      tempDir,
      branchName,
      operation: 'detect_commit_from_branch_structure',
    });
    await log(`   Error detecting initial commit: ${error.message}`, { verbose: true });
    return null;
  }
};

// Revert the CLAUDE.md or .gitkeep commit to restore original state
export const cleanupClaudeFile = async (tempDir, branchName, claudeCommitHash = null) => {
  try {
    // If no commit hash provided, try to detect it from branch structure
    // This handles continue mode where the hash was lost between sessions
    if (!claudeCommitHash) {
      await log('   No initial commit hash from session, attempting to detect from branch...', { verbose: true });
      claudeCommitHash = await detectClaudeMdCommitFromBranch(tempDir, branchName);

      if (!claudeCommitHash) {
        await log('   Could not safely detect initial commit to revert', { verbose: true });
        return;
      }
      await log(`   Detected initial commit: ${claudeCommitHash.substring(0, 7)}`, { verbose: true });
    }

    // Determine which file was used based on the commit message or actual files changed
    // Use %B (full message including body) instead of %s (subject only) to catch ".gitkeep" in body
    // Also check the actual files changed as a fallback (Issue #1436)
    const commitMsgResult = await $({ cwd: tempDir })`git log -1 --format=%B ${claudeCommitHash} 2>&1`;
    const commitMsg = commitMsgResult.stdout?.trim() || '';
    let isGitkeepFile = commitMsg.includes('.gitkeep');

    // Fallback: check actual files changed in the commit if message doesn't mention .gitkeep
    if (!isGitkeepFile) {
      const filesResult = await $({ cwd: tempDir })`git diff-tree --no-commit-id --name-only -r ${claudeCommitHash} 2>&1`;
      const files = filesResult.stdout?.trim().split('\n').filter(Boolean) || [];
      isGitkeepFile = files.includes('.gitkeep');
    }
    const fileName = isGitkeepFile ? '.gitkeep' : 'CLAUDE.md';

    await log(formatAligned('🔄', 'Cleanup:', `Reverting ${fileName} commit`));
    await log(`   Using saved commit hash: ${claudeCommitHash.substring(0, 7)}...`, { verbose: true });

    // Issue #1572: Sync local branch with remote before cleanup to prevent push failures.
    // After auto-restart sessions, the local branch may be behind the remote.
    const pullResult = await $({ cwd: tempDir })`git pull origin ${branchName} 2>&1`;
    if (pullResult.code === 0) {
      await log(`   Synced local branch before cleanup`, { verbose: true });
    } else {
      throw new Error(`git pull failed (code ${pullResult.code}): ${pullResult.stdout || pullResult.stderr || 'no output'}`);
    }

    const commitToRevert = claudeCommitHash;

    // APPROACH 3: Check for modifications before reverting (proactive detection)
    // This is the main strategy - detect if the file was modified after initial commit
    await log(`   Checking if ${fileName} was modified since initial commit...`, { verbose: true });
    const diffResult = await $({ cwd: tempDir })`git diff ${commitToRevert} HEAD -- ${fileName} 2>&1`;

    if (diffResult.stdout && diffResult.stdout.trim()) {
      // File was modified after initial commit - use manual approach to avoid conflicts
      await log(`   ${fileName} was modified after initial commit, using manual cleanup...`, { verbose: true });

      // Get the state of the file from before the initial commit (parent of the commit we're reverting)
      const parentCommit = `${commitToRevert}~1`;
      const parentFileExists = await $({ cwd: tempDir })`git cat-file -e ${parentCommit}:${fileName} 2>&1`;

      if (parentFileExists.code === 0) {
        // File existed before the initial commit - restore it to that state
        await log(`   ${fileName} existed before session, restoring to previous state...`, { verbose: true });
        await $({ cwd: tempDir })`git checkout ${parentCommit} -- ${fileName}`;
      } else {
        // File didn't exist before the initial commit - delete it
        await log(`   ${fileName} was created in session, removing it...`, { verbose: true });
        await $({ cwd: tempDir })`git rm -f ${fileName} 2>&1`;
      }

      // Create a manual revert commit
      const commitResult = await $({ cwd: tempDir })`git commit -m "Revert: Remove ${fileName} changes from initial commit" 2>&1`;

      if (commitResult.code === 0) {
        await log(formatAligned('📦', 'Committed:', `${fileName} revert (manual)`));

        // Push the revert
        const pushRevertResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
        if (pushRevertResult.code === 0) {
          await log(formatAligned('📤', 'Pushed:', `${fileName} revert to GitHub`));
        } else {
          await log(`   Warning: Could not push ${fileName} revert`, { verbose: true });
        }
      } else {
        await log('   Warning: Could not create manual revert commit', { verbose: true });
        await log(`   Commit output: ${commitResult.stderr || commitResult.stdout}`, { verbose: true });
      }
    } else {
      // No modifications detected - safe to use git revert (standard approach)
      await log('   No modifications detected, using standard git revert...', { verbose: true });

      // FALLBACK 1: Standard git revert
      const revertResult = await $({ cwd: tempDir })`git revert ${commitToRevert} --no-edit 2>&1`;
      if (revertResult.code === 0) {
        await log(formatAligned('📦', 'Committed:', `${fileName} revert`));

        // Push the revert
        const pushRevertResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
        if (pushRevertResult.code === 0) {
          await log(formatAligned('📤', 'Pushed:', `${fileName} revert to GitHub`));
        } else {
          await log(`   Warning: Could not push ${fileName} revert`, { verbose: true });
        }
      } else {
        // FALLBACK 2: Handle unexpected conflicts (three-way merge with automatic resolution)
        const revertOutput = revertResult.stderr || revertResult.stdout || '';
        const hasConflict = revertOutput.includes('CONFLICT') || revertOutput.includes('conflict');

        if (hasConflict) {
          await log('   Unexpected conflict detected, attempting automatic resolution...', { verbose: true });

          // Check git status to see what files are in conflict
          const statusResult = await $({ cwd: tempDir })`git status --short 2>&1`;
          const statusOutput = statusResult.stdout || '';

          // Check if the file is in the conflict
          if (statusOutput.includes(fileName)) {
            await log(`   Resolving ${fileName} conflict by restoring pre-session state...`, { verbose: true });

            // Get the state of the file from before the initial commit (parent of the commit we're reverting)
            const parentCommit = `${commitToRevert}~1`;
            const parentFileExists = await $({ cwd: tempDir })`git cat-file -e ${parentCommit}:${fileName} 2>&1`;

            if (parentFileExists.code === 0) {
              // File existed before the initial commit - restore it to that state
              await log(`   ${fileName} existed before session, restoring to previous state...`, { verbose: true });
              await $({ cwd: tempDir })`git checkout ${parentCommit} -- ${fileName}`;
              // Stage the resolved file
              await $({ cwd: tempDir })`git add ${fileName} 2>&1`;
            } else {
              // File didn't exist before the initial commit - delete it
              await log(`   ${fileName} was created in session, removing it...`, { verbose: true });
              await $({ cwd: tempDir })`git rm -f ${fileName} 2>&1`;
              // No need to git add since git rm stages the deletion
            }

            // Complete the revert with the resolved conflict
            const continueResult = await $({ cwd: tempDir })`git revert --continue --no-edit 2>&1`;

            if (continueResult.code === 0) {
              await log(formatAligned('📦', 'Committed:', `${fileName} revert (conflict resolved)`));

              // Push the revert
              const pushRevertResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
              if (pushRevertResult.code === 0) {
                await log(formatAligned('📤', 'Pushed:', `${fileName} revert to GitHub`));
              } else {
                await log(`   Warning: Could not push ${fileName} revert`, { verbose: true });
              }
            } else {
              await log('   Warning: Could not complete revert after conflict resolution', { verbose: true });
              await log(`   Continue output: ${continueResult.stderr || continueResult.stdout}`, { verbose: true });
            }
          } else {
            // Conflict in some other file, not expected file - this is unexpected
            await log('   Warning: Revert conflict in unexpected file(s), aborting revert', { verbose: true });
            await $({ cwd: tempDir })`git revert --abort 2>&1`;
          }
        } else {
          // Non-conflict error
          await log(`   Warning: Could not revert ${fileName} commit`, { verbose: true });
          await log(`   Revert output: ${revertOutput}`, { verbose: true });
        }
      }
    }
    // Post-cleanup verification: check if the file was actually removed (Issue #1436)
    // This catches cases where revert/push succeeded in logs but file still exists
    const verifyResult = await $({ cwd: tempDir })`git ls-files ${fileName} 2>&1`;
    const fileStillExists = verifyResult.code === 0 && verifyResult.stdout && verifyResult.stdout.trim();
    if (fileStillExists) {
      await log(`   ⚠️  WARNING: ${fileName} still exists after cleanup — attempting direct removal...`);
      // Check if the file existed before the initial commit (parent)
      const parentCommit = `${claudeCommitHash}~1`;
      const parentFileExists = await $({ cwd: tempDir })`git cat-file -e ${parentCommit}:${fileName} 2>&1`;
      if (parentFileExists.code !== 0) {
        // File didn't exist before the session — force remove it
        await $({ cwd: tempDir })`git rm -f ${fileName} 2>&1`;
        const fallbackCommit = await $({ cwd: tempDir })`git commit -m "Remove leftover ${fileName} (post-cleanup fallback, Issue #1436)" 2>&1`;
        if (fallbackCommit.code === 0) {
          const fallbackPush = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
          if (fallbackPush.code === 0) {
            await log(`   ✅ ${fileName} removed via post-cleanup fallback`);
          } else {
            await log(`   ⚠️  ${fileName} removed locally but push failed`, { verbose: true });
          }
        }
      } else {
        await log(`   ℹ️  ${fileName} existed before this session — keeping pre-existing file`, { verbose: true });
      }
    }
  } catch (e) {
    reportError(e, {
      context: 'cleanup_claude_file',
      tempDir,
      operation: 'revert_initial_commit',
    });
    // If revert fails, that's okay - the task is still complete
    await log('   Initial commit revert failed or not needed', { verbose: true });
  }
};

// Show session summary and handle limit reached scenarios
export const showSessionSummary = async (sessionId, limitReached, argv, issueUrl, tempDir, shouldAttachLogs = false) => {
  await log('\n=== Session Summary ===');

  if (sessionId) {
    await log(`✅ Session ID: ${sessionId}`);
    // Always use absolute path for log file display
    const absoluteLogPath = path.resolve(getLogFile());
    await log(`✅ Complete log file: ${absoluteLogPath}`);

    const tool = argv.tool || 'claude';
    if (tool === 'claude') {
      const claudeResumeCmd = buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model });

      await log('');
      await log('💡 To continue this session in Claude Code interactive mode:');
      await log('');
      await log(`   ${claudeResumeCmd}`);
      await log('');
    } else if (issueUrl) {
      const solveResumeCmd = buildSolveResumeCommand({ issueUrl, sessionId, tool, model: argv.model, fallbackModel: argv.fallbackModel, tempDir });
      await log('');
      await log(`💡 To continue this ${tool} session with solve:`);
      await log('');
      await log(`   ${solveResumeCmd}`);
      await log('');
    }

    if (limitReached) {
      await log('⏰ LIMIT REACHED DETECTED!');

      if ((argv.autoResumeOnLimitReset || argv.autoRestartOnLimitReset) && global.limitResetTime) {
        const isRestart = !!argv.autoRestartOnLimitReset;
        await log(`\n🔄 AUTO-${isRestart ? 'RESTART' : 'RESUME'} ON LIMIT RESET ENABLED - Will ${isRestart ? 'restart' : 'resume'} at ${global.limitResetTime}`);
        // Pass tempDir to ensure resumed session uses the same working directory
        // This is critical for Claude Code session resume to work correctly
        await autoContinueWhenLimitResets(issueUrl, sessionId, argv, shouldAttachLogs, tempDir, isRestart);
      } else {
        if (global.limitResetTime) {
          await log(`\n⏰ Limit resets at: ${global.limitResetTime}`);
        }

        await log('\n💡 After the limit resets, resume using the command above.');

        if (argv.autoCleanup !== false) {
          await log('');
          await log('⚠️  Note: Temporary directory will be automatically cleaned up.');
          await log('   To keep the directory for debugging or resuming, use --no-auto-cleanup');
        }
      }
    } else {
      // Show note about auto-cleanup only when enabled
      if (argv.autoCleanup !== false) {
        await log('ℹ️  Note: Temporary directory will be automatically cleaned up.');
        await log('   To keep the directory for debugging or resuming, use --no-auto-cleanup');
      }
    }

    // Don't show log preview, it's too technical
  } else {
    // For agent tool, session IDs may not be meaningful for resuming, so don't show as error
    if (argv.tool !== 'agent') {
      await log('❌ No session ID extracted');
    } else {
      await log('ℹ️  Agent tool completed (session IDs not used for resuming)');
    }
    // Always use absolute path for log file display
    const logFilePath = path.resolve(getLogFile());
    await log(`📁 Log file available: ${logFilePath}`);
  }
};

// Verify results by searching for new PRs and comments
export const verifyResults = async (owner, repo, branchName, issueNumber, prNumber, prUrl, referenceTime, argv, shouldAttachLogs, shouldRestart = false, sessionId = null, tempDir = null, anthropicTotalCostUSD = null, publicPricingEstimate = null, pricingInfo = null, errorDuringExecution = false, sessionType = 'new', resultModelUsage = null, streamTokenUsage = null, subAgentCalls = null) => {
  await log('\n🔍 Searching for created pull requests or comments...');

  // Issue #1491, #1526: Build budget stats data for GitHub comment (computed once, used in both PR and issue paths)
  let budgetStatsData = null;
  if (argv.tokensBudgetStats && sessionId && tempDir) {
    try {
      const { calculateSessionTokens } = await import('./claude.lib.mjs');
      const tokenUsage = await calculateSessionTokens(sessionId, tempDir, resultModelUsage);
      if (tokenUsage) {
        budgetStatsData = { tokenUsage, streamTokenUsage, subAgentCalls };
      }
    } catch (budgetError) {
      if (argv.verbose) await log(`  ⚠️  Could not calculate budget stats: ${budgetError.message}`, { verbose: true });
    }
  }
  // Issue #1526: Build budget stats from Agent CLI token/context data when no JSONL session available
  if (!budgetStatsData && argv.tokensBudgetStats && pricingInfo?.tokenUsage) {
    try {
      const { buildAgentBudgetStats } = await import('./claude.budget-stats.lib.mjs');
      const agentBudgetData = buildAgentBudgetStats(pricingInfo.tokenUsage, pricingInfo);
      if (agentBudgetData) {
        budgetStatsData = { tokenUsage: agentBudgetData };
      }
    } catch (agentBudgetError) {
      if (argv.verbose) await log(`  ⚠️  Could not build agent budget stats: ${agentBudgetError.message}`, { verbose: true });
    }
  }

  try {
    // Get the current user's GitHub username
    const userResult = await $`gh api user --jq .login`;

    if (userResult.code !== 0) {
      throw new Error(`Failed to get current user: ${userResult.stderr ? userResult.stderr.toString() : 'Unknown error'}`);
    }

    const currentUser = userResult.stdout.toString().trim();
    if (!currentUser) {
      throw new Error('Unable to determine current GitHub user');
    }

    // Search for pull requests created from our branch
    await log('\n🔍 Checking for pull requests from branch ' + branchName + '...');

    // First, get all PRs from our branch
    // IMPORTANT: Use --state all to find PRs that may have been merged during the session (Issue #1008)
    // Without --state all, gh pr list only returns OPEN PRs, missing merged ones
    const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --state all --json number,url,createdAt,headRefName,title,state,updatedAt,isDraft`;

    if (allBranchPrsResult.code !== 0) {
      await log('  ⚠️  Failed to check pull requests');
      // Continue with empty list
    }

    const allBranchPrs = allBranchPrsResult.stdout.toString().trim() ? JSON.parse(allBranchPrsResult.stdout.toString().trim()) : [];

    // Check if we have any PRs from our branch
    // If auto-PR was created, it should be the one we're working on
    if (allBranchPrs.length > 0) {
      const pr = allBranchPrs[0]; // Get the most recent PR from our branch

      // If we created a PR earlier in this session, it would be prNumber
      // Or if the PR was updated during the session (updatedAt > referenceTime)
      const isPrFromSession = (prNumber && pr.number.toString() === prNumber) || (prUrl && pr.url === prUrl) || new Date(pr.updatedAt) > referenceTime || new Date(pr.createdAt) > referenceTime;

      if (isPrFromSession) {
        await log(`  ✅ Found pull request #${pr.number}: "${pr.title}"`);

        // Check if PR was merged during the session (Issue #1008)
        const isPrMerged = pr.state === 'MERGED';
        if (isPrMerged) {
          await log(`  ℹ️  PR #${pr.number} was merged during the session`);
        }

        // Declare placeholder detection variables outside block scopes for use in return value
        let prTitleHasPlaceholder = false;
        let prBodyHasPlaceholder = false;
        let requirementsDocsChecked = false;
        let requirementsDocsUpdated = false;
        let requirementsChangedFiles = [];

        // Skip PR body update and ready conversion for merged PRs (they can't be edited)
        if (!isPrMerged) {
          const issueLinkResult = await ensurePullRequestIssueLink({
            prNumber: pr.number,
            issueNumber,
            owner,
            repo,
            argv,
            command: $,
            logger: log,
          });
          const prBody = issueLinkResult.body || '';

          // Issue #1162: Detect if PR title/description still have auto-generated placeholder content
          // Track this before cleanup for --auto-restart-on-non-updated-pull-request-description
          prTitleHasPlaceholder = hasPRTitlePlaceholder(pr.title);
          prBodyHasPlaceholder = hasPRBodyPlaceholder(prBody);

          // Issue #1162: Remove [WIP] prefix from title if still present
          // Skip cleanup if auto-restart-on-non-updated-pull-request-description is enabled
          // (let the agent handle it on restart instead)
          if (prTitleHasPlaceholder && !argv.autoRestartOnNonUpdatedPullRequestDescription) {
            const updatedTitle = pr.title.replace(/^\[WIP\]\s*/, '');
            await log(`  📝 Removing [WIP] prefix from PR title...`);
            const titleResult = await $`gh pr edit ${pr.number} --repo ${owner}/${repo} --title "${updatedTitle}"`;
            if (titleResult.code === 0) {
              await log(`  ✅ Updated PR title to: "${updatedTitle}"`);
            } else {
              await log(`  ⚠️  Could not update PR title: ${titleResult.stderr ? titleResult.stderr.toString().trim() : 'Unknown error'}`);
            }
          }

          // Issue #1162: Update PR description if still contains placeholder text
          // Skip cleanup if auto-restart-on-non-updated-pull-request-description is enabled
          const hasPlaceholder = prBodyHasPlaceholder;
          if (hasPlaceholder && !argv.autoRestartOnNonUpdatedPullRequestDescription) {
            await log(`  📝 Updating PR description to remove placeholder text...`);

            // Build a summary of the changes from the PR diff
            const diffResult = await $`gh pr diff ${pr.number} --repo ${owner}/${repo} 2>&1`;
            const diffOutput = diffResult.code === 0 ? diffResult.stdout.toString() : '';

            // Count files changed
            const filesChanged = (diffOutput.match(/^diff --git/gm) || []).length;
            const additions = (diffOutput.match(/^\+[^+]/gm) || []).length;
            const deletions = (diffOutput.match(/^-[^-]/gm) || []).length;

            // Get the issue title for context
            const issueTitleResult = await $`gh issue view ${issueNumber} --repo ${owner}/${repo} --json title --jq .title 2>&1`;
            const issueTitle = issueTitleResult.code === 0 ? issueTitleResult.stdout.toString().trim() : 'the issue';

            // Build new description
            const fs = (await use('fs')).promises;
            const issueRef = buildIssueReference({ issueNumber, owner, repo, fork: argv.fork });
            const newDescription = `## Summary

This pull request implements a solution for ${issueRef}: ${issueTitle}

### Changes
- ${filesChanged} file(s) modified
- ${additions} line(s) added
- ${deletions} line(s) removed

### Issue Reference
Fixes ${issueRef}

---
*This PR was created automatically by the AI issue solver*`;

            const tempBodyFile = `/tmp/pr-body-finalize-${pr.number}-${Date.now()}.md`;
            await fs.writeFile(tempBodyFile, newDescription);

            try {
              const descResult = await $`gh pr edit ${pr.number} --repo ${owner}/${repo} --body-file "${tempBodyFile}"`;
              await fs.unlink(tempBodyFile).catch(() => {});

              if (descResult.code === 0) {
                await log(`  ✅ Updated PR description with solution summary`);
              } else {
                await log(`  ⚠️  Could not update PR description: ${descResult.stderr ? descResult.stderr.toString().trim() : 'Unknown error'}`);
              }
            } catch (descError) {
              await fs.unlink(tempBodyFile).catch(() => {});
              await log(`  ⚠️  Error updating PR description: ${descError.message}`);
            }
          }

          if (argv.requirementsTracking) {
            await log('  🔍 Checking requirements tracking documentation updates...');
            const changedFilesResult = await getPullRequestChangedFiles({
              prNumber: pr.number,
              owner,
              repo,
              command: $,
              logger: log,
            });
            requirementsDocsChecked = changedFilesResult.checked;
            requirementsChangedFiles = changedFilesResult.files;
            requirementsDocsUpdated = hasRequirementsTrackingDocumentChange(requirementsChangedFiles);

            if (requirementsDocsChecked && requirementsDocsUpdated) {
              await log('  ✅ Requirements tracking documentation changed in this pull request');
            } else if (requirementsDocsChecked) {
              await log('  ⚠️  Requirements tracking is enabled, but docs/requirements/*.md was not changed');
            }
          }

          // Check if PR is ready for review (convert from draft if necessary)
          if (pr.isDraft) {
            await log('  🔄 Converting PR from draft to ready for review...');
            const readyResult = await $`gh pr ready ${pr.number} --repo ${owner}/${repo}`;
            if (readyResult.code === 0) {
              await log('  ✅ PR converted to ready for review');
            } else {
              await log(`  ⚠️  Could not convert PR to ready (${readyResult.stderr ? readyResult.stderr.toString().trim() : 'unknown error'})`);
            }
          } else {
            await log('  ✅ PR is already ready for review', { verbose: true });
          }
        }

        // Upload log file to PR if requested
        let logUploadSuccess = false;
        if (shouldAttachLogs) {
          await log('\n📎 Uploading solution draft log to Pull Request...');
          logUploadSuccess = await attachLogToGitHub({
            logFile: getLogFile(),
            targetType: 'pr',
            targetNumber: pr.number,
            owner,
            repo,
            $,
            log,
            sanitizeLogContent,
            verbose: argv.verbose,
            sessionId,
            tempDir,
            anthropicTotalCostUSD,
            // Pass agent tool pricing data when available
            publicPricingEstimate,
            pricingInfo,
            // Issue #1088: Pass errorDuringExecution for "Finished with errors" state
            errorDuringExecution,
            // Issue #1152: Pass sessionType for differentiated log comments
            sessionType,
            // Issue #1225: Pass model and tool info for PR comments
            requestedModel: argv.originalModel || argv.model,
            tool: argv.tool || 'claude',
            // Issue #1454: Pass resultModelUsage for accurate multi-model display
            resultModelUsage,
            // Issue #1491: Pass budget stats for token budget display in comment
            budgetStatsData,
          });
        }

        await log('\n🎉 SUCCESS: A solution draft has been prepared as a pull request');
        await log(`📍 URL: ${pr.url}`);
        if (shouldAttachLogs && logUploadSuccess) {
          await log('📎 Solution draft log has been attached to the Pull Request');
        } else if (shouldAttachLogs && !logUploadSuccess) {
          await log('⚠️  Solution draft log upload was requested but failed');
        }
        await log('\n✨ Please review the pull request for the proposed solution draft.');
        // Don't exit if watch mode is enabled OR if auto-restart is needed for uncommitted changes
        // Also don't exit if auto-restart-on-non-updated-pull-request-description detected placeholders
        // Issue #1219: Also don't exit if auto-merge or auto-restart-until-mergeable is enabled
        const shouldAutoRestartForPlaceholder = argv.autoRestartOnNonUpdatedPullRequestDescription && (prTitleHasPlaceholder || prBodyHasPlaceholder);
        if (shouldAutoRestartForPlaceholder) {
          await log('\n🔄 Placeholder detected in PR title/description - auto-restart will be triggered');
        }
        const shouldAutoRestartForRequirementsTracking = argv.requirementsTracking && requirementsDocsChecked && !requirementsDocsUpdated;
        if (shouldAutoRestartForRequirementsTracking) {
          await log('\n🔄 Requirements tracking docs missing from PR - auto-restart will be triggered');
        }
        const shouldWaitForAutoMerge = argv.autoMerge || argv.autoRestartUntilMergeable;
        if (shouldWaitForAutoMerge) {
          await log('\n🔄 Auto-merge mode enabled - will attempt to merge after verification');
        }
        if (!argv.watch && !shouldRestart && !shouldAutoRestartForPlaceholder && !shouldAutoRestartForRequirementsTracking && !shouldWaitForAutoMerge) {
          await safeExit(0, 'Process completed successfully');
        }
        // Issue #1154: Return logUploadSuccess to prevent duplicate log uploads
        // Issue #1162: Return placeholder detection status for auto-restart
        return { logUploadSuccess, prTitleHasPlaceholder, prBodyHasPlaceholder, requirementsDocsChecked, requirementsDocsUpdated, requirementsChangedFiles }; // Return for watch mode or auto-restart
      } else {
        await log(`  ℹ️  Found pull request #${pr.number} but it appears to be from a different session`);
      }
    } else {
      await log(`  ℹ️  No pull requests found from branch ${branchName}`);
    }

    // If no PR found, search for recent comments on the issue
    await log('\n🔍 Checking for new comments on issue #' + issueNumber + '...');

    // Get all comments and filter them
    // Use --paginate to get all comments - GitHub API returns max 30 per page by default
    const allCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`;

    if (allCommentsResult.code !== 0) {
      await log('  ⚠️  Failed to check comments');
      // Continue with empty list
    }

    const allComments = JSON.parse(allCommentsResult.stdout.toString().trim() || '[]');

    // Filter for new comments by current user
    const newCommentsByUser = allComments.filter(comment => comment.user.login === currentUser && new Date(comment.created_at) > referenceTime);

    if (newCommentsByUser.length > 0) {
      const lastComment = newCommentsByUser[newCommentsByUser.length - 1];
      await log(`  ✅ Found new comment by ${currentUser}`);

      // Upload log file to issue if requested
      if (shouldAttachLogs) {
        await log('\n📎 Uploading solution draft log to issue...');
        await attachLogToGitHub({
          logFile: getLogFile(),
          targetType: 'issue',
          targetNumber: issueNumber,
          owner,
          repo,
          $,
          log,
          sanitizeLogContent,
          verbose: argv.verbose,
          sessionId,
          tempDir,
          anthropicTotalCostUSD,
          // Pass agent tool pricing data when available
          publicPricingEstimate,
          pricingInfo,
          // Issue #1088: Pass errorDuringExecution for "Finished with errors" state
          errorDuringExecution,
          // Issue #1152: Pass sessionType for differentiated log comments
          sessionType,
          // Issue #1225: Pass model and tool info for issue comments
          requestedModel: argv.originalModel || argv.model,
          tool: argv.tool || 'claude',
          // Issue #1454: Pass resultModelUsage for accurate multi-model display
          resultModelUsage,
          // Issue #1491: Pass budget stats for token budget display in comment
          budgetStatsData,
        });
      }

      await log('\n💬 SUCCESS: Comment posted on issue');
      await log(`📍 URL: ${lastComment.html_url}`);
      if (shouldAttachLogs) {
        await log('📎 Solution draft log has been attached to the issue');
      }
      await log('\n✨ A clarifying comment has been added to the issue.');
      // Don't exit if watch mode is enabled OR if auto-restart is needed for uncommitted changes
      // Issue #1219: Also don't exit if auto-merge or auto-restart-until-mergeable is enabled
      const shouldWaitForAutoMergeComment = argv.autoMerge || argv.autoRestartUntilMergeable;
      if (!argv.watch && !shouldRestart && !shouldWaitForAutoMergeComment) {
        await safeExit(0, 'Process completed successfully');
      }
      // Issue #1154: Return logUploadSuccess to prevent duplicate log uploads
      return { logUploadSuccess: true }; // Return for watch mode or auto-restart
    } else if (allComments.length > 0) {
      await log(`  ℹ️  Issue has ${allComments.length} existing comment(s)`);
    } else {
      await log('  ℹ️  No comments found on issue');
    }

    // If neither found, it might not have been necessary to create either
    await log('\n📋 No new pull request or comment was created.');
    await log('   The issue may have been resolved differently or required no action.');
    await log('\n💡 Review the session log for details:');
    // Always use absolute path for log file display
    const reviewLogPath = path.resolve(getLogFile());
    await log(`   ${reviewLogPath}`);
    // Don't exit if watch mode is enabled - it needs to continue monitoring
    // Issue #1219: Also don't exit if auto-merge or auto-restart-until-mergeable is enabled
    const shouldWaitForAutoMergeNoAction = argv.autoMerge || argv.autoRestartUntilMergeable;
    if (!argv.watch && !shouldWaitForAutoMergeNoAction) {
      await safeExit(0, 'Process completed successfully');
    }
    // Issue #1154: Return logUploadSuccess to prevent duplicate log uploads
    return { logUploadSuccess: false }; // Return for watch mode
  } catch (searchError) {
    reportError(searchError, {
      context: 'verify_pr_creation',
      issueNumber,
      operation: 'search_for_pr',
    });
    await log('\n⚠️  Could not verify results:', searchError.message);
    await log('\n💡 Check the log file for details:');
    // Always use absolute path for log file display
    const checkLogPath = path.resolve(getLogFile());
    await log(`   ${checkLogPath}`);
    // Don't exit if watch mode is enabled - it needs to continue monitoring
    // Issue #1219: Also don't exit if auto-merge or auto-restart-until-mergeable is enabled
    const shouldWaitForAutoMergeError = argv.autoMerge || argv.autoRestartUntilMergeable;
    if (!argv.watch && !shouldWaitForAutoMergeError) {
      await safeExit(0, 'Process completed successfully');
    }
    // Issue #1154: Return logUploadSuccess to prevent duplicate log uploads
    return { logUploadSuccess: false }; // Return for watch mode
  }
};

// Handle execution errors with log attachment
export const handleExecutionError = async (error, shouldAttachLogs, owner, repo, argv = {}) => {
  const { cleanErrorMessage } = await import('./lib.mjs');
  await log('Error executing command:', cleanErrorMessage(error));
  await log(`Stack trace: ${error.stack}`, { verbose: true });

  // If --attach-logs is enabled, try to attach failure logs
  if (shouldAttachLogs && getLogFile()) {
    await log('\n📄 Attempting to attach failure logs...');

    // Try to attach to existing PR first
    if (global.createdPR && global.createdPR.number) {
      try {
        const logUploadSuccess = await attachLogToGitHub({
          logFile: getLogFile(),
          targetType: 'pr',
          targetNumber: global.createdPR.number,
          owner,
          repo,
          $,
          log,
          sanitizeLogContent,
          verbose: argv.verbose || false,
          errorMessage: cleanErrorMessage(error),
          // Issue #1225: Pass model and tool info for PR comments
          requestedModel: argv.originalModel || argv.model,
          tool: argv.tool || 'claude',
        });

        if (logUploadSuccess) {
          await log('📎 Failure log attached to Pull Request');
        }
      } catch (attachError) {
        reportError(attachError, {
          context: 'attach_success_log',
          prNumber: global.createdPR?.number,
          operation: 'attach_log_to_pr',
        });
        await log(`⚠️  Could not attach failure log: ${attachError.message}`, { level: 'warning' });
      }
    }
  }

  // If --auto-close-pull-request-on-fail is enabled, close the PR
  if (argv.autoClosePullRequestOnFail && global.createdPR && global.createdPR.number) {
    await log('\n🔒 Auto-closing pull request due to failure...');
    try {
      const result = await $`gh pr close ${global.createdPR.number} --repo ${owner}/${repo} --comment "Auto-closed due to execution failure. Logs have been attached for debugging."`;
      if (result.exitCode === 0) {
        await log('✅ Pull request closed successfully');
      } else {
        await log(`⚠️  Could not close pull request: ${result.stderr}`, { level: 'warning' });
      }
    } catch (closeError) {
      reportError(closeError, {
        context: 'close_success_pr',
        prNumber: global.createdPR?.number,
        operation: 'close_pull_request',
      });
      await log(`⚠️  Could not close pull request: ${closeError.message}`, { level: 'warning' });
    }
  }

  await safeExit(1, 'Execution error');
};

// Issue #1625: Markers and in-memory comment-ID tracking are centralized in
// src/tool-comments.lib.mjs so that every place that *posts* a tool-generated
// comment and the filter that *detects* them share the exact same constants.
// Re-exported here for backwards compatibility with imports that expect them
// from solve.results.lib.mjs.
const toolComments = await import('./tool-comments.lib.mjs');
export const { TOOL_GENERATED_COMMENT_MARKERS, isToolGeneratedComment, trackToolCommentId, isToolTrackedCommentId, getTrackedToolCommentIds, postTrackedComment } = toolComments;

/**
 * Check if new comments were created by the AI during the session.
 * This is used by --auto-attach-solution-summary to determine if the AI
 * already provided feedback.
 *
 * Issue #1263: Support for --attach-solution-summary and --auto-attach-solution-summary
 * Issue #1625: Filter out comments produced by solve.mjs itself (session start,
 * log upload, auto-restart, etc.) so they do not falsely count as AI-authored.
 *
 * @param {Date} sessionStartTime - The timestamp when this solve work session started
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number (null if working on issue only)
 * @param {number} issueNumber - Issue number
 * @returns {Promise<boolean>} - True if AI created comments during the session
 */
export const checkForAiCreatedComments = async (sessionStartTime, owner, repo, prNumber, issueNumber) => {
  try {
    // Get the current user's GitHub username
    const userResult = await $`gh api user --jq .login`;
    if (userResult.code !== 0) {
      return false; // Cannot determine, default to not attaching
    }
    const currentUser = userResult.stdout.toString().trim();
    if (!currentUser) {
      return false;
    }

    await log(`🔎 Checking comments by '${currentUser}' after session start ${sessionStartTime.toISOString()} (PR #${prNumber ?? 'none'}, issue #${issueNumber ?? 'none'})`, { verbose: true });

    // Issue #1625: A comment counts as an "AI comment" only if it was posted
    // by the current user AFTER sessionStartTime AND solve.mjs did NOT post it
    // itself. We identify tool-posted comments in two ways, in order:
    //   1. Primary: comment ID is in the in-memory tracked set populated by
    //      every solve.mjs posting site (postTrackedComment / trackToolCommentId).
    //      This is robust to comment-body changes.
    //   2. Fallback: comment body matches a known TOOL_GENERATED_COMMENT_MARKERS
    //      marker. This catches comments whose IDs weren't captured — for
    //      example, on resumed sessions where the posting happened in an
    //      earlier process, or legacy code paths that predate tracking.
    // Review-type inline comments cannot be posted by solve.mjs, so they are
    // treated as AI-authored by default.
    const filterNewAiComments = (comments, kind) => {
      const filtered = [];
      const skippedCounts = {};
      const skippedByIdCount = { n: 0 };
      for (const comment of comments) {
        if (!comment || !comment.user || comment.user.login !== currentUser) continue;
        if (!(new Date(comment.created_at) > sessionStartTime)) continue;

        const isReview = kind === 'review';
        if (!isReview) {
          if (isToolTrackedCommentId(comment.id)) {
            skippedByIdCount.n += 1;
            continue;
          }
          if (isToolGeneratedComment(comment.body)) {
            const markerMatch = TOOL_GENERATED_COMMENT_MARKERS.find(m => (comment.body || '').includes(m)) || 'unknown';
            skippedCounts[markerMatch] = (skippedCounts[markerMatch] || 0) + 1;
            continue;
          }
        }
        filtered.push(comment);
      }
      if (skippedByIdCount.n > 0) {
        log(`   ⏭️  Skipped ${kind} tool-tracked comment IDs: ${skippedByIdCount.n}`, { verbose: true }).catch(() => {});
      }
      if (Object.keys(skippedCounts).length > 0) {
        const summary = Object.entries(skippedCounts)
          .map(([m, c]) => `${m}=${c}`)
          .join(', ');
        log(`   ⏭️  Skipped ${kind} tool-generated comments (marker fallback): ${summary}`, { verbose: true }).catch(() => {});
      }
      return filtered;
    };

    // Check comments on the PR first (if we have a PR)
    if (prNumber) {
      // Check PR conversation comments
      const prCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`;
      if (prCommentsResult.code === 0) {
        const prComments = JSON.parse(prCommentsResult.stdout.toString().trim() || '[]');
        const newPrComments = filterNewAiComments(prComments, 'pr');
        await log(`   📨 PR conversation comments after session start by '${currentUser}' (excluding tool-generated): ${newPrComments.length}`, { verbose: true });
        if (newPrComments.length > 0) {
          return true;
        }
      }

      // Check PR review comments (inline code comments)
      const reviewCommentsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`;
      if (reviewCommentsResult.code === 0) {
        const reviewComments = JSON.parse(reviewCommentsResult.stdout.toString().trim() || '[]');
        const newReviewComments = filterNewAiComments(reviewComments, 'review');
        await log(`   📝 PR review (inline) comments after session start by '${currentUser}': ${newReviewComments.length}`, { verbose: true });
        if (newReviewComments.length > 0) {
          return true;
        }
      }
    }

    // Check issue comments (if different from PR number or no PR)
    if (issueNumber && issueNumber !== prNumber) {
      const issueCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`;
      if (issueCommentsResult.code === 0) {
        const issueComments = JSON.parse(issueCommentsResult.stdout.toString().trim() || '[]');
        const newIssueComments = filterNewAiComments(issueComments, 'issue');
        await log(`   📨 Issue comments after session start by '${currentUser}' (excluding tool-generated): ${newIssueComments.length}`, { verbose: true });
        if (newIssueComments.length > 0) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    // On error, default to not attaching (safer choice)
    await log(`⚠️  Could not check for AI comments: ${error.message}`, { verbose: true });
    return false;
  }
};

/**
 * Attach the AI's working session summary as a comment to the PR or issue.
 * The summary is extracted from the tool's result field and posted
 * with a "Working session summary" header.
 *
 * Issue #1263: Support for --attach-solution-summary and --auto-attach-solution-summary
 * Issue #1728: Renamed comment header from "Solution summary" to "Working session
 * summary" so it accurately describes continuation/restart iterations too. CLI
 * flag names are preserved for backwards compatibility. Posting now uses
 * postTrackedComment so the comment ID is registered in the in-memory tool-
 * comment set — that way the next iteration's --auto-attach-solution-summary
 * check doesn't mistake a previous iteration's summary for an AI comment.
 *
 * @param {Object} options - Options object
 * @param {string} options.resultSummary - The AI's result summary text
 * @param {number} options.prNumber - Pull request number (null if posting to issue)
 * @param {number} options.issueNumber - Issue number
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @returns {Promise<boolean>} - True if comment was posted successfully
 */
export const attachSolutionSummary = async ({ resultSummary, prNumber, issueNumber, owner, repo }) => {
  if (!resultSummary || typeof resultSummary !== 'string') {
    await log('⚠️  No working session summary available to attach', { verbose: true });
    return false;
  }

  const targetNumber = prNumber || issueNumber;
  const targetType = prNumber ? 'pr' : 'issue';

  if (!targetNumber) {
    await log('⚠️  No PR or issue number to attach working session summary to', { verbose: true });
    return false;
  }

  try {
    const comment = `## Working session summary

${resultSummary}

---
*This summary was automatically extracted from the AI working session output.*`;

    const { ok, commentId, stderr } = await postTrackedComment({ $, owner, repo, targetNumber, body: comment });

    if (ok) {
      await log(`✅ Working session summary attached to ${targetType} #${targetNumber}${commentId ? ` (id=${commentId})` : ''}`);
      return true;
    } else {
      await log(`⚠️  Failed to attach working session summary: ${stderr || 'Unknown error'}`, {
        level: 'warning',
      });
      return false;
    }
  } catch (error) {
    reportError(error, {
      context: 'attach_solution_summary',
      targetType,
      targetNumber,
      operation: 'post_working_session_summary_comment',
    });
    await log(`⚠️  Error attaching working session summary: ${error.message}`, { level: 'warning' });
    return false;
  }
};

/**
 * Decide whether to attach a working session summary for a single working
 * session and, if so, post it. Single source of truth for the attach decision
 * shared by every working-session call site:
 *
 *   - solve.mjs (top-level, end-of-run)
 *   - solve.auto-merge.lib.mjs (auto-restart-until-mergeable iterations)
 *   - solve.watch.lib.mjs (watch / temporary auto-restart iterations)
 *
 * Issue #1728: Before this helper, only solve.mjs ran the attach decision, so
 * iterations inside auto-restart-until-mergeable / watch silently dropped the
 * AI's `resultSummary` whenever the AI itself posted no comment. Centralising
 * the decision here means every working session ends with either an AI-authored
 * comment OR an automated "Working session summary" comment, matching the
 * issue's "unify logic for all working sessions" requirement.
 *
 * @param {Object} options
 * @param {Object} options.argv - parsed CLI arguments (reads attachSolutionSummary
 *   and autoAttachSolutionSummary; flag names preserved for backwards compat)
 * @param {string|null|undefined} options.resultSummary - AI's last-message summary
 * @param {Date} options.workStartTime - the iteration's own start time, used to
 *   scope the AI-comment check to this iteration only
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {number|null} options.prNumber
 * @param {number|null} options.issueNumber
 * @param {boolean} [options.success=true] - skip attachment for failed iterations
 * @returns {Promise<{attached: boolean, reason: string}>}
 */
export const maybeAttachWorkingSessionSummary = async ({ argv, resultSummary, workStartTime, owner, repo, prNumber, issueNumber, success = true }) => {
  if (!success) {
    return { attached: false, reason: 'iteration_failed' };
  }

  const attachFlag = argv && (argv.attachSolutionSummary || argv['attach-solution-summary']);
  const autoAttachFlag = argv && (argv.autoAttachSolutionSummary || argv['auto-attach-solution-summary']);

  if (!attachFlag && !autoAttachFlag) {
    return { attached: false, reason: 'flag_disabled' };
  }

  if (!resultSummary || typeof resultSummary !== 'string') {
    await log('ℹ️  No working session summary available from AI tool output', { verbose: true });
    return { attached: false, reason: 'no_result_summary' };
  }

  let shouldAttach = false;
  if (attachFlag) {
    shouldAttach = true;
    await log('📝 --attach-solution-summary enabled, attaching working session summary...');
  } else if (autoAttachFlag) {
    await log('🔍 Checking if AI created any comments during session (--auto-attach-solution-summary)...');
    const aiCreatedComments = await checkForAiCreatedComments(workStartTime, owner, repo, prNumber, issueNumber);
    if (aiCreatedComments) {
      await log('ℹ️  AI created comments during session, skipping working session summary attachment');
      return { attached: false, reason: 'ai_comments_present' };
    }
    shouldAttach = true;
    await log('📝 No AI comments detected, attaching working session summary...');
  }

  if (!shouldAttach) {
    return { attached: false, reason: 'no_attach_decision' };
  }

  const ok = await attachSolutionSummary({ resultSummary, prNumber, issueNumber, owner, repo });
  return { attached: !!ok, reason: ok ? 'attached' : 'post_failed' };
};
