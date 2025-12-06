#!/usr/bin/env node
// Import Sentry instrumentation first (must be before other imports)
import './instrument.mjs';
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
  try {
    // Load minimal modules needed for help
    const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
    globalThis.use = use;
    const yargsModule = await use('yargs@17.7.2');
    const yargs = yargsModule.default || yargsModule;
    const { hideBin } = await use('yargs@17.7.2/helpers');
    const rawArgs = hideBin(process.argv);

    // Reuse createYargsConfig from shared module to avoid duplication
    const { createYargsConfig } = await import('./hive.config.lib.mjs');
    const helpYargs = createYargsConfig(yargs(rawArgs)).version(false);

    // Show help and exit
    helpYargs.showHelp();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error: Failed to load help information');
    console.error(`   ${error.message}`);
    console.error('   This might be due to network issues or missing dependencies.');
    console.error('   Please check your internet connection and try again.');
    process.exit(1);
  }
}
export { createYargsConfig } from './hive.config.lib.mjs';
// Only execute main logic if this module is being run directly (not imported)
// This prevents heavy module loading when hive.mjs is imported by other modules
// Check if we're being executed (not imported) by looking at various indicators:
// 1. process.argv[1] is the executed file path
// 2. import.meta.url is this file's URL
// 3. For global installs, argv[1] might be a symlink, so we check if it contains 'hive'
import { fileURLToPath } from 'url';
const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url) ||
                          (process.argv[1] && (process.argv[1].includes('/hive') || process.argv[1].endsWith('hive')));

