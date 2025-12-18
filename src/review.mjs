#!/usr/bin/env node

// Early exit paths - handle these before loading all modules to speed up testing
const earlyArgs = process.argv.slice(2);

if (earlyArgs.includes('--version')) {
  const { getVersion } = await import('./version.lib.mjs');
  try {
    const version = await getVersion();
    console.log(version);
  } catch {
    console.error('Error: Unable to determine version');
    process.exit(1);
  }
  process.exit(0);
}

if (earlyArgs.includes('--help') || earlyArgs.includes('-h')) {
  // Show help and exit
  console.log('Usage: review.mjs <pr-url> [options]');
  console.log('\nOptions:');
  console.log('  --version          Show version number');
  console.log('  --help, -h         Show help');
  console.log('  --resume, -r       Resume from a previous session ID');
  console.log('  --dry-run, -n      Prepare everything but do not execute Claude');
  console.log('  --model, -m        Model to use (opus, sonnet, or full model ID) [default: opus]');
  console.log('  --focus, -f        Focus areas for review [default: all]');
  console.log('  --approve          If review passes, approve the PR');
  console.log('  --verbose, -v      Enable verbose logging');
  process.exit(0);
}

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const yargs = (await use('yargs@latest')).default;
const os = (await use('os')).default;
const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Import shared functions from lib.mjs to follow DRY principle
import { log, setLogFile, getLogFile, formatAligned } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import * as memoryCheck from './memory-check.mjs';

// Import Claude execution functions
import { executeClaudeCommand } from './claude.lib.mjs';

// Configure command line arguments - GitHub PR URL as positional argument
// Use yargs().parse(args) instead of yargs(args).argv to ensure .strict() mode works
const argv = yargs()
  .usage('Usage: $0 <pr-url> [options]')
  .positional('pr-url', {
    type: 'string',
    description: 'The GitHub pull request URL to review'
  })
  .option('resume', {
    type: 'string',
    description: 'Resume from a previous session ID (when limit was reached)',
    alias: 'r'
  })
  .option('dry-run', {
    type: 'boolean',
    description: 'Prepare everything but do not execute Claude',
    alias: 'n'
  })
  .option('model', {
    type: 'string',
    description: 'Model to use (opus, sonnet, or full model ID like claude-sonnet-4-5-20250929)',
    alias: 'm',
    default: 'opus',
    choices: ['opus', 'sonnet', 'claude-sonnet-4-5-20250929', 'claude-opus-4-5-20251101']
  })
  .option('focus', {
    type: 'string',
    description: 'Focus areas for review (security, performance, logic, style, tests)',
    alias: 'f',
    default: 'all'
  })
  .option('approve', {
    type: 'boolean',
    description: 'If review passes, approve the PR',
    default: false
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging for debugging',
    alias: 'v',
    default: false
  })
  .demandCommand(1, 'The GitHub pull request URL is required')
  .parserConfiguration({
    'boolean-negation': true
  })
  .help('h')
  .alias('h', 'help')
  // Use yargs built-in strict mode to reject unrecognized options
  // This prevents issues like #453 and #482 where unknown options are silently ignored
  .strict()
  .parse(process.argv.slice(2));

const prUrl = argv['pr-url'] || argv._[0];

// Set global verbose mode for log function
global.verboseMode = argv.verbose;

// Create permanent log file immediately with timestamp
const scriptDir = path.dirname(process.argv[1]);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFilePath = path.join(scriptDir, `review-${timestamp}.log`);
setLogFile(logFilePath);

// Create the log file immediately
await fs.writeFile(logFilePath, `# Review.mjs Log - ${new Date().toISOString()}\n\n`);
await log(`📁 Log file: ${logFilePath}`);
await log('   (All output will be logged here)\n');

// Validate GitHub PR URL format
if (!prUrl.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/)) {
  await log('Error: Please provide a valid GitHub pull request URL (e.g., https://github.com/owner/repo/pull/123)', { level: 'error' });
  process.exit(1);
}

