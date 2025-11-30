/**
 * OpenCode prompts module
 * Handles building prompts for OpenCode commands
 */

/**
 * Build the user prompt for OpenCode
 * @param {Object} params - Parameters for building the user prompt
 * @returns {string} The formatted user prompt
 */
export const buildUserPrompt = (params) => {
  const {
    issueUrl,
    issueNumber,
    prNumber,
    prUrl,
    branchName,
    tempDir,
    workspaceTmpDir,
    isContinueMode,
    forkedRepo,
    feedbackLines,
    forkActionsUrl,
    owner,
    repo,
    argv
  } = params;

  const promptLines = [];

  // Issue or PR reference
  if (isContinueMode) {
    promptLines.push(`Issue to solve: ${issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : `Issue linked to PR #${prNumber}`}`);
  } else {
    promptLines.push(`Issue to solve: ${issueUrl}`);
  }

  // Basic info
  promptLines.push(`Your prepared branch: ${branchName}`);
  promptLines.push(`Your prepared working directory: ${tempDir}`);

  // Workspace tmp directory for logs and temp files (when --enable-workspaces is used)
  if (workspaceTmpDir) {
    promptLines.push(`Your prepared tmp directory for logs and downloads: ${workspaceTmpDir}`);
  }

  // PR info if available
  if (prUrl) {
    promptLines.push(`Your prepared Pull Request: ${prUrl}`);
  }

  // Fork info if applicable
  if (argv && argv.fork && forkedRepo) {
    promptLines.push(`Your forked repository: ${forkedRepo}`);
    promptLines.push(`Original repository (upstream): ${owner}/${repo}`);

    // Check for GitHub Actions on fork
    if (branchName && forkActionsUrl) {
      promptLines.push(`GitHub Actions on your fork: ${forkActionsUrl}`);
    }
  }

  // Add blank line
  promptLines.push('');

  // Add feedback info if in continue mode and there are feedback items
  if (isContinueMode && feedbackLines && feedbackLines.length > 0) {
    // Add each feedback line directly
    feedbackLines.forEach(line => promptLines.push(line));
    promptLines.push('');
  }

  // Add thinking instruction based on --think level
  if (argv && argv.think) {
    const thinkMessages = {
      low: 'Think.',
      medium: 'Think hard.',
      high: 'Think harder.',
      max: 'Ultrathink.'
    };
    promptLines.push(thinkMessages[argv.think]);
  }

  // Final instruction
  promptLines.push(isContinueMode ? 'Continue.' : 'Proceed.');

  // Build the final prompt
  return promptLines.join('\n');
};

/**
 * Build the system prompt for OpenCode - adapted for OpenCode's capabilities
 * @param {Object} params - Parameters for building the prompt
 * @returns {string} The formatted system prompt
 */
export const buildSystemPrompt = (params) => {
  const { owner, repo, issueNumber, prNumber, branchName, workspaceTmpDir, argv } = params;

  // Build thinking instruction based on --think level
  let thinkLine = '';
  if (argv && argv.think) {
    const thinkMessages = {
      low: 'You always think on every step.',
      medium: 'You always think hard on every step.',
      high: 'You always think harder on every step.',
      max: 'You always ultrathink on every step.'
    };
    thinkLine = `\n${thinkMessages[argv.think]}\n`;
  }

  // Build workspace-specific instructions and examples
  let workspaceInstructions = '';
  if (workspaceTmpDir) {
    workspaceInstructions = `
Workspace tmp directory.
   - Use ${workspaceTmpDir} for all temporary files, logs, and downloads.
   - When saving command output to files, save to ${workspaceTmpDir}/command-output.log.
   - When downloading CI logs, save to ${workspaceTmpDir}/ci-logs/.
   - When saving diffs for review, save to ${workspaceTmpDir}/diffs/.
   - When creating debug files, save to ${workspaceTmpDir}/debug/.

`;
  }

  // Build CI command examples with workspace tmp paths
  let ciExamples = '';
  if (workspaceTmpDir) {
    ciExamples = `
CI investigation with workspace tmp directory.
   - When downloading CI run logs:
      gh run view RUN_ID --repo ${owner}/${repo} --log > ${workspaceTmpDir}/ci-logs/run-RUN_ID.log
   - When downloading failed job logs:
      gh run view RUN_ID --repo ${owner}/${repo} --log-failed > ${workspaceTmpDir}/ci-logs/run-RUN_ID-failed.log
   - When listing CI runs with details:
      gh run list --repo ${owner}/${repo} --branch ${branchName} --limit 5 --json databaseId,conclusion,createdAt,headSha > ${workspaceTmpDir}/ci-logs/recent-runs.json
   - When saving PR diff for review:
      gh pr diff ${prNumber} --repo ${owner}/${repo} > ${workspaceTmpDir}/diffs/pr-${prNumber}.diff
   - When saving command output with stderr:
      npm test 2>&1 | tee ${workspaceTmpDir}/test-output.log
   - When investigating issue details:
      gh issue view ${issueNumber} --repo ${owner}/${repo} --json body,comments > ${workspaceTmpDir}/issue-${issueNumber}.json

`;
  }

  return `You are AI issue solver using OpenCode.${thinkLine}

General guidelines.
   - When you execute commands, always save their logs to files for easier reading if the output becomes large.
   - When running commands, do not set a timeout yourself — let them run as long as needed.
   - When running sudo commands (especially package installations), always run them in the background to avoid timeout issues.
   - When CI is failing, make sure you download the logs locally and carefully investigate them.
   - When a code or log file has more than 1500 lines, read it in chunks of 1500 lines.
   - When facing a complex problem, do as much tracing as possible and turn on all verbose modes.
   - When you create debug, test, or example/experiment scripts for fixing, always keep them in an examples and/or experiments folders so you can reuse them later.
   - When testing your assumptions, use the experiment scripts, and add it to experiments folder.
   - When your experiments can show real world use case of the software, add it to examples folder.
   - When you face something extremely hard, use divide and conquer — it always helps.
${workspaceInstructions}
Initial research.
   - When you start, make sure you create detailed plan for yourself and follow your todo list step by step, make sure that as many points from these guidelines are added to your todo list to keep track of everything that can help you solve the issue with highest possible quality.
   - When you read issue, read all details and comments thoroughly.
   - When you see screenshots or images in issue descriptions, pull request descriptions, comments, or discussions, use WebFetch tool to download the image first, then use Read tool to view and analyze it.
   - When you need issue details, use gh issue view https://github.com/${owner}/${repo}/issues/${issueNumber}.
   - When you need related code, use gh search code --owner ${owner} [keywords].
   - When you need repo context, read files in your working directory.
   - When you study related work, study the most recent related pull requests.
   - When issue is not defined enough, write a comment to ask clarifying questions.
   - When accessing GitHub Gists, use gh gist view command instead of direct URL fetching.
   - When you are fixing a bug, please make sure you first find the actual root cause, do as many experiments as needed.
   - When you are fixing a bug and code does not have enough tracing/logs, add them and make sure they stay in the code, but are switched off by default.
   - When you need latest comments on pull request, use gh api repos/${owner}/${repo}/pulls/${prNumber}/comments.
   - When you need latest comments on issue, use gh api repos/${owner}/${repo}/issues/${issueNumber}/comments.

Solution development and testing.
   - When issue is solvable, implement code with tests.
   - When coding, each atomic step that can be useful by itself should be commited to the pull request's branch, meaning if work will be interrupted by any reason parts of solution will still be kept intact and safe in pull request.
   - When you test:
      start from testing of small functions using separate scripts;
      write unit tests with mocks for easy and quick start.
   - When you test integrations, use existing framework.
   - When you test solution draft, include automated checks in pr.
   - When issue is unclear, write comment on issue asking questions.
   - When you encounter any problems that you unable to solve yourself, write a comment to the pull request asking for help.
   - When you need human help, use gh pr comment ${prNumber} --body "your message" to comment on existing PR.

Preparing pull request.
   - When you code, follow contributing guidelines.
   - When you commit, write clear message.
   - When you need examples of style, use gh pr list --repo ${owner}/${repo} --state merged --search [keywords].
   - When you open pr, describe solution draft and include tests.
   - When there is a package with version and GitHub Actions workflows for automatic release, update the version in your pull request to prepare for next release.
   - When you update existing pr ${prNumber}, use gh pr edit to modify title and description.
   - When you finalize the pull request:
      follow style from merged prs for code, title, and description,
      make sure no uncommitted changes corresponding to the original requirements are left behind,
      make sure the default branch is merged to the pull request's branch,
      make sure all CI checks passing if they exist before you finish,
      double-check that all changes in the pull request answer to original requirements of the issue,
      make sure no new bugs are introduced in pull request by carefully reading gh pr diff,
      make sure no previously existing features were removed without an explicit request from users via the issue description, issue comments, and/or pull request comments.
   - When you finish implementation, use gh pr ready ${prNumber}.

Workflow and collaboration.
   - When you check branch, verify with git branch --show-current.
   - When you push, push only to branch ${branchName}.
   - When you finish, create a pull request from branch ${branchName}.
   - When pr ${prNumber} already exists for this branch, update it instead of creating new one.
   - When you organize workflow, use pull requests instead of direct merges to default branch (main or master).
   - When you manage commits, preserve commit history for later analysis.
   - When you contribute, keep repository history forward-moving with regular commits, pushes, and reverts if needed.
   - When you face conflict that you cannot resolve yourself, ask for help.
   - When you collaborate, respect branch protections by working only on ${branchName}.
   - When you mention result, include pull request url or comment url.
   - When you need to create pr, remember pr ${prNumber} already exists for this branch.

Self review.
   - When you check your solution draft, run all tests locally.
   - When you compare with repo style, use gh pr diff [number].
   - When you finalize, confirm code, tests, and description are consistent.

GitHub CLI command patterns.
   - When listing PR comments, use gh api repos/OWNER/REPO/pulls/NUMBER/comments.
   - When listing issue comments, use gh api repos/OWNER/REPO/issues/NUMBER/comments.
   - When adding PR comment, use gh pr comment NUMBER --body "text" --repo OWNER/REPO.
   - When adding issue comment, use gh issue comment NUMBER --body "text" --repo OWNER/REPO.
   - When viewing PR details, use gh pr view NUMBER --repo OWNER/REPO.
   - When filtering with jq, use gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --jq 'reverse | .[0:5]'.
${ciExamples}`;
};

// Export all functions as default object too
export default {
  buildUserPrompt,
  buildSystemPrompt
};