if (isDirectExecution) {
console.log('🐝 Hive Mind - AI-powered issue solver');
console.log('   Initializing...');
try {
console.log('   Loading dependencies (this may take a moment)...');
// Helper function to add timeout to async operations
const withTimeout = (promise, timeoutMs, operation) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation '${operation}' timed out after ${timeoutMs}ms. This might be due to slow network or npm configuration issues.`)), timeoutMs)
    )
  ]);
};

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof use === 'undefined') {
  try {
    // Wrap fetch in timeout to prevent hanging
    const useMCode = await withTimeout(
      fetch('https://unpkg.com/use-m/use.js').then(r => r.text()),
      10000,
      'fetching use-m library'
    );
    globalThis.use = (await eval(useMCode)).use;
  } catch (error) {
    console.error('❌ Fatal error: Failed to load dependencies');
    console.error(`   ${error.message}`);
    console.error('   This might be due to network issues or missing dependencies.');
    console.error('   Please check your internet connection and try again.');
    process.exit(1);
  }
}
// Use command-stream for consistent $ behavior across runtimes
const { $ } = await withTimeout(
  use('command-stream'),
  30000, // 30 second timeout
  'loading command-stream'
);
const yargsModule = await withTimeout(
  use('yargs@17.7.2'),
  30000,
  'loading yargs'
);
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await withTimeout(
  use('yargs@17.7.2/helpers'),
  30000,
  'loading yargs helpers'
);
const path = (await withTimeout(use('path'), 30000, 'loading path')).default;
const fs = (await withTimeout(use('fs'), 30000, 'loading fs')).promises;
// Import shared library functions
const lib = await import('./lib.mjs');
const { log, setLogFile, getAbsoluteLogPath, formatTimestamp, cleanErrorMessage, cleanupTempDirectories } = lib;
const yargsConfigLib = await import('./hive.config.lib.mjs');
const { createYargsConfig } = yargsConfigLib;
const claudeLib = await import('./claude.lib.mjs');
const { validateClaudeConnection } = claudeLib;
// Import model validation library
const modelValidation = await import('./model-validation.lib.mjs');
const { validateAndExitOnInvalidModel } = modelValidation;
const githubLib = await import('./github.lib.mjs');
const { checkGitHubPermissions, fetchAllIssuesWithPagination, fetchProjectIssues, isRateLimitError, batchCheckPullRequestsForIssues, parseGitHubUrl, batchCheckArchivedRepositories } = githubLib;
// Import YouTrack-related functions
const youTrackLib = await import('./youtrack/youtrack.lib.mjs');
const {
  validateYouTrackConfig,
  testYouTrackConnection,
  createYouTrackConfigFromEnv
} = youTrackLib;
const youTrackSync = await import('./youtrack/youtrack-sync.mjs');
const { syncYouTrackToGitHub, formatIssuesForHive } = youTrackSync;
const memCheck = await import('./memory-check.mjs');
const { checkSystem } = memCheck;
const exitHandler = await import('./exit-handler.lib.mjs');
const { initializeExitHandler, installGlobalExitHandlers, safeExit } = exitHandler;
const sentryLib = await import('./sentry.lib.mjs');
const { initializeSentry, withSentry, addBreadcrumb, reportError } = sentryLib;
const graphqlLib = await import('./github.graphql.lib.mjs');
const { tryFetchIssuesWithGraphQL } = graphqlLib;
const commandName = process.argv[1] ? process.argv[1].split('/').pop() : '';
const isLocalScript = commandName.endsWith('.mjs');
const solveCommand = isLocalScript ? './solve.mjs' : 'solve';

/**
 * Fallback function to fetch issues from organization/user repositories
 * when search API hits rate limits
 * @param {string} owner - Organization or user name
 * @param {string} scope - 'organization' or 'user'
 * @param {string} monitorTag - Label to filter by (optional)
 * @param {boolean} allIssues - Whether to fetch all issues or only labeled ones
 * @returns {Promise<Array>} Array of issues
 */
async function fetchIssuesFromRepositories(owner, scope, monitorTag, fetchAllIssues = false) {
  const { execSync } = await import('child_process');
  try {
    await log(`   🔄 Using repository-by-repository fallback for ${scope}: ${owner}`);
    // Strategy 1: Try GraphQL approach first (faster but has limitations)
    // Only try GraphQL for "all issues" mode, not for labeled issues
    if (fetchAllIssues) {
      const graphqlResult = await tryFetchIssuesWithGraphQL(owner, scope, log, cleanErrorMessage);
      if (graphqlResult.success) {
        await log(`   ✅ GraphQL approach successful: ${graphqlResult.issues.length} issues from ${graphqlResult.repoCount} repositories`);
        return graphqlResult.issues;
      }
    }

    // Strategy 2: Fallback to gh api --paginate approach (comprehensive but slower)
    await log('   📋 Using gh api --paginate approach for comprehensive coverage...', { verbose: true });

    // First, get list of ALL repositories using gh api with --paginate for unlimited pagination
    // This approach uses the GitHub API directly to fetch all repositories without any limits
    // Include isArchived field to filter out archived repositories
    let repoListCmd;
    if (scope === 'organization') {
      repoListCmd = `gh api orgs/${owner}/repos --paginate --jq '.[] | {name: .name, owner: .owner.login, isArchived: .archived}'`;
    } else {
      repoListCmd = `gh api users/${owner}/repos --paginate --jq '.[] | {name: .name, owner: .owner.login, isArchived: .archived}'`;
    }

    await log('   📋 Fetching repository list (using --paginate for unlimited pagination)...', { verbose: true });
    await log(`   🔎 Command: ${repoListCmd}`, { verbose: true });

    // Add delay for rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));

    const repoOutput = execSync(repoListCmd, { encoding: 'utf8' });
    // Parse the output line by line, as gh api with --jq outputs one JSON object per line
    const repoLines = repoOutput.trim().split('\n').filter(line => line.trim());
    const allRepositories = repoLines.map(line => JSON.parse(line));

    await log(`   📊 Found ${allRepositories.length} repositories`);

    // Filter repositories to only include those owned by the target user/org
    const ownedRepositories = allRepositories.filter(repo => {
      const repoOwner = repo.owner?.login || repo.owner;
      return repoOwner === owner;
    });
    const unownedCount = allRepositories.length - ownedRepositories.length;

    if (unownedCount > 0) {
      await log(`   ⏭️  Skipping ${unownedCount} repository(ies) not owned by ${owner}`);
    }

    // Filter out archived repositories from owned repositories
    const repositories = ownedRepositories.filter(repo => !repo.isArchived);
    const archivedCount = ownedRepositories.length - repositories.length;

    if (archivedCount > 0) {
      await log(`   ⏭️  Skipping ${archivedCount} archived repository(ies)`);
    }

    await log(`   ✅ Processing ${repositories.length} non-archived repositories owned by ${owner}`);

    let collectedIssues = [];
    let processedRepos = 0;

    // Process repositories in batches to avoid overwhelming the API
    for (const repo of repositories) {
      try {
        const repoName = repo.name;
        const ownerName = repo.owner?.login || owner;

        await log(`   🔍 Fetching issues from ${ownerName}/${repoName}...`, { verbose: true });

        // Build the appropriate issue list command
        let issueCmd;
        if (fetchAllIssues) {
          issueCmd = `gh issue list --repo ${ownerName}/${repoName} --state open --json url,title,number,createdAt`;
        } else {
          issueCmd = `gh issue list --repo ${ownerName}/${repoName} --state open --label "${monitorTag}" --json url,title,number,createdAt`;
        }

        // Add delay between repository requests
        await new Promise(resolve => setTimeout(resolve, 1000));

        const repoIssues = await fetchAllIssuesWithPagination(issueCmd);

        // Add repository information to each issue
        const issuesWithRepo = repoIssues.map(issue => ({
          ...issue,
          repository: {
            name: repoName,
            owner: { login: ownerName }
          }
        }));

        collectedIssues.push(...issuesWithRepo);
        processedRepos++;

        if (issuesWithRepo.length > 0) {
          await log(`   ✅ Found ${issuesWithRepo.length} issues in ${ownerName}/${repoName}`, { verbose: true });
        }

      } catch (repoError) {
        reportError(repoError, {
          context: 'fetchIssuesFromRepositories',
          repo: repo.name,
          operation: 'fetch_repo_issues'
        });
        await log(`   ⚠️  Failed to fetch issues from ${repo.name}: ${cleanErrorMessage(repoError)}`, { verbose: true });
        // Continue with other repositories
      }
    }

    await log(`   ✅ Repository fallback complete: ${collectedIssues.length} issues from ${processedRepos}/${repositories.length} repositories`);
    return collectedIssues;

  } catch (error) {
    reportError(error, {
      context: 'fetchIssuesFromRepositories',
      owner,
      scope,
      operation: 'repository_fallback'
    });
    await log(`   ❌ Repository fallback failed: ${cleanErrorMessage(error)}`, { level: 'error' });
    return [];
  }
}

// Configure command line arguments - GitHub URL as positional argument
const rawArgs = hideBin(process.argv);
// Use .parse() instead of .argv to ensure .strict() mode works correctly
// When you use .argv, strict mode doesn't trigger properly
// See: https://github.com/yargs/yargs/issues - .strict() only works with .parse()
let argv;

// Temporarily suppress stderr to prevent yargs from printing error messages
// We'll handle error reporting ourselves
const originalStderrWrite = process.stderr.write;
let stderrBuffer = '';
process.stderr.write = function(chunk, encoding, callback) {
  // Capture stderr output instead of writing it
  stderrBuffer += chunk.toString();
  if (typeof encoding === 'function') {
    encoding();
  } else if (callback) {
    callback();
  }
  return true;
};

  try {
    argv = await createYargsConfig(yargs()).parse(rawArgs);
    // Restore stderr if parsing succeeded
    process.stderr.write = originalStderrWrite;
  } catch (error) {
  // Restore stderr before handling the error
  process.stderr.write = originalStderrWrite;

  // If .strict() mode catches an unknown argument, yargs will throw an error
  // We should fail fast for truly invalid arguments
  if (error.message && error.message.includes('Unknown argument')) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  // Yargs sometimes throws "Not enough arguments" errors even when arguments are present
  // This is a quirk with optional positional arguments [github-url]
  // The error.argv object still contains the parsed arguments, so we can safely continue
  if (error.argv) {
    argv = error.argv;
  } else {
    // If there's no argv object, it's a real error - show the captured stderr
    if (stderrBuffer) {
      process.stderr.write(stderrBuffer);
    }
    throw error;
  }

  // Normalize deprecated flags to new names
  if (argv && (argv.skipToolCheck || argv.skipClaudeCheck)) argv.skipToolConnectionCheck = true;
  if (argv && argv.toolCheck === false) argv.toolConnectionCheck = false;
}

let githubUrl = argv['github-url'];

// Set global verbose mode
global.verboseMode = argv.verbose;

// Use the universal GitHub URL parser
if (githubUrl) {
  const parsedUrl = parseGitHubUrl(githubUrl);

  if (!parsedUrl.valid) {
    console.error('Error: Invalid GitHub URL format');
    if (parsedUrl.error) {
      console.error(`  ${parsedUrl.error}`);
    }
    console.error('Expected: https://github.com/owner or https://github.com/owner/repo');
    console.error('You can use any of these formats:');
    console.error('  - https://github.com/owner');
    console.error('  - https://github.com/owner/repo');
    console.error('  - http://github.com/owner (will be converted to https)');
    console.error('  - github.com/owner (will add https://)');
    console.error('  - owner (will be converted to https://github.com/owner)');
    console.error('  - owner/repo (will be converted to https://github.com/owner/repo)');
    await safeExit(1, 'Error occurred');
  }

  // Check if it's a valid type for hive (user or repo)
  if (parsedUrl.type !== 'user' && parsedUrl.type !== 'repo') {
    console.error('Error: Invalid GitHub URL for monitoring');
    console.error(`  URL type '${parsedUrl.type}' is not supported`);
    console.error('Expected: https://github.com/owner or https://github.com/owner/repo');
    await safeExit(1, 'Error occurred');
  }

  // Use the normalized URL
  githubUrl = parsedUrl.normalized;
}

// Validate GitHub URL format ONCE AND FOR ALL at the beginning
// Parse URL format: https://github.com/owner or https://github.com/owner/repo
let urlMatch = null;

// Only validate if we have a URL
const needsUrlValidation = githubUrl;

if (needsUrlValidation) {
  // Do the regex matching ONCE - this result will be used everywhere
  urlMatch = githubUrl.match(/^https:\/\/github\.com\/([^/]+)(\/([^/]+))?$/);
  if (!urlMatch) {
    console.error('Error: Invalid GitHub URL format');
    console.error('Expected: https://github.com/owner or https://github.com/owner/repo');
    console.error('You can use any of these formats:');
    console.error('  - https://github.com/owner');
    console.error('  - https://github.com/owner/repo');
    console.error('  - http://github.com/owner (will be converted to https)');
    console.error('  - github.com/owner (will add https://)');
    console.error('  - owner (will be converted to https://github.com/owner)');
    console.error('  - owner/repo (will be converted to https://github.com/owner/repo)');
    await safeExit(1, 'Error occurred');
  }
}

// Create log file with timestamp
// Use log-dir option if provided, otherwise use current working directory
let targetDir = argv.logDir || process.cwd();

// Verify the directory exists, create if necessary
try {
  await fs.access(targetDir);
} catch (error) {
  reportError(error, {
    context: 'log_directory_access',
    targetDir,
    operation: 'check_directory_exists'
  });
  // If directory doesn't exist, try to create it
  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch (mkdirError) {
    reportError(mkdirError, {
      context: 'log_directory_creation',
      targetDir,
      operation: 'create_directory'
    });
    console.error(`⚠️  Unable to create log directory: ${targetDir}`);
    console.error('   Falling back to current working directory');
    // Fall back to current working directory
    targetDir = process.cwd();
  }
}

const timestamp = formatTimestamp();
const logFile = path.join(targetDir, `hive-${timestamp}.log`);

// Set the log file for the lib.mjs logging system
setLogFile(logFile);

// Create the log file immediately
await fs.writeFile(logFile, `# Hive.mjs Log - ${new Date().toISOString()}\n\n`);
// Always use absolute path for log file display
const absoluteLogPath = path.resolve(logFile);
await log(`📁 Log file: ${absoluteLogPath}`);
await log('   (All output will be logged here)');

// Initialize Sentry integration (unless disabled)
if (argv.sentry) {
  await initializeSentry({
    noSentry: !argv.sentry,
    debug: argv.verbose,
    version: process.env.npm_package_version || '0.12.0'
  });

  // Add breadcrumb for monitoring configuration
  addBreadcrumb({
    category: 'hive',
    message: 'Started monitoring',
    level: 'info',
    data: {
      mode: argv.projectMode ? 'project' : (argv.allIssues ? 'all' : 'label'),
      concurrency: argv.concurrency,
      model: argv.model
    }
  });
}

// Initialize the exit handler with getAbsoluteLogPath function and Sentry cleanup
initializeExitHandler(getAbsoluteLogPath, log);
installGlobalExitHandlers();

// Unhandled error handlers are now managed by exit-handler.lib.mjs

// Validate GitHub URL requirement
if (!githubUrl) {
  await log('❌ GitHub URL is required', { level: 'error' });
  await log('   Usage: hive <github-url> [options]', { level: 'error' });
  await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });
  await safeExit(1, 'Error occurred');
}

