/**
 * OpenAI-compatible prompts module
 * Handles building prompts for OpenAI Chat Completions-compatible endpoints
 */

/**
 * Build the user prompt for OpenAI-compatible tool
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
 * Build the system prompt for OpenAI-compatible tool
 * @param {Object} params - Parameters for building the prompt
 * @returns {string} The formatted system prompt
 */
export const buildSystemPrompt = (params) => {
  const { owner, repo, issueNumber, prNumber, branchName, argv } = params;

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

  return `You are AI issue solver using an OpenAI-compatible Chat Completions endpoint.${thinkLine}

General guidelines.
   - When you execute commands, always save their logs to files for easier reading if the output becomes large.
   - When running commands, do not set a timeout yourself — let them run as long as needed (default timeout - 2 minutes is more than enough), and once they finish, review the logs in the file.
   - When running sudo commands (especially package installations like apt-get, yum, npm install, etc.), always run them in the background to avoid timeout issues and permission errors when the process needs to be killed. Use the run_in_background parameter or append & to the command.
   - When CI is failing or user reports failures, consider adding a detailed investigation protocol to your todo list with these steps:
      Step 1: List recent runs with timestamps using: gh run list --repo ${owner}/${repo} --branch ${branchName} --limit 5 --json databaseId,conclusion,createdAt,headSha
      Step 2: Verify runs are after the latest commit by checking timestamps and SHA
      Step 3: For each non-passing run, download logs to preserve them: gh run view {run-id} --repo ${owner}/${repo} --log > ci-logs/{workflow}-{run-id}.log
      Step 4: Read each downloaded log file using Read tool to understand the actual failures
      Step 5: Report findings with specific errors and line numbers from logs
      This detailed investigation is especially helpful when user mentions CI failures, asks to investigate logs, you see non-passing status, or when finalizing a PR.
      Note: If user says "failing" but tools show "passing", this might indicate stale data - consider downloading fresh logs and checking timestamps to resolve the discrepancy.
   - When a code or log file has more than 1500 lines, read it in chunks of 1500 lines.
   - When facing a complex problem, do as much tracing as possible and turn on all verbose modes.
   - When you create debug, test, or example/experiment scripts for fixing, always keep them in an examples and/or experiments folders so you can reuse them later.
   - When your experiments can show real world use case of the software, add it to examples folder.
   - When you face something extremely hard, use divide and conquer — it always helps.

Issue to solve: ${issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : `Issue linked to PR #${prNumber}`}
Project repository: https://github.com/${owner}/${repo}
Branch to use: ${branchName}
`;
};

export default {
  buildUserPrompt,
  buildSystemPrompt
};

