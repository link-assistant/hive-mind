#!/usr/bin/env node

/**
 * Organization Clone Tool
 * Clone all repositories from a GitHub organization or user account
 *
 * Features:
 * - Parallel repository processing
 * - Real-time status updates
 * - Automatic pulling of existing repos and cloning of new ones
 * - SSH and HTTPS cloning support
 * - Smart authentication via GitHub CLI
 */

// Import Sentry instrumentation first
import './instrument.mjs';

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');
const path = (await use('path')).default;
const fs = (await use('fs')).promises;
const os = (await use('os')).default;

// Import shared library functions
const lib = await import('./lib.mjs');
const { log, setLogFile, getAbsoluteLogPath, formatTimestamp, cleanErrorMessage } = lib;

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { initializeSentry, withSentry, addBreadcrumb, reportError } = sentryLib;

// Import exit handler
const exitHandler = await import('./exit-handler.lib.mjs');
const { initializeExitHandler, installGlobalExitHandlers, safeExit } = exitHandler;

// Configure command line arguments
const argv = await yargs(hideBin(process.argv))
  .usage('Usage: $0 <org-or-user> [options]')
  .command('$0 <target>', 'Clone all repositories from a GitHub organization or user', (yargs) => {
    yargs.positional('target', {
      describe: 'GitHub organization or user name',
      type: 'string'
    });
  })
  .option('dir', {
    alias: 'd',
    describe: 'Target directory for cloning repositories',
    type: 'string',
    default: process.cwd()
  })
  .option('ssh', {
    describe: 'Use SSH for cloning instead of HTTPS',
    type: 'boolean',
    default: false
  })
  .option('threads', {
    alias: 't',
    describe: 'Number of parallel clone operations',
    type: 'number',
    default: 8
  })
  .option('verbose', {
    alias: 'v',
    describe: 'Enable verbose logging',
    type: 'boolean',
    default: false
  })
  .option('dry-run', {
    alias: 'n',
    describe: 'List repositories without cloning',
    type: 'boolean',
    default: false
  })
  .option('include-forks', {
    describe: 'Include forked repositories',
    type: 'boolean',
    default: false
  })
  .option('include-archived', {
    describe: 'Include archived repositories',
    type: 'boolean',
    default: false
  })
  .option('log-dir', {
    alias: 'l',
    describe: 'Directory for log files',
    type: 'string',
    default: process.cwd()
  })
  .option('sentry', {
    describe: 'Enable Sentry error tracking',
    type: 'boolean',
    default: true
  })
  .help('h')
  .alias('h', 'help')
  .version(false)
  .strict()
  .parse();

// Set global verbose mode
global.verboseMode = argv.verbose;

// Create log file with timestamp
const timestamp = formatTimestamp();
const logFile = path.join(argv.logDir, `org-clone-${argv.target}-${timestamp}.log`);
setLogFile(logFile);

// Create the log file immediately
await fs.writeFile(logFile, `# Org-Clone Log - ${new Date().toISOString()}\n\n`);
const absoluteLogPath = path.resolve(logFile);

// Initialize Sentry integration (unless disabled)
if (argv.sentry) {
  await initializeSentry({
    noSentry: !argv.sentry,
    debug: argv.verbose,
    version: process.env.npm_package_version || '0.12.0'
  });

  addBreadcrumb({
    category: 'org-clone',
    message: 'Started organization clone',
    level: 'info',
    data: {
      target: argv.target,
      threads: argv.threads,
      ssh: argv.ssh
    }
  });
}

// Initialize the exit handler
initializeExitHandler(getAbsoluteLogPath, log);
installGlobalExitHandlers();

await log('');
await log('🐝 Organization Clone Tool');
await log(`📁 Log file: ${absoluteLogPath}`);
await log('');

/**
 * Fetch all repositories from organization or user
 */