// Validate project mode arguments
if (argv.projectMode) {
  if (!argv.projectNumber) {
    await log('❌ Project mode requires --project-number', { level: 'error' });
    await log('   Usage: hive <github-url> --project-mode --project-number NUMBER --project-owner OWNER', { level: 'error' });
    await safeExit(1, 'Error occurred');
  }

  if (!argv.projectOwner) {
    await log('❌ Project mode requires --project-owner', { level: 'error' });
    await log('   Usage: hive <github-url> --project-mode --project-number NUMBER --project-owner OWNER', { level: 'error' });
    await safeExit(1, 'Error occurred');
  }

  if (typeof argv.projectNumber !== 'number' || argv.projectNumber <= 0) {
    await log('❌ Project number must be a positive integer', { level: 'error' });
    await safeExit(1, 'Error occurred');
  }
}

// Validate model name EARLY - this always runs regardless of --skip-tool-connection-check
// Model validation is a simple string check and should always be performed
const tool = argv.tool || 'claude';
await validateAndExitOnInvalidModel(argv.model, tool, safeExit);

// Validate conflicting options
if (argv.skipIssuesWithPrs && argv.autoContinue) {
  await log('❌ Conflicting options: --skip-issues-with-prs and --auto-continue cannot be used together', { level: 'error' });
  await log('   --skip-issues-with-prs: Skips issues that have any open PRs', { level: 'error' });
  await log('   --auto-continue: Continues with existing PRs instead of creating new ones', { level: 'error' });
  await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });
  await safeExit(1, 'Error occurred');
}

// Helper function to check GitHub permissions - moved to github.lib.mjs

// Check GitHub permissions early in the process (skip in dry-run mode or when explicitly requested)
if (argv.dryRun || argv.skipToolConnectionCheck || argv.toolConnectionCheck === false) {
  await log('⏩ Skipping GitHub permissions check (dry-run mode or skip-tool-connection-check enabled)', { verbose: true });
} else {
  const hasValidAuth = await checkGitHubPermissions();
  if (!hasValidAuth) {
    await log('\n❌ Cannot proceed without valid GitHub authentication', { level: 'error' });
    await safeExit(1, 'Error occurred');
  }
}

// YouTrack configuration and validation
let youTrackConfig = null;
if (argv.youtrackMode) {
  // Create YouTrack config from environment variables and CLI overrides
  youTrackConfig = createYouTrackConfigFromEnv();

  if (!youTrackConfig) {
    await log('❌ YouTrack mode requires environment variables to be set', { level: 'error' });
    await log('   Required: YOUTRACK_URL, YOUTRACK_API_KEY, YOUTRACK_PROJECT_CODE, YOUTRACK_STAGE', { level: 'error' });
    await log('   Example: YOUTRACK_URL=https://mycompany.youtrack.cloud', { level: 'error' });
    process.exit(1);
  }

  // Apply CLI overrides
  if (argv.youtrackStage) {
    youTrackConfig.stage = argv.youtrackStage;
  }
  if (argv.youtrackProject) {
    youTrackConfig.projectCode = argv.youtrackProject;
  }

  // Validate configuration
  try {
    validateYouTrackConfig(youTrackConfig);
  } catch (error) {
    await log(`❌ YouTrack configuration error: ${error.message}`, { level: 'error' });
    process.exit(1);
  }

  // Test YouTrack connection
  const youTrackConnected = await testYouTrackConnection(youTrackConfig);
  if (!youTrackConnected) {
    await log('\n❌ Cannot proceed without valid YouTrack connection', { level: 'error' });
    process.exit(1);
  }
}

