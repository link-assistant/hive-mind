import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReviewPrompts, buildReviewResumeCommand, executeReviewTool, getNewSubmittedReviews, parseReviewUrl } from './review.lib.mjs';
import { QUIET_PROBE } from './quiet-probe.lib.mjs';
import { ensureAuthenticatedGitTransport } from './git-auth-transport.lib.mjs';
import { wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs';

export async function runReview({ argv, $: rawDollar, log, executeTool = executeReviewTool, toolContext = {}, authenticate = ensureAuthenticatedGitTransport }) {
  const $ = wrapDollarWithGhRetry(rawDollar);
  const target = parseReviewUrl(argv.url);
  const { owner, repo, prNumber, url: prUrl } = target;
  const contextDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gh-pr-review-context-'));
  const tempDir = argv.workingDirectory ? path.resolve(argv.workingDirectory) : path.join(contextDir, 'repository');
  let keepDirectory = Boolean(argv.workingDirectory || argv.resume || argv.dryRun || argv.onlyPrepareCommand);
  const checked = async (result, label) => {
    if (result.code !== 0) throw new Error(`${label}: ${result.stderr?.toString().trim() || result.stdout?.toString().trim() || `exit code ${result.code}`}`);
    return result.stdout?.toString() || '';
  };
  const reviewsEndpoint = `repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
  try {
    const prDetails = JSON.parse(await checked(await $(QUIET_PROBE)`gh pr view ${prUrl} --json title,body,headRefName,headRefOid,baseRefName,author,number,state`, 'Get pull request'));
    if (prDetails.state !== 'OPEN') throw new Error(`Pull request #${prNumber} is ${prDetails.state}; review requires an open pull request`);
    await log(`📄 Reviewing #${prNumber}: ${prDetails.title} (${argv.tool}, ${argv.model})`);
    await log(`📂 Working directory: ${tempDir}`);
    await authenticate({ $, log, reason: 'review clone' });
    const gitDirExists = await fs.stat(path.join(tempDir, '.git')).then(
      () => true,
      () => false
    );
    if (!gitDirExists) {
      await fs.mkdir(path.dirname(tempDir), { recursive: true });
      await checked(await $`gh repo clone ${`${owner}/${repo}`} ${tempDir} -- --filter=blob:none`, 'Clone repository');
    } else {
      const status = await checked(await $({ ...QUIET_PROBE, cwd: tempDir })`git status --porcelain --untracked-files=no`, 'Check working directory');
      if (status.trim()) throw new Error('Review requires a working directory without changes to tracked files');
    }
    await checked(await $({ cwd: tempDir })`gh pr checkout ${prUrl}`, 'Check out pull request');
    const checkoutSha = (await checked(await $({ ...QUIET_PROBE, cwd: tempDir })`git rev-parse HEAD`, 'Read checkout commit')).trim();
    if (checkoutSha !== prDetails.headRefOid) throw new Error('The pull request head changed during preparation; run review again to review the current commit');
    const diff = await checked(await $(QUIET_PROBE)`gh pr diff ${prUrl}`, 'Get pull request diff');
    const diffFile = path.join(contextDir, 'pr-diff.patch');
    await fs.writeFile(diffFile, diff);
    const prompts = buildReviewPrompts({ ...target, prUrl, tempDir, diffFile, headSha: checkoutSha, argv });
    await fs.writeFile(path.join(contextDir, 'review-prompts.json'), JSON.stringify(prompts, null, 2));
    if (argv.dryRun || argv.onlyPrepareCommand) {
      await log(`✅ Review prepared. Prompts and diff: ${contextDir}`);
      return { success: true, prepared: true, tempDir, contextDir };
    }
    const login = (await checked(await $(QUIET_PROBE)`gh api user --jq .login`, 'Identify reviewer')).trim();
    const existingReviews = JSON.parse(await checked(await $(QUIET_PROBE)`gh api ${reviewsEndpoint} --paginate --slurp`, 'Get existing reviews')).flat();
    const result = await executeTool({
      ...toolContext,
      $,
      log,
      argv: { ...argv, url: prUrl },
      tempDir,
      workspaceTmpDir: contextDir,
      owner,
      repo,
      prNumber,
      prUrl,
      branchName: prDetails.headRefName,
      forkedRepo: null,
      feedbackLines: [],
      ...prompts,
    });
    keepDirectory ||= Boolean(result.sessionId || result.limitReached || !result.success);
    if (result.sessionId) {
      await log(`Session: ${result.sessionId}`);
      await log(`Resume: ${buildReviewResumeCommand({ prUrl, sessionId: result.sessionId, tempDir, argv })}`);
    }
    // Review runners must never feed accidental edits into solve's commit/restart flow.
    const finalSha = (await checked(await $({ ...QUIET_PROBE, cwd: tempDir })`git rev-parse HEAD`, 'Verify checkout commit')).trim();
    const trackedStatus = await checked(await $({ ...QUIET_PROBE, cwd: tempDir })`git status --porcelain --untracked-files=no`, 'Verify review-only checkout');
    if (finalSha !== checkoutSha || trackedStatus.trim()) {
      keepDirectory = true;
      throw new Error(`The review tool modified tracked code or commits. No automatic commit or push was performed. Inspect ${tempDir}`);
    }
    if (result.limitReached) {
      await log('⏰ Tool usage limit reached; the working directory is preserved for resume.');
      return { ...result, success: false, tempDir, contextDir };
    }
    if (!result.success) return { ...result, tempDir, contextDir };
    const reviews = JSON.parse(await checked(await $(QUIET_PROBE)`gh api ${reviewsEndpoint} --paginate --slurp`, 'Verify submitted review')).flat();
    const currentHead = JSON.parse(await checked(await $(QUIET_PROBE)`gh pr view ${prUrl} --json headRefOid`, 'Verify current pull request head')).headRefOid;
    if (currentHead !== checkoutSha) throw new Error('The pull request head changed during review; run review again for the current commit');
    const submitted = getNewSubmittedReviews(reviews, { existingIds: existingReviews.map(review => review.id), login, headSha: currentHead });
    if (!submitted.length) {
      keepDirectory = true;
      throw new Error('No new submitted review by the current user was found for the current PR head; the review is incomplete');
    }
    for (const review of submitted) await log(`✅ ${review.state}: ${review.html_url || prUrl}`);
    return { ...result, reviews: submitted, tempDir, contextDir };
  } catch (error) {
    keepDirectory = true;
    throw error;
  } finally {
    if (keepDirectory) await log(`📁 Review context preserved: ${contextDir}`);
    else await fs.rm(contextDir, { recursive: true, force: true });
  }
}