const claudePath = process.env.CLAUDE_PATH || 'claude';

// Extract repository and PR number from URL
const urlParts = prUrl.split('/');
const owner = urlParts[3];
const repo = urlParts[4];
const prNumber = urlParts[6];

// Create or find temporary directory for cloning the repository
let tempDir;
let isResuming = argv.resume;

if (isResuming) {
  // When resuming, try to find existing directory or create a new one
  const scriptDir = path.dirname(process.argv[1]);
  const sessionLogPattern = path.join(scriptDir, `${argv.resume}.log`);

  try {
    // Check if session log exists to verify session is valid
    await fs.access(sessionLogPattern);
    await log(`🔄 Resuming session ${argv.resume} (session log found)`);

    // For resumed sessions, create new temp directory since old one may be cleaned up
    tempDir = path.join(os.tmpdir(), `gh-pr-reviewer-resume-${argv.resume}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await log(`Creating new temporary directory for resumed session: ${tempDir}`);
  } catch (err) {
    reportError(err, {
      context: 'resume_session_lookup',
      sessionId: argv.resume
    });
    await log(`Warning: Session log for ${argv.resume} not found, but continuing with resume attempt`);
    tempDir = path.join(os.tmpdir(), `gh-pr-reviewer-resume-${argv.resume}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await log(`Creating temporary directory for resumed session: ${tempDir}`);
  }
} else {
  tempDir = path.join(os.tmpdir(), `gh-pr-reviewer-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  await log(`Creating temporary directory: ${tempDir}\n`);
}

let limitReached = false;

try {
  // Get PR details first
  await log('📊 Getting pull request details...');
  const prDetailsResult = await $`gh pr view ${prUrl} --json title,body,headRefName,baseRefName,author,number,state,files`;
  
  if (prDetailsResult.code !== 0) {
    await log('Error: Failed to get PR details', { level: 'error' });
    await log(prDetailsResult.stderr ? prDetailsResult.stderr.toString() : 'Unknown error', { level: 'error' });
    process.exit(1);
  }
  
  const prDetails = JSON.parse(prDetailsResult.stdout.toString());
  
  await log(`\n📄 Pull Request: #${prDetails.number} - ${prDetails.title}`);
  await log(`👤 Author: ${prDetails.author.login}`);
  await log(`🌿 Branch: ${prDetails.headRefName} → ${prDetails.baseRefName}`);
  await log(`📊 State: ${prDetails.state}`);
  await log(`📝 Files changed: ${prDetails.files.length}`);

  // Clone the repository using gh tool with authentication
  await log(`\nCloning repository ${owner}/${repo} using gh tool...\n`);
  const cloneResult = await $`gh repo clone ${owner}/${repo} ${tempDir}`;
  
  // Verify clone was successful
  if (cloneResult.code !== 0) {
    await log('Error: Failed to clone repository', { level: 'error' });
    await log(cloneResult.stderr ? cloneResult.stderr.toString() : 'Unknown error', { level: 'error' });
    process.exit(1);
  }

  await log(`✅ Repository cloned successfully to ${tempDir}\n`);

  // Set up git authentication using gh
  const authSetupResult = await $`cd ${tempDir} && gh auth setup-git 2>&1`;
  if (authSetupResult.code !== 0) {
    await log('Note: gh auth setup-git had issues, continuing anyway\n');
  }

  // Fetch and checkout the PR branch
  await log(`🔀 Fetching and checking out PR branch: ${prDetails.headRefName}`);
  const fetchResult = await $`cd ${tempDir} && gh pr checkout ${prNumber}`;
  
  if (fetchResult.code !== 0) {
    await log('Error: Failed to checkout PR branch', { level: 'error' });
    await log(fetchResult.stderr ? fetchResult.stderr.toString() : 'Unknown error', { level: 'error' });
    process.exit(1);
  }
  
  await log('✅ Successfully checked out PR branch\n');

  // Get the diff for the PR
  await log('📝 Getting PR diff...');
  const diffResult = await $`gh pr diff ${prUrl}`;
  
  if (diffResult.code !== 0) {
    await log('Error: Failed to get PR diff', { level: 'error' });
    await log(diffResult.stderr ? diffResult.stderr.toString() : 'Unknown error', { level: 'error' });
    process.exit(1);
  }
  
  const prDiff = diffResult.stdout.toString();
  await log(`✅ Got PR diff (${prDiff.length} characters)\n`);

  // Save diff to a file for reference
  const diffFile = path.join(tempDir, 'pr-diff.patch');
  await fs.writeFile(diffFile, prDiff);
  await log(`📄 Diff saved to: ${diffFile}\n`);

  const prompt = `Pull request to review: ${prUrl}
PR Number: ${prNumber}
Repository: ${owner}/${repo}
Working directory: ${tempDir}
Diff file: ${diffFile}
Focus areas: ${argv.focus}
Auto-approve if passes: ${argv.approve}

Review this pull request thoroughly.`;

  const systemPrompt = `You are an expert code reviewer for pull requests.

0. General guidelines.
   - When you execute commands, always save their logs to files for easy reading if the output gets large.
   - When running commands, do not set a timeout yourself — let them run as long as needed.
   - When a code or log file has more than 2500 lines, read it in chunks of 2500 lines.
   - When reviewing, be thorough but constructive.
   - When suggesting improvements, provide specific code examples.

1. Initial analysis.
   - When you start, read the PR description using gh pr view ${prUrl}.
   - When you need the diff, read it from ${diffFile} or use gh pr diff ${prNumber}.
   - When you need file context, explore files in ${tempDir}.
   - When you check tests, run them if possible using existing test commands.
   - When you review commits, use gh pr view ${prNumber} --json commits.

2. Review focus areas.
   ${argv.focus === 'all' ? '- Review all aspects: logic, security, performance, style, tests, documentation.' : `- Focus specifically on: ${argv.focus}`}
   - When reviewing logic, check for edge cases and error handling.
   - When reviewing security, look for vulnerabilities and unsafe patterns.
   - When reviewing performance, identify bottlenecks and inefficiencies.
   - When reviewing style, ensure consistency with project conventions.
   - When reviewing tests, verify coverage and test quality.

3. Providing feedback.
   - When you find issues, create review comments using gh pr review ${prNumber} --comment.
   - When suggesting changes, use gh pr review ${prNumber} --comment with specific line references.
   - When code needs changes, provide suggestions with exact code snippets.
   - When adding line comments, use the format: path/to/file.ext:LINE_NUMBER
   - When creating suggestions, use GitHub's suggestion format in comments:
     \`\`\`suggestion
     improved code here
     \`\`\`

4. Review submission.
   - When review is complete, submit it using gh pr review ${prNumber} --${argv.approve ? 'approve' : 'comment'} --body "review summary".
   - When requesting changes, use gh pr review ${prNumber} --request-changes --body "summary of required changes".
   - When approving, only do so if code meets all quality standards.
   - When commenting, be specific about line numbers and files.

5. Line-specific comments.
   - When adding comments to specific lines, use gh api to post review comments.
   - When referencing lines, use the commit SHA from the PR.
   - When suggesting code changes, include the suggestion block format.
   - Example for line comment:
     gh api repos/${owner}/${repo}/pulls/${prNumber}/comments \\
       --method POST \\
       --field path="file.js" \\
       --field line=42 \\
       --field body="Comment text with suggestion" \\
       --field commit_id="SHA"

6. Best practices.
   - When reviewing, check for breaking changes.
   - When examining dependencies, verify versions and security.
   - When looking at tests, ensure they actually test the changes.
   - When reviewing documentation, verify it matches the code.
   - When finding issues, prioritize them by severity.
   - When suggesting improvements, explain why they're beneficial.`;

  // Properly escape prompts for shell usage - escape quotes and preserve newlines
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const escapedSystemPrompt = systemPrompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');

  // Execute claude command from the cloned repository directory
  await log(`\n🤖 Executing Claude (${argv.model.toUpperCase()}) for PR review...`);

  // If dry-run, exit here
  if (argv.dryRun) {
    await log('✅ Command preparation complete');
    await log(`📂 Repository cloned to: ${tempDir}`);
    await log(`🔀 PR branch checked out: ${prDetails.headRefName}`);
    process.exit(0);
  }

  // Change to the temporary directory before executing
  process.chdir(tempDir);

  // Use the shared executeClaudeCommand function from claude.lib.mjs
  // This ensures consistent NDJSON parsing, error handling, and retry logic across all commands
  const result = await executeClaudeCommand({
    tempDir,
    branchName: prDetails.headRefName,
    prompt,
    systemPrompt,
    escapedPrompt,
    escapedSystemPrompt,
    argv,
    log,
    setLogFile,
    getLogFile,
    formatAligned,
    getResourceSnapshot: memoryCheck.getResourceSnapshot,
    forkedRepo: null,
    feedbackLines: [],
    claudePath,
    $
  });

  const { success: commandSuccess, sessionId, limitReached: limitReachedResult } = result;
  limitReached = limitReachedResult;

  // Handle command failure
  if (!commandSuccess) {
    await log('\n❌ Command execution failed. Check the log file for details.');
    await log(`📁 Log file: ${getLogFile()}`);
    process.exit(1);
  }

  // Show summary of session and log file
  await log('\n=== Review Summary ===');

  if (sessionId) {
    await log(`✅ Session ID: ${sessionId}`);
    await log(`✅ Complete log file: ${getLogFile()}`);

    if (limitReached) {
      await log('\n⏰ LIMIT REACHED DETECTED!');
      await log('\n🔄 To resume when limit resets, use:\n');
      await log(`./review.mjs "${prUrl}" --resume ${sessionId}`);
      await log('\n   This will continue from where it left off with full context.\n');
    } else {
      // Check if review was submitted
      await log('\n🔍 Checking for submitted review...');
      
      try {
        // Get reviews for the PR
        const reviewsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews --jq '.[] | select(.user.login == "'$(gh api user --jq .login)'") | {state, submitted_at}'`;
        
        if (reviewsResult.code === 0 && reviewsResult.stdout.toString().trim()) {
          await log(`✅ Review has been submitted to PR #${prNumber}`);
          await log(`📍 View at: ${prUrl}`);
        } else {
          await log('ℹ️  Review may be pending or saved as draft');
        }
      } catch (error) {
        reportError(error, {
          context: 'verify_review_status',
          prNumber,
          level: 'warning'
        });
        await log('⚠️  Could not verify review status');
      }
      
      // Show command to resume session in interactive mode
      await log('\n💡 To continue this session in Claude Code interactive mode:\n');
      await log(`   (cd ${tempDir} && claude --resume ${sessionId})`);
      await log('');
    }
  } else {
    await log('❌ No session ID extracted');
    await log(`📁 Log file available: ${getLogFile()}`);
  }

  await log('\n✨ Review process complete. Check the PR for review comments.');
  await log(`📍 Pull Request: ${prUrl}`);

} catch (error) {
  reportError(error, {
    context: 'review_execution',
    prUrl: prUrl
  });
  await log('Error executing review:', error.message, { level: 'error' });
  process.exit(1);
} finally {
  // Clean up temporary directory (but not when resuming or when limit reached)
  if (!argv.resume && !limitReached) {
    try {
      process.stdout.write('\n🧹 Cleaning up...');
      await fs.rm(tempDir, { recursive: true, force: true });
      await log(' ✅');
    } catch (cleanupError) {
      reportError(cleanupError, {
        context: 'cleanup_temp_dir',
        level: 'warning',
        tempDir
      });
      await log(' ⚠️  (failed)');
    }
  } else if (argv.resume) {
    await log(`\n📁 Keeping directory for resumed session: ${tempDir}`);
  } else if (limitReached) {
    await log(`\n📁 Keeping directory for future resume: ${tempDir}`);
  }
}