// Parse GitHub URL to determine organization, repository, or user
let scope = 'repository';
let owner = null;
let repo = null;

// NO DUPLICATE VALIDATION! URL was already validated at the beginning.
// If we have a URL but no validation results, that's a logic error.
if (githubUrl && urlMatch === null) {
  // This should never happen - it means our early validation was skipped incorrectly
  await log('Internal error: URL validation was not performed correctly', { level: 'error' });
  await log('This is a bug in the script logic', { level: 'error' });
  await safeExit(1, 'Error occurred');
}

if (urlMatch) {
  owner = urlMatch[1];
  repo = urlMatch[3] || null;
}

// Determine scope
if (!repo) {
  // Check if it's an organization or user (skip in dry-run mode to avoid hanging)
  if (argv.dryRun || argv.skipToolConnectionCheck || argv.toolConnectionCheck === false) {
    // In dry-run mode, default to user to avoid GitHub API calls
    scope = 'user';
    await log('   ℹ️  Assuming user scope (dry-run mode, skipping API detection)', { verbose: true });
  } else {
    try {
      const typeResult = await $`gh api users/${owner} --jq .type`;
      const accountType = typeResult.stdout.toString().trim();
      scope = accountType === 'Organization' ? 'organization' : 'user';
    } catch (e) {
      reportError(e, {
        context: 'detect_scope',
        owner,
        operation: 'detect_account_type'
      });
      // Default to user if API call fails
      scope = 'user';
    }
  }
} else {
  scope = 'repository';
}

await log('🎯 Monitoring Configuration:');
if (argv.youtrackMode) {
  await log(`   📍 Source: YouTrack - ${youTrackConfig.url}`);
  await log(`   📋 Project: ${youTrackConfig.projectCode}`);
  await log(`   📌 Stage: "${youTrackConfig.stage}"`);
  await log(`   📍 GitHub Target: ${scope.charAt(0).toUpperCase() + scope.slice(1)} - ${owner}${repo ? `/${repo}` : ''}`);
} else {
  await log(`   📍 Target: ${scope.charAt(0).toUpperCase() + scope.slice(1)} - ${owner}${repo ? `/${repo}` : ''}`);
  if (argv.projectMode) {
    await log(`   📋 Mode: PROJECT #${argv.projectNumber} (owner: ${argv.projectOwner})`);
    await log(`   📌 Status: "${argv.projectStatus}"`);
  } else if (argv.allIssues) {
    await log('   🏷️  Mode: ALL ISSUES (no label filter)');
  } else {
    await log(`   🏷️  Tag: "${argv.monitorTag}"`);
  }
}
if (argv.skipIssuesWithPrs) {
  await log('   🚫 Skipping: Issues with open PRs');
}
await log(`   🔄 Concurrency: ${argv.concurrency} parallel workers`);
await log(`   📊 Pull Requests per Issue: ${argv.pullRequestsPerIssue}`);
await log(`   🤖 Model: ${argv.model}`);
if (argv.fork) {
  await log('   🍴 Fork: ENABLED (will fork repos if no write access)');
}
if (argv.autoFork) {
  await log('   🍴 Auto-Fork: ENABLED (will auto-fork public repos without write access)');
}
if (argv.autoContinue) {
  await log('   🔄 Auto-Continue: ENABLED (will work on issues with existing PRs)');
}
if (argv.watch) {
  await log('   👁️  Watch Mode: ENABLED (will monitor continuously for feedback)');
}
if (argv.targetBranch) {
  await log(`   🎯 Target Branch: ${argv.targetBranch}`);
}
if (!argv.once) {
  await log(`   ⏱️  Polling Interval: ${argv.interval} seconds`);
}
await log(`   ${argv.once ? '🚀 Mode: Single run' : '♾️  Mode: Continuous monitoring'}`);
if (argv.maxIssues > 0) {
  await log(`   🔢 Max Issues: ${argv.maxIssues}`);
}
if (argv.dryRun) await log('   🧪 DRY RUN MODE - No actual processing');
if (argv.autoCleanup) await log('   🧹 Auto-cleanup: ENABLED (will clean /tmp/* /var/tmp/* on success)');
if (argv.interactiveMode) await log('   🔌 Interactive Mode: ENABLED');
await log('');

// Producer/Consumer Queue implementation
class IssueQueue {
  constructor() {
    this.queue = [];
    this.processing = new Set();
    this.completed = new Set();
    this.failed = new Set();
    this.workers = [];
    this.isRunning = true;
  }

  // Add issue to queue if not already processed or in queue
  enqueue(issueUrl) {
    if (this.completed.has(issueUrl) || 
        this.processing.has(issueUrl) || 
        this.queue.includes(issueUrl)) {
      return false;
    }
    this.queue.push(issueUrl);
    return true;
  }

  // Get next issue from queue
  dequeue() {
    if (this.queue.length === 0) {
      return null;
    }
    const issue = this.queue.shift();
    this.processing.add(issue);
    return issue;
  }

  // Mark issue as completed
  markCompleted(issueUrl) {
    this.processing.delete(issueUrl);
    this.completed.add(issueUrl);
  }

  // Mark issue as failed
  markFailed(issueUrl) {
    this.processing.delete(issueUrl);
    this.failed.add(issueUrl);
  }

  // Get queue statistics
  getStats() {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.size,
      failed: this.failed.size,
      processingIssues: Array.from(this.processing)
    };
  }

  // Stop all workers
  stop() {
    this.isRunning = false;
  }
}

// Create global queue instance
const issueQueue = new IssueQueue();

// Global shutdown state to prevent duplicate shutdown messages
let isShuttingDown = false;

