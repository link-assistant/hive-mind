#!/usr/bin/env node

/**
 * GitHub Issue Solver using OpenCode AI
 *
 * This script automatically solves GitHub issues using the OpenCode AI tool.
 * It clones the repository, creates a feature branch, runs OpenCode to solve the issue,
 * and creates a pull request with the solution.
 *
 * Usage:
 *   ./solve-with-opencode.mjs <github-issue-url>
 *
 * Example:
 *   ./solve-with-opencode.mjs https://github.com/owner/repo/issues/123
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const crypto = await import('crypto');
const fs = (await import('fs')).promises;
const path = await import('path');
const os = await import('os');

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('GitHub Issue Solver with OpenCode AI');
  console.log('Usage: ./solve-with-opencode.mjs <github-issue-url> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --base-branch <branch>  Target branch for the pull request (defaults to repository default)');
  console.log('  -b <branch>             Alias for --base-branch');
  console.log('  -h, --help              Show this help message');
  console.log('');
  console.log('Example:');
  console.log('  ./solve-with-opencode.mjs https://github.com/owner/repo/issues/123');
  console.log('  ./solve-with-opencode.mjs https://github.com/owner/repo/issues/123 --base-branch develop');
  process.exit(0);
}

// Parse GitHub issue URL and options
const issueUrl = args[0];
let baseBranch = null;

// Parse additional options
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--base-branch' || args[i] === '-b') {
    if (i + 1 < args.length) {
      baseBranch = args[i + 1];
      i++; // Skip next arg as it's the value
    } else {
      console.error('Error: --base-branch requires a value');
      process.exit(1);
    }
  }
}
const urlMatch = issueUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/);

if (!urlMatch) {
  console.error('Error: Invalid GitHub issue URL format');
  console.error('Expected format: https://github.com/owner/repo/issues/123');
  process.exit(1);
}

const [, owner, repo, issueNumber] = urlMatch;

// Create temporary directory for the work
const tempDir = path.join(os.tmpdir(), `gh-issue-solver-opencode-${Date.now()}`);
console.log(`Creating temporary directory: ${tempDir}\n`);
await fs.mkdir(tempDir, { recursive: true });

try {
  // Clone the repository using gh tool with authentication (full clone for proper git history)
  console.log(`Cloning repository ${owner}/${repo} using gh tool...\n`);
  const cloneResult = await $`gh repo clone ${owner}/${repo} ${tempDir}`;

  // Verify clone was successful
  if (cloneResult.code !== 0) {
    console.error(`Error: Failed to clone repository`);
    console.error(cloneResult.stderr ? cloneResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  console.log(`Repository cloned successfully to ${tempDir}\n`);

  // Set up git authentication using gh
  const authSetupResult = await $`cd ${tempDir} && gh auth setup-git 2>&1`;
  if (authSetupResult.code !== 0) {
    console.log('Note: gh auth setup-git had issues, continuing anyway\n');
  }

  // Verify we're on the default branch and get its name
  const defaultBranchResult = await $`cd ${tempDir} && git branch --show-current`;

  if (defaultBranchResult.code !== 0) {
    console.error(`Error: Failed to get current branch`);
    console.error(defaultBranchResult.stderr ? defaultBranchResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  console.log(`\n`);

  let defaultBranch = defaultBranchResult.stdout.toString().trim();

  // Fallback if branch detection fails
  if (!defaultBranch) {
    console.log('Warning: Could not detect default branch, assuming "main"\n');
    defaultBranch = 'main';
  } else {
    console.log(`Default branch detected: ${defaultBranch}\n`);
  }

  console.log(`\n`);
  console.log(`\n`);
  console.log(`\n`);

  // Verify repository is not empty
  const statusResult = await $`cd ${tempDir} && git status --porcelain`;

  if (statusResult.code !== 0) {
    console.error(`Error: Failed to check git status`);
    console.error(statusResult.stderr ? statusResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  // Note: Empty output means clean working directory
  const statusOutput = statusResult.stdout.toString().trim();
  if (statusOutput) {
    console.error(`Error: Repository has uncommitted changes after clone`);
    console.error(`Status output: ${statusOutput}`);
    process.exit(1);
  }

  console.log('\n');

  // Create a branch for the issue
  const randomHex = crypto.randomBytes(4).toString('hex');
  const branchName = `issue-${issueNumber}-${randomHex}`;
  console.log(`Creating branch: ${branchName} from ${defaultBranch}\n`);
  const checkoutResult = await $`cd ${tempDir} && git checkout -b ${branchName}`;

  if (checkoutResult.code !== 0) {
    console.error(`Error: Failed to create branch ${branchName}:`);
    console.error(checkoutResult.stderr ? checkoutResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  console.log(`✓ Successfully created branch: ${branchName}`);

  // Verify we're on the correct branch
  const currentBranchResult = await $`cd ${tempDir} && git branch --show-current`;

  if (currentBranchResult.code !== 0) {
    console.error(`Error: Failed to verify current branch`);
    console.error(currentBranchResult.stderr ? currentBranchResult.stderr.toString() : 'Unknown error');
    process.exit(1);
  }

  const currentBranch = currentBranchResult.stdout.toString().trim();
  if (currentBranch !== branchName) {
    console.log('\n');
    console.error(`Error: Failed to switch to branch ${branchName}, currently on ${currentBranch}\n`);
    process.exit(1);
  }
  console.log(`✓ Successfully switched to branch: ${branchName}`);

  // Determine the target branch for the PR
  const targetBranch = baseBranch || defaultBranch;
  if (baseBranch) {
    console.log(`\nUsing custom base branch: ${targetBranch}`);
  } else {
    console.log(`\nUsing default base branch: ${targetBranch}`);
  }

  // Prepare the prompt for OpenCode
  // Note: OpenCode might have different prompt structure than Claude
  // This is a draft that will need adjustment based on OpenCode's actual CLI interface
  const prompt = `1. Initial research.  
   - When you read issue, read all details and comments thoroughly.  
   - When you need issue details, use gh issue view ${issueUrl}.  
   - When you need related code, use gh search code --owner ${owner} [keywords].  
   - When you need repo context, read files in ${tempDir}.  
   - When you study related work, study related previous latest pull requests.  
   - When you need examples of style, use gh pr list --repo ${owner}/${repo} --state merged --search [keywords].  
   - When issue is not defined enough, write a comment to ask clarifying questions.  

2. Solution development and testing.  
   - When issue is solvable, implement code with tests.  
   - When you test, start from small functions.  
   - When you test, write unit tests with mocks.  
   - When you test integrations, use existing framework.  
   - When you test solution, include automated checks in pr.  
   - When issue is unclear, write comment on issue asking questions.  

3. Preparing pull request.  
   - When you finalize the pull request, follow style from merged prs for code, title, and description, and double-check the logic of all conditions and statements.  
   - When you code, follow contributing guidelines.  
   - When you commit, write clear message.  
   - When you open pr, describe solution and include tests.
   - When there is a package with version and GitHub Actions workflows for automatic release, update the version (or other necessary release trigger) in your pull request to prepare for next release.

4. Workflow and collaboration.
   - When you check branch, verify with git branch --show-current.
   - When you push, push only to branch ${branchName}.
   - When you finish, create a pull request from branch ${branchName} to base branch ${targetBranch}.  
   - When you organize workflow, use pull requests instead of direct merges to main or master branches.  
   - When you manage commits, preserve commit history for later analysis.  
   - When you contribute, keep repository history forward-moving with regular commits, pushes, and reverts if needed.  
   - When you face conflict, ask for help.  
   - When you collaborate, respect branch protections by working only on ${branchName}.  
   - When you mention result, include pull request url or comment url.  

5. Self review.  
   - When you check your solution, run all tests locally.  
   - When you compare with repo style, use gh pr diff [number].  
   - When you finalize, confirm code, tests, and description are consistent.  `;

  const systemPrompt = `You are AI issue solver.
When you execute commands, always save their logs to files for easy reading if the output gets large.
When running commands, do not set a timeout yourself — let them run as long as needed (default timeout - 2 minutes is more than enough, if you can set 4 minutes), and once they finish, review the logs in the file.
When CI is failing, make sure you download the logs locally and carefully investigate them.
When a code or log file has more than 2500 lines, read it in chunks of 2500 lines.
When facing a complex problem, do as much tracing as possible and turn on all verbose modes.
When you create debug, test, or example scripts for fixing, always keep them in an examples folder so you can reuse them later.
When testing your assumptions, use the example scripts.
When you face something extremely hard, use divide and conquer — it always helps.`;

  // Get timestamp info from issue
  console.log('Getting reference timestamps from GitHub...');
  const issueInfoResult = await $`gh issue view ${issueUrl} --json updatedAt --jq .updatedAt`;

  if (issueInfoResult.code !== 0) {
    console.error('Warning: Could not get issue timestamp');
  } else {
    const issueUpdatedAt = issueInfoResult.stdout.toString().trim();
    console.log(`  Issue last updated: ${new Date(issueUpdatedAt).toISOString()}`);
  }

  // Check for existing comments
  const commentsResult = await $`gh issue view ${issueUrl} --json comments --jq '.comments[] | .url'`;
  const commentUrls = commentsResult.code === 0 ? commentsResult.stdout.toString().trim().split('\n').filter(Boolean) : [];
  console.log(`  ${commentUrls.length > 0 ? commentUrls : '[]'}  ${commentUrls.length > 0 ? `${commentUrls.length} comments found` : 'No comments found on issue'}`);

  // Check for existing PRs
  const prsResult = await $`gh pr list --repo ${owner}/${repo} --json url --jq '.[].url'`;
  const prUrls = prsResult.code === 0 ? prsResult.stdout.toString().trim().split('\n').filter(Boolean) : [];
  console.log(`  ${prUrls.length > 0 ? prUrls : '[]'}`);
  console.log(`  ${prUrls.length > 0 ? `${prUrls.length} PRs found in repo` : 'No PRs found in repo'}`);

  console.log(`✓ Using reference timestamp: ${new Date().toISOString()}`);

  console.log('\nExecuting opencode command from repository directory...');

  // Create log file name with timestamp
  const logTimestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, 'Z');
  const logFile = path.join(process.cwd(), `solve-opencode-${logTimestamp}.log`);
  console.log(`📁 Log file: ${logFile}`);
  console.log(`   (You can tail -f this file to watch progress)`);

  // Build the OpenCode command using the 'run' subcommand for non-interactive mode
  // OpenCode run accepts a message/prompt and executes it without launching the TUI
  // We combine the system prompt and main prompt into a single comprehensive message

  const fullPrompt = `${systemPrompt}\n\nCurrent working directory: ${tempDir}\nBranch: ${branchName}\n\n${prompt}`;

  // Escape the prompt for shell execution
  const escapedPrompt = fullPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\$/g, '\\$');

  // Use opencode run for non-interactive execution with Grok Code Fast 1 (free model)
  // Note: OpenCode may need the GitHub agent installed: opencode github install
  const opencodeCommand = `cd "${tempDir}" && opencode run --model opencode/grok-code "${escapedPrompt}" 2>&1 | tee "${logFile}"`;

  console.log('\n📋 Command prepared:');
  console.log(`   Working directory: ${tempDir}`);
  console.log(`   Branch: ${branchName}`);
  console.log(`   Model: opencode/grok-code (Grok Code Fast 1 - Free)`);
  console.log(`   Using opencode run for non-interactive execution`);

  // Execute OpenCode command
  // Using execSync to avoid command-stream issues with complex commands
  const { execSync } = await import('child_process');

  let sessionId = null;
  try {
    console.log('\n🔧 Starting OpenCode session...');

    // Execute the command
    const output = execSync(`cd "${tempDir}" && ${opencodeCommand}`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 100, // 100MB buffer for large outputs
      stdio: 'pipe',
    });

    // Try to extract session ID from output (adjust based on OpenCode's actual output format)
    const sessionMatch = output.match(/session[_-]?id[:\s]+([a-f0-9-]+)/i);
    if (sessionMatch) {
      sessionId = sessionMatch[1];
      console.log(`🔧 Session ID: ${sessionId}`);

      // Rename log file to include session ID if found
      const sessionLogFile = path.join(process.cwd(), `${sessionId}.log`);
      await fs.rename(logFile, sessionLogFile).catch(() => {});
      console.log(`📁 Log renamed to: ${sessionLogFile}`);
    }

    console.log('\n🚀 OpenCode session started');
    console.log('📊 Model: Grok Code Fast 1 (Free)');

    // Parse output to check for success (adjust based on OpenCode's actual output)
    if (output.includes('error') || output.includes('failed')) {
      console.error('\n⚠️  OpenCode reported errors, check the log file for details');
    } else {
      console.log('\n✅ OpenCode command completed successfully');
    }
  } catch (error) {
    console.error('\n❌ OpenCode command failed:');
    console.error(error.message);
    console.error('\n📄 Check the log file for detailed error information');
    process.exit(1);
  }

  // Display session continuation info
  if (sessionId) {
    console.log('\n=== Session Summary ===');
    console.log(`✅ Session ID: ${sessionId}`);
    console.log(`✅ Complete log file: ${path.join(process.cwd(), `${sessionId}.log`)}`);

    console.log('\n💡 To continue this session in OpenCode interactive mode:');
    console.log('');
    console.log(`cd ${tempDir}`);
    console.log(`opencode --resume ${sessionId}`);
    console.log('');
    console.log('   or from any directory:');
    console.log('');
    console.log(`opencode --resume ${sessionId} --working-directory ${tempDir}`);
    console.log('');
  }

  // Search for created pull requests or comments
  console.log('\n🔍 Searching for created pull requests or comments...');

  // Check for the authenticated user
  const userResult = await $`gh api user --jq .login`;
  const githubUser = userResult.code === 0 ? userResult.stdout.toString().trim() : 'unknown';
  console.log(githubUser);

  // Check for new pull requests from our branch
  process.stdout.write('  Checking for pull requests...');
  const newPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number,url,createdAt,headRefName --jq '.'`;

  if (newPrsResult.code === 0) {
    const newPrs = newPrsResult.stdout.toString().trim();

    if (newPrs && newPrs !== '[]') {
      const prsArray = JSON.parse(newPrs);
      process.stdout.write(newPrs);
      console.log(' ✅');

      if (prsArray.length > 0) {
        const pr = prsArray[0];
        console.log('\n🎉 SUCCESS: Pull Request created!');
        console.log(`📍 URL: ${pr.url}`);
        console.log('\n✨ The issue has been solved and a PR has been created.');
      }
    } else {
      console.log('none found');

      // Check for new comments on the issue
      process.stdout.write('  Checking for new comments...');
      const newCommentsResult = await $`gh issue view ${issueUrl} --json comments --jq '.comments[-1].url // empty'`;

      if (newCommentsResult.code === 0 && newCommentsResult.stdout.toString().trim()) {
        const commentUrl = newCommentsResult.stdout.toString().trim();
        console.log(' ✅');
        console.log(`\n💬 New comment added: ${commentUrl}`);
        console.log('\n✨ OpenCode has added a comment to the issue.');
      } else {
        console.log('none found');
        console.log('\n⚠️  No pull request or comment was created.');
        console.log('   OpenCode may have encountered an issue or may still be working.');
        console.log('   Check the log file for details.');
      }
    }
  } else {
    console.log('error checking');
    console.log('\n⚠️  Could not check for pull requests');
  }
} catch (error) {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
}