async function fetchRepositories(target) {
  await log(`🔍 Fetching repositories from ${target}...`);

  try {
    // Check if target is an organization or user
    const typeResult = await $`gh api users/${target} --jq .type`;
    const accountType = typeResult.stdout.toString().trim();
    const isOrg = accountType === 'Organization';

    await log(`   Account type: ${accountType}`);

    // Build query with filters
    let filters = [];
    if (!argv.includeForks) {
      filters.push('.fork == false');
    }
    if (!argv.includeArchived) {
      filters.push('.archived == false');
    }

    const filterQuery = filters.length > 0 ? ` | select(${filters.join(' and ')})` : '';
    const jqQuery = `[.[]${filterQuery} | {name: .name, full_name: .full_name, ssh_url: .ssh_url, clone_url: .clone_url, fork: .fork, archived: .archived}]`;

    // Fetch repositories with pagination
    const reposResult = await $`gh api ${isOrg ? 'orgs' : 'users'}/${target}/repos --paginate --jq ${jqQuery}`;

    if (reposResult.code !== 0) {
      throw new Error(`Failed to fetch repositories: ${reposResult.stderr || 'Unknown error'}`);
    }

    const repos = JSON.parse(reposResult.stdout.toString() || '[]');
    await log(`   Found ${repos.length} repositories`);

    return repos;

  } catch (error) {
    reportError(error, {
      context: 'fetch_repositories',
      target,
      operation: 'list_repos'
    });
    throw error;
  }
}

/**
 * Check if a repository already exists locally
 */