// Worker function to process issues from queue
async function worker(workerId) {
  await log(`🔧 Worker ${workerId} started`, { verbose: true });
  
  while (issueQueue.isRunning) {
    const issueUrl = issueQueue.dequeue();
    
    if (!issueUrl) {
      // No work available, wait a bit
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    await log(`\n👷 Worker ${workerId} processing: ${issueUrl}`);
    
    // Track if this issue failed
    let issueFailed = false;
    
    // Process the issue multiple times if needed
    for (let prNum = 1; prNum <= argv.pullRequestsPerIssue; prNum++) {
      if (argv.pullRequestsPerIssue > 1) {
        await log(`   📝 Creating PR ${prNum}/${argv.pullRequestsPerIssue} for issue`);
      }
      
      try {
        // Execute solve command using spawn to enable real-time streaming while avoiding command-stream quoting issues
        if (argv.dryRun) {
          await log(`   🧪 [DRY RUN] Executing ${solveCommand} in dry-run mode for ${issueUrl}...`);
        } else {
          await log(`   🚀 Executing ${solveCommand} for ${issueUrl}...`);
        }

        const startTime = Date.now();
        const forkFlag = argv.fork ? ' --fork' : '';
        const autoForkFlag = argv.autoFork ? ' --auto-fork' : '';
        const verboseFlag = argv.verbose ? ' --verbose' : '';
        const attachLogsFlag = argv.attachLogs ? ' --attach-logs' : '';
        const targetBranchFlag = argv.targetBranch ? ` --target-branch ${argv.targetBranch}` : '';
        const logDirFlag = argv.logDir ? ` --log-dir "${argv.logDir}"` : '';
        const dryRunFlag = argv.dryRun ? ' --dry-run' : '';
        const skipToolConnectionCheckFlag = (argv.skipToolConnectionCheck || argv.toolConnectionCheck === false) ? ' --skip-tool-connection-check' : '';
        const toolFlag = argv.tool ? ` --tool ${argv.tool}` : '';
        const autoContinueFlag = argv.autoContinue ? ' --auto-continue' : '';
        const thinkFlag = argv.think ? ` --think ${argv.think}` : '';
        const noSentryFlag = !argv.sentry ? ' --no-sentry' : '';
        const watchFlag = argv.watch ? ' --watch' : '';
        const prefixForkNameWithOwnerNameFlag = argv.prefixForkNameWithOwnerName ? ' --prefix-fork-name-with-owner-name' : '';
        const interactiveModeFlag = argv.interactiveMode ? ' --interactive-mode' : '';

        // Use spawn to get real-time streaming output while avoiding command-stream's automatic quote addition
        const { spawn } = await import('child_process');

        // Build arguments array to avoid shell parsing issues
        const args = [issueUrl, '--model', argv.model];
        if (argv.tool) {
          args.push('--tool', argv.tool);
        }
        if (argv.fork) {
          args.push('--fork');
        }
        if (argv.autoFork) {
          args.push('--auto-fork');
        }
        if (argv.verbose) {
          args.push('--verbose');
        }
        if (argv.attachLogs) {
          args.push('--attach-logs');
        }
        if (argv.targetBranch) {
          args.push('--target-branch', argv.targetBranch);
        }
        if (argv.logDir) {
          args.push('--log-dir', argv.logDir);
        }
        if (argv.dryRun) {
          args.push('--dry-run');
        }
        if (argv.skipToolConnectionCheck || argv.toolConnectionCheck === false) {
          args.push('--skip-tool-connection-check');
        }
        if (argv.autoContinue) {
          args.push('--auto-continue');
        }
        if (argv.think) {
          args.push('--think', argv.think);
        }
        if (!argv.sentry) {
          args.push('--no-sentry');
        }
        if (argv.watch) args.push('--watch');
        if (argv.prefixForkNameWithOwnerName) args.push('--prefix-fork-name-with-owner-name');
        if (argv.interactiveMode) args.push('--interactive-mode');

        // Log the actual command being executed so users can investigate/reproduce
        const command = `${solveCommand} "${issueUrl}" --model ${argv.model}${toolFlag}${forkFlag}${autoForkFlag}${verboseFlag}${attachLogsFlag}${targetBranchFlag}${logDirFlag}${dryRunFlag}${skipToolConnectionCheckFlag}${autoContinueFlag}${thinkFlag}${noSentryFlag}${watchFlag}${prefixForkNameWithOwnerNameFlag}${interactiveModeFlag}`;
        await log(`   📋 Command: ${command}`);

        let exitCode = 0;

        // Create promise to handle async spawn process
        await new Promise((resolve) => {
          const child = spawn(solveCommand, args, {
            stdio: ['pipe', 'pipe', 'pipe']
          });

          // Handle stdout data - stream output in real-time
          child.stdout.on('data', (data) => {
              const lines = data.toString().split('\n');
              for (const line of lines) {
                if (line.trim()) {
                  log(`   [${solveCommand} worker-${workerId}] ${line}`).catch((logError) => {
                    reportError(logError, {
                      context: 'worker_stdout_log',
                      workerId,
                      operation: 'log_output'
                    });
                  });
                }
              }
            });

            // Handle stderr data - stream errors in real-time
            child.stderr.on('data', (data) => {
              const lines = data.toString().split('\n');
              for (const line of lines) {
                if (line.trim()) {
                  log(`   [${solveCommand} worker-${workerId} ERROR] ${line}`, { level: 'error' }).catch((logError) => {
                    reportError(logError, {
                      context: 'worker_stderr_log',
                      workerId,
                      operation: 'log_error'
                    });
                  });
                }
              }
            });
            
            // Handle process completion
            child.on('close', (code) => {
              exitCode = code || 0;
              resolve();
            });
            
            // Handle process errors
            child.on('error', (error) => {
              exitCode = 1;
              log(`   [${solveCommand} worker-${workerId} ERROR] Process error: ${error.message}`, { level: 'error' }).catch((logError) => {
                reportError(logError, {
                  context: 'worker_process_error_log',
                  workerId,
                  operation: 'log_process_error'
                });
              });
              resolve();
            });
          });
          
          const duration = Math.round((Date.now() - startTime) / 1000);

          if (exitCode === 0) {
            await log(`   ✅ Worker ${workerId} completed ${issueUrl} (${duration}s)`);
          } else {
            throw new Error(`${solveCommand} exited with code ${exitCode}`);
          }
        
        // Small delay between multiple PRs for same issue
        if (prNum < argv.pullRequestsPerIssue) {
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      } catch (error) {
        reportError(error, {
          context: 'worker_process_issue',
          workerId,
          issueUrl,
          operation: 'spawn_solve_worker'
        });
        await log(`   ❌ Worker ${workerId} failed on ${issueUrl}: ${cleanErrorMessage(error)}`, { level: 'error' });
        issueQueue.markFailed(issueUrl);
        issueFailed = true;
        break; // Stop trying more PRs for this issue
      }
    }
    
    // Only mark as completed if it didn't fail
    if (!issueFailed) {
      issueQueue.markCompleted(issueUrl);
    }

    // Show queue stats
    const stats = issueQueue.getStats();
    await log(`   📊 Queue: ${stats.queued} waiting, ${stats.processing} processing, ${stats.completed} completed, ${stats.failed} failed`);
    await log(`   📁 Hive log file: ${absoluteLogPath}`);

    // Show which issues are currently being processed
    if (stats.processingIssues && stats.processingIssues.length > 0) {
      await log('   🔧 Currently processing solve commands:');
      for (const issueUrl of stats.processingIssues) {
        await log(`      - ${issueUrl}`);
      }
    }
  }
  
  await log(`🔧 Worker ${workerId} stopped`, { verbose: true });
}

// Function to check if an issue has open pull requests
// Note: hasOpenPullRequests function has been replaced by batchCheckPullRequestsForIssues
// in github.lib.mjs for better performance and reduced API calls

// Function to fetch issues from GitHub
async function fetchIssues() {
  if (argv.youtrackMode) {
    await log(`\n🔍 Fetching issues from YouTrack project ${youTrackConfig.projectCode} (stage: "${youTrackConfig.stage}")...`);
  } else if (argv.projectMode) {
    await log(`\n🔍 Fetching issues from GitHub Project #${argv.projectNumber} (status: "${argv.projectStatus}")...`);
  } else if (argv.allIssues) {
    await log('\n🔍 Fetching ALL open issues...');
  } else {
    await log(`\n🔍 Fetching issues with label "${argv.monitorTag}"...`);
  }

  // In dry-run mode, skip actual API calls and return empty list immediately
  if (argv.dryRun) {
    await log('   🧪 Dry-run mode: Skipping actual issue fetching');
    return [];
  }

  try {
    let issues = [];

    if (argv.youtrackMode) {
      // Sync YouTrack issues to GitHub
      if (!owner || !repo) {
        throw new Error('YouTrack mode requires a specific repository URL (not organization/user)');
      }

      const githubIssues = await syncYouTrackToGitHub(youTrackConfig, owner, repo, $, log);

      // Convert to format expected by hive
      issues = formatIssuesForHive(githubIssues).map(issue => ({
        url: issue.html_url,
        title: issue.title,
        number: issue.number
      }));

    } else if (argv.projectMode) {
      // Use GitHub Projects v2 mode
      if (!argv.projectNumber || !argv.projectOwner) {
        throw new Error('Project mode requires --project-number and --project-owner');
      }

      issues = await fetchProjectIssues(argv.projectNumber, argv.projectOwner, argv.projectStatus);

    } else if (argv.allIssues) {
      // Fetch all open issues without label filter using pagination
      let searchCmd;
      if (scope === 'repository') {
        searchCmd = `gh issue list --repo ${owner}/${repo} --state open --json url,title,number,createdAt`;
      } else if (scope === 'organization') {
        searchCmd = `gh search issues org:${owner} is:open --json url,title,number,createdAt,repository`;
      } else {
        // User scope
        searchCmd = `gh search issues user:${owner} is:open --json url,title,number,createdAt,repository`;
      }
      
      await log('   🔎 Fetching all issues with pagination and rate limiting...');
      await log(`   🔎 Command: ${searchCmd}`, { verbose: true });

      try {
        issues = await fetchAllIssuesWithPagination(searchCmd);
      } catch (searchError) {
        reportError(searchError, {
          context: 'github_all_issues_search',
          scope,
          owner,
          operation: 'search_all_issues'
        });
        await log(`   ⚠️  Search failed: ${cleanErrorMessage(searchError)}`, { verbose: true });

        // Check if the error is due to rate limiting or search API limit and we're not in repository scope
        const errorMsg = searchError.message || searchError.toString();
        const isSearchLimitError = errorMsg.includes('Hit search API limit') || errorMsg.includes('repository-by-repository fallback');
        if ((isRateLimitError(searchError) || isSearchLimitError) && scope !== 'repository') {
          await log('   🔍 Search limit detected - attempting repository fallback...');
          try {
            issues = await fetchIssuesFromRepositories(owner, scope, null, true);
          } catch (fallbackError) {
            reportError(fallbackError, {
              context: 'github_all_issues_fallback',
              scope,
              owner,
              operation: 'fallback_all_fetch'
            });
            await log(`   ❌ Repository fallback failed: ${cleanErrorMessage(fallbackError)}`, { verbose: true });
            issues = [];
          }
        } else {
          issues = [];
        }
      }
      
    } else {
      // Use label filter
      // execSync is used within fetchAllIssuesWithPagination
      
      // For repositories, use gh issue list which works better with new repos
      if (scope === 'repository') {
        const listCmd = `gh issue list --repo ${owner}/${repo} --state open --label "${argv.monitorTag}" --json url,title,number,createdAt`;
        await log('   🔎 Fetching labeled issues with pagination and rate limiting...');
        await log(`   🔎 Command: ${listCmd}`, { verbose: true });
        
        try {
          issues = await fetchAllIssuesWithPagination(listCmd);
        } catch (listError) {
          reportError(listError, {
            context: 'github_list_issues',
            scope,
            owner,
            monitorTag: argv.monitorTag,
            operation: 'list_repository_issues'
          });
          await log(`   ⚠️  List failed: ${cleanErrorMessage(listError)}`, { verbose: true });
          issues = [];
        }
      } else {
        // For organizations and users, use search (may not work with new repos)
        let baseQuery;
        if (scope === 'organization') {
          baseQuery = `org:${owner} is:issue is:open`;
        } else {
          baseQuery = `user:${owner} is:issue is:open`;
        }
        
        // Handle label with potential spaces
        let searchQuery;
        let searchCmd;
        
        if (argv.monitorTag.includes(' ')) {
          searchQuery = `${baseQuery} label:"${argv.monitorTag}"`;
          searchCmd = `gh search issues '${searchQuery}' --json url,title,number,createdAt,repository`;
        } else {
          searchQuery = `${baseQuery} label:${argv.monitorTag}`;
          searchCmd = `gh search issues '${searchQuery}' --json url,title,number,createdAt,repository`;
        }
        
        await log('   🔎 Fetching labeled issues with pagination and rate limiting...');
        await log(`   🔎 Search query: ${searchQuery}`, { verbose: true });
        await log(`   🔎 Command: ${searchCmd}`, { verbose: true });
        
        try {
          issues = await fetchAllIssuesWithPagination(searchCmd);
        } catch (searchError) {
          reportError(searchError, {
            context: 'github_labeled_issues_search',
            scope,
            owner,
            monitorTag: argv.monitorTag,
            operation: 'search_labeled_issues'
          });
          await log(`   ⚠️  Search failed: ${cleanErrorMessage(searchError)}`, { verbose: true });

          // Check if the error is due to rate limiting or search API limit
          const errorMsg = searchError.message || searchError.toString();
          const isSearchLimitError = errorMsg.includes('Hit search API limit') || errorMsg.includes('repository-by-repository fallback');
          if (isRateLimitError(searchError) || isSearchLimitError) {
            await log('   🔍 Search limit detected - attempting repository fallback...');
            try {
              issues = await fetchIssuesFromRepositories(owner, scope, argv.monitorTag, false);
            } catch (fallbackError) {
              reportError(fallbackError, {
                context: 'github_labeled_issues_fallback',
                scope,
                owner,
                monitorTag: argv.monitorTag,
                operation: 'fallback_labeled_fetch'
              });
              await log(`   ❌ Repository fallback failed: ${cleanErrorMessage(fallbackError)}`, { verbose: true });
              issues = [];
            }
          } else {
            issues = [];
          }
        }
      }
    }
    
    if (issues.length === 0) {
      if (argv.youtrackMode) {
        await log(`   ℹ️  No issues found in YouTrack with stage "${youTrackConfig.stage}"`);
      } else if (argv.projectMode) {
        await log(`   ℹ️  No issues found in project with status "${argv.projectStatus}"`);
      } else if (argv.allIssues) {
        await log('   ℹ️  No open issues found');
      } else {
        await log(`   ℹ️  No issues found with label "${argv.monitorTag}"`);
      }
      return [];
    }

    if (argv.youtrackMode) {
      await log(`   📋 Found ${issues.length} YouTrack issue(s) with stage "${youTrackConfig.stage}"`);
    } else if (argv.projectMode) {
      await log(`   📋 Found ${issues.length} issue(s) with status "${argv.projectStatus}"`);
    } else if (argv.allIssues) {
      await log(`   📋 Found ${issues.length} open issue(s)`);
    } else {
      await log(`   📋 Found ${issues.length} issue(s) with label "${argv.monitorTag}"`);
    }

    // Sort issues by publication date (createdAt) based on issue-order option
    if (issues.length > 0 && issues[0].createdAt) {
      await log(`   🔄 Sorting issues by publication date (${argv.issueOrder === 'asc' ? 'oldest first' : 'newest first'})...`);
      issues.sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return argv.issueOrder === 'asc' ? dateA - dateB : dateB - dateA;
      });
      await log('   ✅ Issues sorted by publication date');
    }

    // Filter out issues from archived repositories
    // This is critical because we cannot do write operations on archived repositories
    let issuesToProcess = issues;

    // Helper function to extract repository info from issue (API response or URL)
    const getRepoInfo = (issue) => {
      let repoName = issue.repository?.name;
      let repoOwner = issue.repository?.owner?.login || issue.repository?.nameWithOwner?.split('/')[0];

      // If repository info is not available, extract it from the issue URL
      if (!repoName || !repoOwner) {
        const urlMatch = issue.url?.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/\d+/);
        if (urlMatch) {
          repoOwner = urlMatch[1];
          repoName = urlMatch[2];
        }
      }

      return { repoOwner, repoName };
    };

    // Only filter for organization/user scopes
    // For repository scope, we're already working on a specific repo
    if (scope !== 'repository' && issues.length > 0) {
      await log('   🔍 Checking for archived repositories...');

      // Extract unique repositories from issues
      const uniqueRepos = new Map();
      for (const issue of issues) {
        const { repoOwner, repoName } = getRepoInfo(issue);
        if (repoOwner && repoName) {
          const repoKey = `${repoOwner}/${repoName}`;
          if (!uniqueRepos.has(repoKey)) {
            uniqueRepos.set(repoKey, { owner: repoOwner, name: repoName });
          }
        }
      }

      // Batch check archived status for all repositories
      const archivedStatusMap = await batchCheckArchivedRepositories(Array.from(uniqueRepos.values()));

      // Filter out issues from archived repositories
      const filteredIssues = [];
      let archivedIssuesCount = 0;

      for (const issue of issues) {
        const { repoOwner, repoName } = getRepoInfo(issue);

        if (repoOwner && repoName) {
          const repoKey = `${repoOwner}/${repoName}`;

          if (archivedStatusMap[repoKey] === true) {
            await log(`      ⏭️  Skipping (archived repository): ${issue.title || 'Untitled'} (${issue.url})`, { verbose: true });
            archivedIssuesCount++;
          } else {
            filteredIssues.push(issue);
          }
        } else {
          // If we can't determine repository, include the issue to be safe
          await log(`      ⚠️  Could not determine repository for issue: ${issue.url}`, { verbose: true });
          filteredIssues.push(issue);
        }
      }

      if (archivedIssuesCount > 0) {
        await log(`   ⏭️  Skipped ${archivedIssuesCount} issue(s) from archived repositories`);
      }

      issuesToProcess = filteredIssues;
    }

    // Filter out issues with open PRs if option is enabled
    if (argv.skipIssuesWithPrs) {
      await log('   🔍 Checking for existing pull requests using batch GraphQL query...');

      // Extract issue numbers and repository info from URLs
      const issuesByRepo = {};
      for (const issue of issuesToProcess) {
        const urlMatch = issue.url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
        if (urlMatch) {
          const [, issueOwner, issueRepo, issueNumber] = urlMatch;
          const repoKey = `${issueOwner}/${issueRepo}`;

          if (!issuesByRepo[repoKey]) {
            issuesByRepo[repoKey] = {
              owner: issueOwner,
              repo: issueRepo,
              issues: []
            };
          }

          issuesByRepo[repoKey].issues.push({
            number: parseInt(issueNumber),
            issue: issue
          });
        }
      }

      // Batch check PRs for each repository
      const filteredIssues = [];
      let totalSkipped = 0;

      for (const repoData of Object.values(issuesByRepo)) {
        const issueNumbers = repoData.issues.map(i => i.number);
        const prResults = await batchCheckPullRequestsForIssues(repoData.owner, repoData.repo, issueNumbers);

        // Process results
        for (const issueData of repoData.issues) {
          const prInfo = prResults[issueData.number];
          if (prInfo && prInfo.openPRCount > 0) {
            await log(`      ⏭️  Skipping (has ${prInfo.openPRCount} PR${prInfo.openPRCount > 1 ? 's' : ''}): ${issueData.issue.title || 'Untitled'} (${issueData.issue.url})`, { verbose: true });
            totalSkipped++;
          } else {
            filteredIssues.push(issueData.issue);
          }
        }
      }

      if (totalSkipped > 0) {
        await log(`   ⏭️  Skipped ${totalSkipped} issue(s) with existing pull requests`);
      }
      issuesToProcess = filteredIssues;
    }
    
    // Apply max issues limit if set (after filtering to exclude skipped issues from count)
    if (argv.maxIssues > 0 && issuesToProcess.length > argv.maxIssues) {
      issuesToProcess = issuesToProcess.slice(0, argv.maxIssues);
      await log(`   🔢 Limiting to first ${argv.maxIssues} issues (after filtering)`);
    }
    
    // In dry-run mode, show the issues that would be processed
    if (argv.dryRun && issuesToProcess.length > 0) {
      await log('\n   📝 Issues that would be processed:');
      for (const issue of issuesToProcess) {
        await log(`      - ${issue.title || 'Untitled'} (${issue.url})`);
      }
    }
    
    return issuesToProcess.map(issue => issue.url);
    
  } catch (error) {
    reportError(error, {
      context: 'fetchIssues',
      projectMode: argv.projectMode,
      allIssues: argv.allIssues,
      monitorTag: argv.monitorTag,
      operation: 'fetch_issues'
    });
    await log(`   ❌ Error fetching issues: ${cleanErrorMessage(error)}`, { level: 'error' });
    return [];
  }
}

// Main monitoring loop
async function monitor() {
  await log('\n🚀 Starting Hive Mind monitoring system...');
  
  // Start workers
  await log(`\n👷 Starting ${argv.concurrency} workers...`);
  for (let i = 1; i <= argv.concurrency; i++) {
    issueQueue.workers.push(worker(i));
  }
  
  // Main monitoring loop
  let iteration = 0;
  while (true) {
    iteration++;
    await log(`\n🔄 Monitoring iteration ${iteration} at ${new Date().toISOString()}`);
    
    // Fetch issues
    const issueUrls = await fetchIssues();
    
    // Add new issues to queue
    let newIssues = 0;
    for (const url of issueUrls) {
      if (issueQueue.enqueue(url)) {
        newIssues++;
        await log(`   ➕ Added to queue: ${url}`);
      }
    }
    
    if (newIssues > 0) {
      await log(`   📥 Added ${newIssues} new issue(s) to queue`);
    } else {
      await log('   ℹ️  No new issues to add (all already processed or in queue)');
    }
    
    // Show current stats
    const stats = issueQueue.getStats();
    await log('\n📊 Current Status:');
    await log(`   📋 Queued: ${stats.queued}`);
    await log(`   ⚙️  Processing: ${stats.processing}`);
    await log(`   ✅ Completed: ${stats.completed}`);
    await log(`   ❌ Failed: ${stats.failed}`);
    await log(`   📁 Hive log file: ${absoluteLogPath}`);

    // Show which issues are currently being processed
    if (stats.processingIssues && stats.processingIssues.length > 0) {
      await log('   🔧 Currently processing solve commands:');
      for (const issueUrl of stats.processingIssues) {
        await log(`      - ${issueUrl}`);
      }
    }
    
    // If running once, wait for queue to empty then exit
    if (argv.once) {
      await log('\n🏁 Single run mode - waiting for queue to empty...');

      while (stats.queued > 0 || stats.processing > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const currentStats = issueQueue.getStats();
        if (currentStats.queued !== stats.queued || currentStats.processing !== stats.processing) {
          await log(`   ⏳ Waiting... Queue: ${currentStats.queued}, Processing: ${currentStats.processing}`);
        }
        Object.assign(stats, currentStats);
      }

      await log('\n✅ All issues processed!');
      await log(`   Completed: ${stats.completed}`);
      await log(`   Failed: ${stats.failed}`);
      await log(`   📁 Full log file: ${absoluteLogPath}`);

      // Perform cleanup if enabled and there were successful completions
      if (stats.completed > 0) {
        await cleanupTempDirectories(argv);
      }

      // Stop workers before breaking to avoid hanging
      issueQueue.stop();
      break;
    }
    
    // Wait for next iteration
    await log(`\n⏰ Next check in ${argv.interval} seconds...`);
    await new Promise(resolve => setTimeout(resolve, argv.interval * 1000));
  }
  
  // Stop workers
  issueQueue.stop();
  await Promise.all(issueQueue.workers);
  
  // Perform cleanup if enabled and there were successful completions
  const finalStats = issueQueue.getStats();
  if (finalStats.completed > 0) {
    await cleanupTempDirectories();
  }
  
  await log('\n👋 Hive Mind monitoring stopped');
  await log(`   📁 Full log file: ${absoluteLogPath}`);
}

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return; // Prevent duplicate shutdown messages
  }
  isShuttingDown = true;

  try {
    await log(`\n\n🛑 Received ${signal} signal, shutting down gracefully...`);

    // Stop the queue and wait for workers to finish
    issueQueue.stop();

    // Give workers a moment to finish their current tasks
    const stats = issueQueue.getStats();
    if (stats.processing > 0) {
      await log(`   ⏳ Waiting for ${stats.processing} worker(s) to finish current tasks...`);

      // Wait up to 10 seconds for workers to finish
      const maxWaitTime = 10000;
      const startTime = Date.now();
      while (issueQueue.getStats().processing > 0 && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    await Promise.all(issueQueue.workers);

    // Perform cleanup if enabled and there were successful completions
    const finalStats = issueQueue.getStats();
    if (finalStats.completed > 0) {
      await cleanupTempDirectories(argv);
    }

    await log('   ✅ Shutdown complete');
    await log(`   📁 Full log file: ${absoluteLogPath}`);

  } catch (error) {
    reportError(error, {
      context: 'monitor_issues_shutdown',
      operation: 'cleanup_and_exit'
    });
    await log(`   ⚠️  Error during shutdown: ${cleanErrorMessage(error)}`, { level: 'error' });
    await log(`   📁 Full log file: ${absoluteLogPath}`);
  }

  await safeExit(0, 'Process completed');
}

// Function to validate Claude CLI connection
// validateClaudeConnection is now imported from lib.mjs

// Handle graceful shutdown
process.on('SIGINT', () => gracefulShutdown('interrupt'));
process.on('SIGTERM', () => gracefulShutdown('termination'));

// Check system resources (disk space and RAM) before starting monitoring (skip in dry-run mode)
if (argv.dryRun || argv.skipToolConnectionCheck || argv.toolConnectionCheck === false) {
  await log('⏩ Skipping system resource check (dry-run mode or skip-tool-connection-check enabled)', { verbose: true });
  await log('⏩ Skipping Claude CLI connection check (dry-run mode or skip-tool-connection-check enabled)', { verbose: true });
} else {
  const systemCheck = await checkSystem(
    {
      minDiskSpaceMB: argv.minDiskSpace || 500,
      minMemoryMB: 256,
      exitOnFailure: true
    },
    { log }
  );

  if (!systemCheck.success) {
    await safeExit(1, 'Error occurred');
  }

  // Validate Claude CLI connection before starting monitoring with the same model that will be used
  const isClaudeConnected = await validateClaudeConnection(argv.model);
  if (!isClaudeConnected) {
    await log('❌ Cannot start monitoring without Claude CLI connection', { level: 'error' });
    await safeExit(1, 'Error occurred');
  }
}

// Wrap monitor function with Sentry error tracking
const monitorWithSentry = !argv.sentry ? monitor : withSentry(monitor, 'hive.monitor', 'command');

// Start monitoring
try {
  await monitorWithSentry();
} catch (error) {
  reportError(error, {
    context: 'hive_main',
    operation: 'monitor_with_sentry'
  });
  await log(`\n❌ Fatal error: ${cleanErrorMessage(error)}`, { level: 'error' });
  await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });
  await safeExit(1, 'Error occurred');
}

} catch (fatalError) {
  // Handle any errors that occurred during initialization or execution
  // This prevents silent failures when the script hangs or crashes
  console.error('\n❌ Fatal error occurred during hive initialization or execution');
  console.error(`   ${fatalError.message || fatalError}`);
  if (fatalError.stack) {
    console.error('\nStack trace:');
    console.error(fatalError.stack);
  }
  console.error('\nPlease report this issue at: https://github.com/deep-assistant/hive-mind/issues');
  process.exit(1);
}

} // End of main execution block