async function checkLocalRepo(repoPath) {
  try {
    await fs.access(repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone or update a single repository
 */
async function processRepository(repo, targetDir, ssh) {
  const repoPath = path.join(targetDir, repo.name);
  const cloneUrl = ssh ? repo.ssh_url : repo.clone_url;

  const exists = await checkLocalRepo(repoPath);

  if (exists) {
    // Repository exists, try to pull latest changes
    await log(`   🔄 Updating: ${repo.name}`);

    try {
      // Check for uncommitted changes
      const statusResult = await $({ cwd: repoPath })`git status --porcelain`;
      const hasChanges = statusResult.stdout.toString().trim().length > 0;

      if (hasChanges) {
        await log(`      ⚠️  Skipped (uncommitted changes): ${repo.name}`, { verbose: true });
        return { success: false, reason: 'uncommitted_changes', repo: repo.name };
      }

      // Pull latest changes
      const pullResult = await $({ cwd: repoPath })`git pull --ff-only`;

      if (pullResult.code === 0) {
        await log(`      ✅ Updated: ${repo.name}`, { verbose: true });
        return { success: true, action: 'updated', repo: repo.name };
      } else {
        await log(`      ⚠️  Pull failed: ${repo.name}`, { verbose: true });
        return { success: false, reason: 'pull_failed', repo: repo.name };
      }

    } catch (error) {
      reportError(error, {
        context: 'update_repository',
        repo: repo.name,
        operation: 'git_pull'
      });
      await log(`      ❌ Error updating: ${repo.name} - ${cleanErrorMessage(error)}`, { verbose: true });
      return { success: false, reason: 'error', repo: repo.name, error };
    }

  } else {
    // Repository doesn't exist, clone it
    await log(`   📥 Cloning: ${repo.name}`);

    try {
      const cloneResult = await $`gh repo clone ${repo.full_name} ${repoPath}`;

      if (cloneResult.code === 0) {
        await log(`      ✅ Cloned: ${repo.name}`, { verbose: true });
        return { success: true, action: 'cloned', repo: repo.name };
      } else {
        await log(`      ❌ Clone failed: ${repo.name}`, { verbose: true });
        return { success: false, reason: 'clone_failed', repo: repo.name };
      }

    } catch (error) {
      reportError(error, {
        context: 'clone_repository',
        repo: repo.name,
        operation: 'gh_repo_clone'
      });
      await log(`      ❌ Error cloning: ${repo.name} - ${cleanErrorMessage(error)}`, { verbose: true });
      return { success: false, reason: 'error', repo: repo.name, error };
    }
  }
}

/**
 * Process repositories in parallel with limited concurrency
 */
async function processRepositoriesInParallel(repos, targetDir, ssh, threads) {
  const results = {
    cloned: [],
    updated: [],
    skipped: [],
    failed: []
  };

  // Create a queue of repositories to process
  const queue = [...repos];
  const activeWorkers = [];

  // Worker function
  const worker = async (workerId) => {
    while (queue.length > 0) {
      const repo = queue.shift();
      if (!repo) break;

      const result = await processRepository(repo, targetDir, ssh);

      if (result.success) {
        if (result.action === 'cloned') {
          results.cloned.push(result.repo);
        } else if (result.action === 'updated') {
          results.updated.push(result.repo);
        }
      } else {
        if (result.reason === 'uncommitted_changes') {
          results.skipped.push(result.repo);
        } else {
          results.failed.push(result.repo);
        }
      }
    }
  };

  // Start workers
  for (let i = 0; i < threads; i++) {
    activeWorkers.push(worker(i + 1));
  }

  // Wait for all workers to complete
  await Promise.all(activeWorkers);

  return results;
}

/**
 * Main function
 */
async function main() {
  try {
    // Verify GitHub authentication
    await log('🔐 Verifying GitHub authentication...');
    const authResult = await $`gh auth status`;

    if (authResult.code !== 0) {
      await log('❌ GitHub authentication failed', { level: 'error' });
      await log('   Run: gh auth login', { level: 'error' });
      await safeExit(1, 'Authentication failed');
    }

    await log('   ✅ Authenticated');
    await log('');

    // Fetch repositories
    const repos = await fetchRepositories(argv.target);

    if (repos.length === 0) {
      await log('ℹ️  No repositories found');
      await safeExit(0, 'No repositories to process');
    }

    await log('');
    await log('📋 Configuration:');
    await log(`   Target: ${argv.target}`);
    await log(`   Directory: ${argv.dir}`);
    await log(`   Repositories: ${repos.length}`);
    await log(`   Protocol: ${argv.ssh ? 'SSH' : 'HTTPS'}`);
    await log(`   Threads: ${argv.threads}`);
    await log(`   Include forks: ${argv.includeForks}`);
    await log(`   Include archived: ${argv.includeArchived}`);
    await log('');

    // Create target directory if it doesn't exist
    await fs.mkdir(argv.dir, { recursive: true });

    // Dry run mode - just list repositories
    if (argv.dryRun) {
      await log('🧪 DRY RUN MODE - Repositories that would be processed:');
      for (const repo of repos) {
        const exists = await checkLocalRepo(path.join(argv.dir, repo.name));
        const status = exists ? 'UPDATE' : 'CLONE';
        const flags = [];
        if (repo.fork) flags.push('fork');
        if (repo.archived) flags.push('archived');
        const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
        await log(`   ${status}: ${repo.name}${flagStr}`);
      }
      await log('');
      await log(`📁 Full log file: ${absoluteLogPath}`);
      await safeExit(0, 'Dry run completed');
    }

    // Process repositories
    await log('🚀 Processing repositories...');
    await log('');

    const startTime = Date.now();
    const results = await processRepositoriesInParallel(repos, argv.dir, argv.ssh, argv.threads);
    const duration = Math.round((Date.now() - startTime) / 1000);

    // Show summary
    await log('');
    await log('✅ Processing complete!');
    await log('');
    await log('📊 Summary:');
    await log(`   Cloned: ${results.cloned.length}`);
    await log(`   Updated: ${results.updated.length}`);
    await log(`   Skipped: ${results.skipped.length} (uncommitted changes)`);
    await log(`   Failed: ${results.failed.length}`);
    await log(`   Total: ${repos.length}`);
    await log(`   Duration: ${duration}s`);
    await log('');

    if (results.skipped.length > 0) {
      await log('⚠️  Skipped repositories (uncommitted changes):');
      for (const repo of results.skipped) {
        await log(`   - ${repo}`);
      }
      await log('');
    }

    if (results.failed.length > 0) {
      await log('❌ Failed repositories:');
      for (const repo of results.failed) {
        await log(`   - ${repo}`);
      }
      await log('');
    }

    await log(`📁 Full log file: ${absoluteLogPath}`);
    await safeExit(0, 'Processing completed');

  } catch (error) {
    reportError(error, {
      context: 'org_clone_main',
      operation: 'main_execution'
    });
    await log(`\n❌ Fatal error: ${cleanErrorMessage(error)}`, { level: 'error' });
    await log(`   📁 Full log file: ${absoluteLogPath}`, { level: 'error' });
    await safeExit(1, 'Fatal error occurred');
  }
}

// Wrap main function with Sentry error tracking
const mainWithSentry = !argv.sentry ? main : withSentry(main, 'org-clone.main', 'command');

// Execute main function
await mainWithSentry();
