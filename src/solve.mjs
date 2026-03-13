#!/usr/bin/env node
// Import Sentry instrumentation first (must be before other imports)
import './instrument.mjs';
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
  // Load minimal modules needed for help
  const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
  globalThis.use = use;
  const config = await import('./solve.config.lib.mjs');
  const { initializeConfig, createYargsConfig } = config;
  const { yargs, hideBin } = await initializeConfig(use);
  const rawArgs = hideBin(process.argv);
  // Filter out help flags to avoid duplicate display
  const argsWithoutHelp = rawArgs.filter(arg => arg !== '--help' && arg !== '-h');
  createYargsConfig(yargs(argsWithoutHelp)).showHelp();
  process.exit(0);
}
if (earlyArgs.length === 0) {
  console.error('Usage: solve.mjs <issue-url> [options]');
  console.error('\nError: Missing required github issue or pull request URL');
  console.error('\nRun "solve.mjs --help" for more information');
  process.exit(1);
}
// Now load all modules for normal operation
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;
const { $ } = await use('command-stream');
const config = await import('./solve.config.lib.mjs');
const { initializeConfig, parseArguments } = config;
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { initializeSentry, addBreadcrumb, reportError, closeSentry } = sentryLib;
const { yargs, hideBin } = await initializeConfig(use);
const path = (await use('path')).default;
const fs = (await use('fs')).promises;
const crypto = (await use('crypto')).default;
const memoryCheck = await import('./memory-check.mjs');
const lib = await import('./lib.mjs');
const { log, setLogFile, getLogFile, getAbsoluteLogPath, cleanErrorMessage, formatAligned, getVersionInfo } = lib;
const githubLib = await import('./github.lib.mjs');
const { sanitizeLogContent, attachLogToGitHub } = githubLib;
const validation = await import('./solve.validation.lib.mjs');
const { validateGitHubUrl, showAttachLogsWarning, initializeLogFile, validateUrlRequirement, validateContinueOnlyOnFeedback, performSystemChecks } = validation;
const autoContinue = await import('./solve.auto-continue.lib.mjs');
const { processAutoContinueForIssue } = autoContinue;
const repository = await import('./solve.repository.lib.mjs');
const { setupTempDirectory, cleanupTempDirectory } = repository;
const results = await import('./solve.results.lib.mjs');
const { cleanupClaudeFile, showSessionSummary, verifyResults, buildClaudeResumeCommand, checkForAiCreatedComments, attachSolutionSummary } = results;
const claudeLib = await import('./claude.lib.mjs');
const { executeClaude } = claudeLib;

const githubLinking = await import('./github-linking.lib.mjs');
const { extractLinkedIssueNumber } = githubLinking;

const usageLimitLib = await import('./usage-limit.lib.mjs');
const { formatResetTimeWithRelative } = usageLimitLib;

const errorHandlers = await import('./solve.error-handlers.lib.mjs');
const { createUncaughtExceptionHandler, createUnhandledRejectionHandler, handleMainExecutionError } = errorHandlers;

const watchLib = await import('./solve.watch.lib.mjs');
const { startWatchMode } = watchLib;
const autoMergeLib = await import('./solve.auto-merge.lib.mjs');
const { startAutoRestartUntilMergeable } = autoMergeLib;
const exitHandler = await import('./exit-handler.lib.mjs');
const { initializeExitHandler, installGlobalExitHandlers, safeExit } = exitHandler;
const interruptLib = await import('./solve.interrupt.lib.mjs');
const { createInterruptWrapper } = interruptLib;
const getResourceSnapshot = memoryCheck.getResourceSnapshot;

// Import new modular components
const autoPrLib = await import('./solve.auto-pr.lib.mjs');
const { handleAutoPrCreation } = autoPrLib;
const repoSetupLib = await import('./solve.repo-setup.lib.mjs');
const { setupRepositoryAndClone, verifyDefaultBranchAndStatus } = repoSetupLib;
const branchLib = await import('./solve.branch.lib.mjs');
const { createOrCheckoutBranch } = branchLib;
const sessionLib = await import('./solve.session.lib.mjs');
const { startWorkSession, endWorkSession, SESSION_TYPES } = sessionLib;
const preparationLib = await import('./solve.preparation.lib.mjs');
const { prepareFeedbackAndTimestamps, checkUncommittedChanges, checkForkActions } = preparationLib;

// Import model validation library
const modelValidation = await import('./model-validation.lib.mjs');
const { validateAndExitOnInvalidModel } = modelValidation;
const acceptInviteLib = await import('./solve.accept-invite.lib.mjs');
const { autoAcceptInviteForRepo } = acceptInviteLib;

// Initialize log file EARLY to capture all output including version and command
// Use default directory (cwd) initially, will be set from argv.logDir after parsing
const logFile = await initializeLogFile(null);

// Log version and raw command IMMEDIATELY after log file initialization
// This ensures they appear in both console and log file, even if argument parsing fails
const versionInfo = await getVersionInfo();
await log('');
await log(`🚀 solve v${versionInfo}`);
const rawCommand = process.argv.join(' ');
await log('🔧 Raw command executed:');
await log(`   ${rawCommand}`);
await log('');

let argv;
try {
  argv = await parseArguments(yargs, hideBin);
} catch (error) {
  // Handle argument parsing errors with helpful messages
  await log(`❌ ${error.message}`, { level: 'error' });
  await log('', { level: 'error' });
  await log('Use /help to see available options', { level: 'error' });
  await safeExit(1, 'Invalid command-line arguments');
}
global.verboseMode = argv.verbose;

// If user specified a custom log directory, we would need to move the log file
// However, this adds complexity, so we accept that early logs go to cwd
// The trade-off is: early logs in cwd vs missing version/command in error cases

// Conditionally import tool-specific functions after argv is parsed
let checkForUncommittedChanges;
if (argv.tool === 'opencode') {
  const opencodeLib = await import('./opencode.lib.mjs');
  checkForUncommittedChanges = opencodeLib.checkForUncommittedChanges;
} else if (argv.tool === 'codex') {
  const codexLib = await import('./codex.lib.mjs');
  checkForUncommittedChanges = codexLib.checkForUncommittedChanges;
} else if (argv.tool === 'agent') {
  const agentLib = await import('./agent.lib.mjs');
  checkForUncommittedChanges = agentLib.checkForUncommittedChanges;
} else {
  checkForUncommittedChanges = claudeLib.checkForUncommittedChanges;
}
const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
await showAttachLogsWarning(shouldAttachLogs);
const absoluteLogPath = path.resolve(logFile);
// Initialize Sentry integration (unless disabled)
if (argv.sentry) {
  await initializeSentry({
    noSentry: !argv.sentry,
    debug: argv.verbose,
    version: process.env.npm_package_version || '0.12.0',
  });
  // Add breadcrumb for solve operation
  addBreadcrumb({
    category: 'solve',
    message: 'Started solving issue',
    level: 'info',
    data: {
      model: argv.model,
      issueUrl: argv['issue-url'] || argv._?.[0] || 'not-set-yet',
    },
  });
}
// Create cleanup/interrupt wrappers populated with context as solve progresses
let cleanupContext = { tempDir: null, argv: null, limitReached: false, branchName: null, prNumber: null, owner: null, repo: null };
const cleanupWrapper = async () => {
  if (cleanupContext.tempDir && cleanupContext.argv) {
    await cleanupTempDirectory(cleanupContext.tempDir, cleanupContext.argv, cleanupContext.limitReached);
  }
};
const interruptWrapper = createInterruptWrapper({ cleanupContext, checkForUncommittedChanges, shouldAttachLogs, attachLogToGitHub, getLogFile, sanitizeLogContent, $, log });
initializeExitHandler(getAbsoluteLogPath, log, cleanupWrapper, interruptWrapper);
installGlobalExitHandlers();

// Note: Version and raw command are logged BEFORE parseArguments() (see above)
// This ensures they appear even if strict validation fails
// Strict options validation is now handled by yargs .strict() mode in solve.config.lib.mjs
// This prevents unrecognized options from being silently ignored (issue #453, #482)

// Now handle argument validation that was moved from early checks
let issueUrl = argv['issue-url'] || argv._[0];
if (!issueUrl) {
  await log('Usage: solve.mjs <issue-url> [options]', { level: 'error' });
  await log('Error: Missing required github issue or pull request URL', { level: 'error' });
  await log('Run "solve.mjs --help" for more information', { level: 'error' });
  await safeExit(1, 'Missing required GitHub URL');
}
// Validate GitHub URL using validation module (more thorough check)
const urlValidation = validateGitHubUrl(issueUrl);
if (!urlValidation.isValid) {
  await safeExit(1, 'Invalid GitHub URL');
}
const { isIssueUrl, isPrUrl, normalizedUrl, owner, repo, number: urlNumber } = urlValidation;
issueUrl = normalizedUrl || issueUrl;
// Store owner and repo globally for error handlers and interrupt context
global.owner = owner;
global.repo = repo;
cleanupContext.owner = owner;
cleanupContext.repo = repo;
// Setup unhandled error handlers to ensure log path is always shown
const errorHandlerOptions = {
  log,
  cleanErrorMessage,
  absoluteLogPath,
  shouldAttachLogs,
  argv,
  global,
  owner: null, // Will be set later when parsed
  repo: null, // Will be set later when parsed
  getLogFile,
  attachLogToGitHub,
  sanitizeLogContent,
  $,
};
process.on('uncaughtException', createUncaughtExceptionHandler(errorHandlerOptions));
process.on('unhandledRejection', createUnhandledRejectionHandler(errorHandlerOptions));
// Validate GitHub URL requirement and options using validation module
if (!(await validateUrlRequirement(issueUrl))) {
  await safeExit(1, 'URL requirement validation failed');
}
if (!(await validateContinueOnlyOnFeedback(argv, isPrUrl, isIssueUrl))) {
  await safeExit(1, 'Feedback validation failed');
}

// Validate model name EARLY - this always runs regardless of --skip-tool-connection-check
// Model validation is a simple string check and should always be performed
const tool = argv.tool || 'claude';
await validateAndExitOnInvalidModel(argv.model, tool, safeExit);

// Perform all system checks using validation module
// Skip tool CONNECTION validation in dry-run mode or when --skip-tool-connection-check or --no-tool-connection-check is enabled
// Note: This does NOT skip model validation which is performed above
const skipToolConnectionCheck = argv.dryRun || argv.skipToolConnectionCheck || argv.toolConnectionCheck === false;
if (!(await performSystemChecks(argv.minDiskSpace || 2048, skipToolConnectionCheck, argv.model, argv))) {
  await safeExit(1, 'System checks failed');
}
// URL validation debug logging
if (argv.verbose) {
  await log('📋 URL validation:', { verbose: true });
  await log(`   Input URL: ${issueUrl}`, { verbose: true });
  await log(`   Is Issue URL: ${!!isIssueUrl}`, { verbose: true });
  await log(`   Is PR URL: ${!!isPrUrl}`, { verbose: true });
}
const claudePath = argv.executeToolWithBun ? 'bunx claude' : process.env.CLAUDE_PATH || 'claude';
// Note: owner, repo, and urlNumber are already extracted from validateGitHubUrl() above
// The parseUrlComponents() call was removed as it had a bug with hash fragments (#issuecomment-xyz)
// and the validation result already provides these values correctly parsed

// Handle --auto-fork option: automatically fork public repositories without write access
if (argv.autoFork && !argv.fork) {
  const { detectRepositoryVisibility } = githubLib;

  // Check if we have write access first
  await log('🔍 Checking repository access for auto-fork...');
  const permResult = await $`gh api repos/${owner}/${repo} --jq .permissions`;

  if (permResult.code === 0) {
    const permissions = JSON.parse(permResult.stdout.toString().trim());
    const hasWriteAccess = permissions.push === true || permissions.admin === true || permissions.maintain === true;

    if (!hasWriteAccess) {
      // No write access - check if repository is public before enabling fork mode
      const { isPublic } = await detectRepositoryVisibility(owner, repo);

      if (!isPublic) {
        // Private repository without write access - cannot fork
        await log('');
        await log("❌ --auto-fork failed: Repository is private and you don't have write access", { level: 'error' });
        await log('');
        await log('   🔍 What happened:', { level: 'error' });
        await log(`      Repository ${owner}/${repo} is private`, { level: 'error' });
        await log("      You don't have write access to this repository", { level: 'error' });
        await log('      --auto-fork cannot create a fork of a private repository you cannot access', {
          level: 'error',
        });
        await log('');
        await log('   💡 Solution:', { level: 'error' });
        await log('      • Request collaborator access from the repository owner', { level: 'error' });
        await log(`        https://github.com/${owner}/${repo}/settings/access`, { level: 'error' });
        await log('');
        await safeExit(1, 'Auto-fork failed - private repository without access');
      }

      // Public repository without write access - automatically enable fork mode
      await log('✅ Auto-fork: No write access detected, enabling fork mode');
      argv.fork = true;
    } else {
      // Has write access - work directly on the repo (works for both public and private repos)
      const { isPublic } = await detectRepositoryVisibility(owner, repo);
      await log(`✅ Auto-fork: Write access detected to ${isPublic ? 'public' : 'private'} repository, working directly on repository`);
    }
  } else {
    // Could not check permissions - assume no access and try to fork if public
    const { isPublic } = await detectRepositoryVisibility(owner, repo);

    if (!isPublic) {
      // Cannot determine permissions for private repo - fail safely
      await log('');
      await log('❌ --auto-fork failed: Could not verify permissions for private repository', { level: 'error' });
      await log('');
      await log('   🔍 What happened:', { level: 'error' });
      await log(`      Repository ${owner}/${repo} is private`, { level: 'error' });
      await log('      Could not check your permissions to this repository', { level: 'error' });
      await log('');
      await log('   💡 Solutions:', { level: 'error' });
      await log('      • Check your GitHub CLI authentication: gh auth status', { level: 'error' });
      await log("      • Request collaborator access if you don't have it yet", { level: 'error' });
      await log(`        https://github.com/${owner}/${repo}/settings/access`, { level: 'error' });
      await log('');
      await safeExit(1, 'Auto-fork failed - cannot verify private repository permissions');
    }

    // Public repository but couldn't check permissions - assume no access and fork
    await log('⚠️  Auto-fork: Could not check permissions, enabling fork mode for public repository');
    argv.fork = true;
  }
}

// Accept pending GitHub invitation for the specific repo/org before checking write access
if (argv.autoAcceptInvite) {
  await autoAcceptInviteForRepo(owner, repo, log, argv.verbose);
}

// Early check: Verify repository write permissions BEFORE doing any work
// This prevents wasting AI tokens when user doesn't have access and --fork is not used
const { checkRepositoryWritePermission } = githubLib;
const hasWriteAccess = await checkRepositoryWritePermission(owner, repo, {
  useFork: argv.fork,
  issueUrl: issueUrl,
});

if (!hasWriteAccess) {
  await log('');
  await log('❌ Cannot proceed without repository write access or --fork option', { level: 'error' });
  await safeExit(1, 'Permission check failed');
}

// Detect repository visibility and set auto-cleanup default if not explicitly set
if (argv.autoCleanup === undefined) {
  const { detectRepositoryVisibility } = githubLib;
  const { isPublic } = await detectRepositoryVisibility(owner, repo);
  // For public repos: keep temp directories (default false)
  // For private repos: clean up temp directories (default true)
  argv.autoCleanup = !isPublic;
  if (argv.verbose) {
    await log(`   Auto-cleanup default: ${argv.autoCleanup} (repository is ${isPublic ? 'public' : 'private'})`, {
      verbose: true,
    });
  }
}
// Determine mode and get issue details
let issueNumber;
let prNumber;
let prBranch;
let mergeStateStatus;
let prState;
let forkOwner = null;
let forkRepoName = null;
let isContinueMode = false;
// Auto-continue logic: check for existing PRs if --auto-continue is enabled
const autoContinueResult = await processAutoContinueForIssue(argv, isIssueUrl, urlNumber, owner, repo);
if (autoContinueResult.isContinueMode) {
  isContinueMode = true;
  prNumber = autoContinueResult.prNumber;
  prBranch = autoContinueResult.prBranch;
  issueNumber = autoContinueResult.issueNumber;
  // Only check PR details if we have a PR number
  if (prNumber) {
    // Store PR info globally for error handlers
    global.createdPR = { number: prNumber };
    // Check if PR is from a fork and get fork owner, merge status, and PR state
    if (argv.verbose) {
      await log('   Checking if PR is from a fork...', { verbose: true });
    }
    try {
      const prCheckResult = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRepositoryOwner,headRepository,mergeStateStatus,state`;
      if (prCheckResult.code === 0) {
        const prCheckData = JSON.parse(prCheckResult.stdout.toString());
        // Extract merge status and PR state
        mergeStateStatus = prCheckData.mergeStateStatus;
        prState = prCheckData.state;
        if (argv.verbose) {
          await log(`   PR state: ${prState || 'UNKNOWN'}`, { verbose: true });
          await log(`   Merge status: ${mergeStateStatus || 'UNKNOWN'}`, { verbose: true });
        }
        if (prCheckData.headRepositoryOwner && prCheckData.headRepositoryOwner.login !== owner) {
          forkOwner = prCheckData.headRepositoryOwner.login;
          // Get actual fork repository name (may be prefixed) and store for use in setupRepository
          forkRepoName = prCheckData.headRepository && prCheckData.headRepository.name ? prCheckData.headRepository.name : null;
          await log(`🍴 Detected fork PR from ${forkOwner}/${forkRepoName || repo}`);
          if (argv.verbose) {
            await log(`   Fork owner: ${forkOwner}`, { verbose: true });
            await log('   Will clone fork repository for continue mode', { verbose: true });
          }

          // Check if maintainer can push to the fork when --allow-to-push-to-contributors-pull-requests-as-maintainer is enabled
          if (argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork) {
            const { checkMaintainerCanModifyPR, requestMaintainerAccess } = githubLib;
            const { canModify } = await checkMaintainerCanModifyPR(owner, repo, prNumber);

            if (canModify) {
              await log('✅ Maintainer can push to fork: Enabled by contributor');
              await log("   Will push changes directly to contributor's fork instead of creating own fork");
              // Don't disable fork mode, but we'll use the contributor's fork
            } else {
              await log('⚠️  Maintainer cannot push to fork: "Allow edits by maintainers" is not enabled', {
                level: 'warning',
              });
              await log('   Posting comment to request access...', { level: 'warning' });
              await requestMaintainerAccess(owner, repo, prNumber);
              await log('   Comment posted. Proceeding with own fork instead.', { level: 'warning' });
            }
          }
        }
      }
    } catch (forkCheckError) {
      if (argv.verbose) {
        await log(`   Warning: Could not check fork status: ${forkCheckError.message}`, { verbose: true });
      }
    }
  } else {
    // We have a branch but no PR - we'll use the existing branch and create a PR later
    await log(`🔄 Using existing branch: ${prBranch} (no PR yet - will create one)`);
    if (argv.verbose) {
      await log('   Branch will be checked out and PR will be created during auto-PR creation phase', {
        verbose: true,
      });
    }
  }
} else if (isIssueUrl) {
  issueNumber = autoContinueResult.issueNumber || urlNumber;
}
if (isPrUrl) {
  isContinueMode = true;
  prNumber = urlNumber;
  // Store PR info globally for error handlers
  global.createdPR = { number: prNumber, url: issueUrl };
  await log(`🔄 Continue mode: Working with PR #${prNumber}`);
  if (argv.verbose) {
    await log('   Continue mode activated: PR URL provided directly', { verbose: true });
    await log(`   PR Number set to: ${prNumber}`, { verbose: true });
    await log('   Will fetch PR details and linked issue', { verbose: true });
  }
  // Get PR details to find the linked issue and branch
  try {
    const prResult = await githubLib.ghPrView({
      prNumber,
      owner,
      repo,
      jsonFields: 'headRefName,body,number,mergeStateStatus,state,headRepositoryOwner,headRepository',
    });
    if (prResult.code !== 0 || !prResult.data) {
      await log('Error: Failed to get PR details', { level: 'error' });
      if (prResult.output.includes('Could not resolve to a PullRequest')) {
        await githubLib.handlePRNotFoundError({ prNumber, owner, repo, argv, shouldAttachLogs });
      } else {
        await log(`Error: ${prResult.stderr || 'Unknown error'}`, { level: 'error' });
      }
      await safeExit(1, 'Failed to get PR details');
    }
    const prData = prResult.data;
    prBranch = prData.headRefName;
    mergeStateStatus = prData.mergeStateStatus;
    prState = prData.state;
    // Check if this is a fork PR
    if (prData.headRepositoryOwner && prData.headRepositoryOwner.login !== owner) {
      forkOwner = prData.headRepositoryOwner.login;
      // Get actual fork repository name and store for use in setupRepository
      forkRepoName = prData.headRepository && prData.headRepository.name ? prData.headRepository.name : null;
      await log(`🍴 Detected fork PR from ${forkOwner}/${forkRepoName || repo}`);
      if (argv.verbose) {
        await log(`   Fork owner: ${forkOwner}`, { verbose: true });
        await log('   Will clone fork repository for continue mode', { verbose: true });
      }

      // Check if maintainer can push to the fork when --allow-to-push-to-contributors-pull-requests-as-maintainer is enabled
      if (argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork) {
        const { checkMaintainerCanModifyPR, requestMaintainerAccess } = githubLib;
        const { canModify } = await checkMaintainerCanModifyPR(owner, repo, prNumber);

        if (canModify) {
          await log('✅ Maintainer can push to fork: Enabled by contributor');
          await log("   Will push changes directly to contributor's fork instead of creating own fork");
          // Don't disable fork mode, but we'll use the contributor's fork
        } else {
          await log('⚠️  Maintainer cannot push to fork: "Allow edits by maintainers" is not enabled', {
            level: 'warning',
          });
          await log('   Posting comment to request access...', { level: 'warning' });
          await requestMaintainerAccess(owner, repo, prNumber);
          await log('   Comment posted. Proceeding with own fork instead.', { level: 'warning' });
        }
      }
    }
    await log(`📝 PR branch: ${prBranch}`);
    // Extract issue number from PR body using GitHub linking detection library
    // This ensures we only detect actual GitHub-recognized linking keywords
    const prBody = prData.body || '';
    const extractedIssueNumber = extractLinkedIssueNumber(prBody);
    if (extractedIssueNumber) {
      issueNumber = extractedIssueNumber;
      await log(`🔗 Found linked issue #${issueNumber}`);
    } else {
      // If no linked issue found, we can still continue but warn
      await log('⚠️  Warning: No linked issue found in PR body', { level: 'warning' });
      await log('   The PR should contain "Fixes #123" or similar to link an issue', { level: 'warning' });
      // Set issueNumber to PR number as fallback
      issueNumber = prNumber;
    }
  } catch (error) {
    reportError(error, {
      context: 'pr_processing',
      prNumber,
      operation: 'process_pull_request',
    });
    await log(`Error: Failed to process PR: ${cleanErrorMessage(error)}`, { level: 'error' });
    await safeExit(1, 'Failed to process PR');
  }
} else {
  // Traditional issue mode
  issueNumber = urlNumber;
  await log(`📝 Issue mode: Working with issue #${issueNumber}`);
}
// Create or find temporary directory for cloning the repository
// Pass workspace info for --enable-workspaces mode (works with all tools)
const workspaceInfo = argv.enableWorkspaces ? { owner, repo, issueNumber } : null;
const { tempDir, workspaceTmpDir, needsClone } = await setupTempDirectory(argv, workspaceInfo);
// Populate cleanup context for signal handlers (owner/repo updated again here for redundancy)
cleanupContext.tempDir = tempDir;
cleanupContext.argv = argv;
cleanupContext.owner = owner;
cleanupContext.repo = repo;
if (prNumber) cleanupContext.prNumber = prNumber;
// Initialize limitReached variable outside try block for finally clause
let limitReached = false;
try {
  // Set up repository and clone using the new module
  // If --working-directory points to existing repo, needsClone is false and we skip cloning
  const { forkedRepo } = await setupRepositoryAndClone({
    argv,
    owner,
    repo,
    forkOwner,
    forkRepoName,
    tempDir,
    isContinueMode,
    issueUrl,
    log,
    formatAligned,
    $,
    needsClone,
  });

  // Verify default branch and status using the new module
  const defaultBranch = await verifyDefaultBranchAndStatus({
    tempDir,
    log,
    formatAligned,
    $,
  });
  // Create or checkout branch using the new module
  const branchName = await createOrCheckoutBranch({
    isContinueMode,
    prBranch,
    issueNumber,
    tempDir,
    defaultBranch,
    argv,
    log,
    formatAligned,
    $,
    crypto,
    owner,
    repo,
    prNumber,
  });
  cleanupContext.branchName = branchName;

  // Auto-merge default branch to pull request branch if enabled
  let autoMergeFeedbackLines = [];
  if (isContinueMode && argv['auto-merge-default-branch-to-pull-request-branch']) {
    await log(`\n${formatAligned('🔀', 'Auto-merging:', `Merging ${defaultBranch} into ${branchName}`)}`);
    try {
      const mergeResult = await $({ cwd: tempDir })`git merge ${defaultBranch} --no-edit`;
      if (mergeResult.code === 0) {
        await log(`${formatAligned('✅', 'Merge successful:', 'Pushing merged branch...')}`);
        const pushResult = await $({ cwd: tempDir })`git push origin ${branchName}`;
        if (pushResult.code === 0) {
          await log(`${formatAligned('✅', 'Push successful:', 'Branch updated with latest changes')}`);
        } else {
          await log(`${formatAligned('⚠️', 'Push failed:', 'Merge completed but push failed')}`, { level: 'warning' });
          await log(`  Error: ${pushResult.stderr?.toString() || 'Unknown error'}`, { level: 'warning' });
        }
      } else {
        // Merge failed - likely due to conflicts
        await log(`${formatAligned('⚠️', 'Merge failed:', 'Conflicts detected')}`, { level: 'warning' });
        autoMergeFeedbackLines.push('');
        autoMergeFeedbackLines.push('⚠️ AUTOMATIC MERGE FAILED:');
        autoMergeFeedbackLines.push(`git merge ${defaultBranch} was executed but resulted in conflicts that should be resolved first.`);
        autoMergeFeedbackLines.push('Please resolve the merge conflicts and commit the changes.');
        autoMergeFeedbackLines.push('');
      }
    } catch (mergeError) {
      await log(`${formatAligned('❌', 'Merge error:', mergeError.message)}`, { level: 'error' });
      autoMergeFeedbackLines.push('');
      autoMergeFeedbackLines.push('⚠️ AUTOMATIC MERGE ERROR:');
      autoMergeFeedbackLines.push(`git merge ${defaultBranch} failed with error: ${mergeError.message}`);
      autoMergeFeedbackLines.push('Please check the repository state and resolve any issues.');
      autoMergeFeedbackLines.push('');
    }
  }

  // Initialize PR variables early
  let prUrl = null;

  // In continue mode, we already have the PR details
  if (isContinueMode) {
    prUrl = issueUrl; // The input URL is the PR URL
    // prNumber is already set from earlier when we parsed the PR
  }

  // Don't build the prompt yet - we'll build it after we have all the information
  // This includes PR URL (if created) and comment info (if in continue mode)

  // Handle auto PR creation using the new module
  const autoPrResult = await handleAutoPrCreation({
    argv,
    tempDir,
    branchName,
    issueNumber,
    owner,
    repo,
    defaultBranch,
    forkedRepo,
    isContinueMode,
    prNumber,
    log,
    formatAligned,
    $,
    reportError,
    path,
    fs,
  });

  let claudeCommitHash = null;
  if (autoPrResult) {
    prUrl = autoPrResult.prUrl;
    if (autoPrResult.prNumber) {
      prNumber = autoPrResult.prNumber;
    }
    if (autoPrResult.claudeCommitHash) {
      claudeCommitHash = autoPrResult.claudeCommitHash;
    }
  }
  if (prNumber) cleanupContext.prNumber = prNumber;

  // CRITICAL: Validate that we have a PR number when required
  // This prevents continuing without a PR when one was supposed to be created
  if ((isContinueMode || argv.autoPullRequestCreation) && !prNumber) {
    await log('');
    await log(formatAligned('❌', 'FATAL ERROR:', 'No pull request available'), { level: 'error' });
    await log('');
    await log('  🔍 What happened:');
    if (isContinueMode) {
      await log('     Continue mode is active but no PR number is available.');
      await log('     This usually means PR creation failed or was skipped incorrectly.');
    } else {
      await log('     Auto-PR creation is enabled but no PR was created.');
      await log('     PR creation may have failed without throwing an error.');
    }
    await log('');
    await log('  💡 Why this is critical:');
    await log('     The solve command requires a PR for:');
    await log('     • Tracking work progress');
    await log('     • Receiving and processing feedback');
    await log('     • Managing code changes');
    await log('     • Auto-merging when complete');
    await log('');
    await log('  🔧 How to fix:');
    await log('');
    await log('  Option 1: Create PR manually and use --continue');
    await log(`     cd ${tempDir}`);
    await log(`     gh pr create --draft --title "Fix issue #${issueNumber}" --body "Fixes #${issueNumber}"`);
    await log('     # Then use the PR URL with solve.mjs');
    await log('');
    await log('  Option 2: Start fresh without continue mode');
    await log(`     ./solve.mjs "${issueUrl}" --auto-pull-request-creation`);
    await log('');
    await log('  Option 3: Disable auto-PR creation (Claude will create it)');
    await log(`     ./solve.mjs "${issueUrl}" --no-auto-pull-request-creation`);
    await log('');
    await safeExit(1, 'No PR available');
  }

  if (isContinueMode) {
    await log(`\n${formatAligned('🔄', 'Continue mode:', 'ACTIVE')}`);
    await log(formatAligned('', 'Using existing PR:', `#${prNumber}`, 2));
    await log(formatAligned('', 'PR URL:', prUrl, 2));
  } else if (!argv.autoPullRequestCreation) {
    await log(`\n${formatAligned('⏭️', 'Auto PR creation:', 'DISABLED')}`);
    await log(formatAligned('', 'Workflow:', 'AI will create the PR', 2));
  }

  // Don't build the prompt yet - we'll build it after we have all the information
  // This includes PR URL (if created) and comment info (if in continue mode)

  // Start work session using the new module
  // Determine session type based on command line flags
  // See: https://github.com/link-assistant/hive-mind/issues/1152
  let sessionType = SESSION_TYPES.NEW;
  if (argv.sessionType) {
    // Session type was explicitly set (e.g., by auto-resume/auto-restart spawning a new process)
    sessionType = argv.sessionType;
  } else if (isContinueMode) {
    // Continue mode is a manual resume via PR URL
    sessionType = SESSION_TYPES.RESUME;
  }
  await startWorkSession({
    isContinueMode,
    prNumber,
    argv,
    log,
    formatAligned,
    $,
    sessionType,
  });

  // Prepare feedback and timestamps using the new module
  const { feedbackLines: preparedFeedbackLines, referenceTime } = await prepareFeedbackAndTimestamps({
    prNumber,
    branchName,
    owner,
    repo,
    issueNumber,
    isContinueMode,
    mergeStateStatus,
    prState,
    argv,
    log,
    formatAligned,
    cleanErrorMessage,
    $,
  });

  // Initialize feedback lines
  let feedbackLines = null;

  // Add auto-merge feedback lines if any
  if (autoMergeFeedbackLines && autoMergeFeedbackLines.length > 0) {
    if (!feedbackLines) {
      feedbackLines = [];
    }
    feedbackLines.push(...autoMergeFeedbackLines);
  }

  // Merge feedback lines
  if (preparedFeedbackLines && preparedFeedbackLines.length > 0) {
    if (!feedbackLines) {
      feedbackLines = [];
    }
    feedbackLines.push(...preparedFeedbackLines);
  }

  // Check for uncommitted changes and merge with feedback
  const uncommittedFeedbackLines = await checkUncommittedChanges({
    tempDir,
    argv,
    log,
    $,
  });
  if (uncommittedFeedbackLines && uncommittedFeedbackLines.length > 0) {
    if (!feedbackLines) {
      feedbackLines = [];
    }
    feedbackLines.push(...uncommittedFeedbackLines);
  }

  // Check for fork actions
  const forkActionsUrl = await checkForkActions({
    argv,
    forkedRepo,
    branchName,
    log,
    formatAligned,
    $,
  });

  // Execute tool command with all prompts and settings
  let toolResult;
  if (argv.tool === 'opencode') {
    const opencodeLib = await import('./opencode.lib.mjs');
    const { executeOpenCode } = opencodeLib;
    const opencodePath = process.env.OPENCODE_PATH || 'opencode';

    toolResult = await executeOpenCode({
      issueUrl,
      issueNumber,
      prNumber,
      prUrl,
      branchName,
      tempDir,
      workspaceTmpDir,
      isContinueMode,
      mergeStateStatus,
      forkedRepo,
      feedbackLines,
      forkActionsUrl,
      owner,
      repo,
      argv,
      log,
      setLogFile,
      getLogFile,
      formatAligned,
      getResourceSnapshot,
      opencodePath,
      $,
    });
  } else if (argv.tool === 'codex') {
    const codexLib = await import('./codex.lib.mjs');
    const { executeCodex } = codexLib;
    const codexPath = process.env.CODEX_PATH || 'codex';

    toolResult = await executeCodex({
      issueUrl,
      issueNumber,
      prNumber,
      prUrl,
      branchName,
      tempDir,
      workspaceTmpDir,
      isContinueMode,
      mergeStateStatus,
      forkedRepo,
      feedbackLines,
      forkActionsUrl,
      owner,
      repo,
      argv,
      log,
      setLogFile,
      getLogFile,
      formatAligned,
      getResourceSnapshot,
      codexPath,
      $,
    });
  } else if (argv.tool === 'agent') {
    const agentLib = await import('./agent.lib.mjs');
    const { executeAgent } = agentLib;
    const agentPath = process.env.AGENT_PATH || 'agent';

    toolResult = await executeAgent({
      issueUrl,
      issueNumber,
      prNumber,
      prUrl,
      branchName,
      tempDir,
      workspaceTmpDir,
      isContinueMode,
      mergeStateStatus,
      forkedRepo,
      feedbackLines,
      forkActionsUrl,
      owner,
      repo,
      argv,
      log,
      setLogFile,
      getLogFile,
      formatAligned,
      getResourceSnapshot,
      agentPath,
      $,
    });
  } else {
    // Default to Claude
    // Check for Playwright MCP availability if using Claude tool
    if (argv.tool === 'claude' || !argv.tool) {
      // If flag is true (default), check if Playwright MCP is actually available
      if (argv.promptPlaywrightMcp) {
        const { checkPlaywrightMcpAvailability } = claudeLib;
        const playwrightMcpAvailable = await checkPlaywrightMcpAvailability();
        if (playwrightMcpAvailable) {
          await log('🎭 Playwright MCP detected - enabling browser automation hints', { verbose: true });
        } else {
          await log('ℹ️  Playwright MCP not detected - browser automation hints will be disabled', { verbose: true });
          argv.promptPlaywrightMcp = false;
        }
      } else {
        await log('ℹ️  Playwright MCP explicitly disabled via --no-prompt-playwright-mcp', { verbose: true });
      }
    }
    const claudeResult = await executeClaude({
      issueUrl,
      issueNumber,
      prNumber,
      prUrl,
      branchName,
      tempDir,
      workspaceTmpDir,
      isContinueMode,
      mergeStateStatus,
      forkedRepo,
      feedbackLines,
      forkActionsUrl,
      owner,
      repo,
      argv,
      log,
      setLogFile,
      getLogFile,
      formatAligned,
      getResourceSnapshot,
      claudePath,
      $,
    });
    toolResult = claudeResult;
  }

  const { success } = toolResult;
  let sessionId = toolResult.sessionId;
  let anthropicTotalCostUSD = toolResult.anthropicTotalCostUSD;
  let publicPricingEstimate = toolResult.publicPricingEstimate; // Used by agent tool
  let pricingInfo = toolResult.pricingInfo; // Used by agent tool for detailed pricing
  let errorDuringExecution = toolResult.errorDuringExecution || false; // Issue #1088: Track error_during_execution
  let resultSummary = toolResult.resultSummary || null; // Issue #1263: Capture result summary for --attach-solution-summary
  limitReached = toolResult.limitReached;
  cleanupContext.limitReached = limitReached;

  // Capture limit reset time and timezone globally for downstream handlers (auto-continue, cleanup decisions)
  if (toolResult && toolResult.limitResetTime) {
    global.limitResetTime = toolResult.limitResetTime;
  }
  if (toolResult && toolResult.limitTimezone) {
    global.limitTimezone = toolResult.limitTimezone;
  }

  // Handle limit reached scenario
  if (limitReached) {
    // Check for both auto-resume (maintains context) and auto-restart (fresh start)
    // See: https://github.com/link-assistant/hive-mind/issues/1152
    const shouldAutoResumeOnReset = argv.autoResumeOnLimitReset;
    const shouldAutoRestartOnReset = argv.autoRestartOnLimitReset;
    const shouldAutoContinueOnReset = shouldAutoResumeOnReset || shouldAutoRestartOnReset;

    // If limit was reached but neither auto-resume nor auto-restart is enabled, fail immediately
    if (!shouldAutoContinueOnReset) {
      await log('\n❌ USAGE LIMIT REACHED!');
      await log('   The AI tool has reached its usage limit.');

      // Always show manual resume command in console so users can resume after limit resets
      if (sessionId) {
        const resetTime = global.limitResetTime;
        const timezone = global.limitTimezone || null;
        await log('');
        await log(`📁 Working directory: ${tempDir}`);
        await log(`📌 Session ID: ${sessionId}`);
        if (resetTime) {
          // Format reset time with relative time and UTC for better user understanding
          // See: https://github.com/link-assistant/hive-mind/issues/1152
          const formattedResetTime = formatResetTimeWithRelative(resetTime, timezone);
          await log(`⏰ Limit resets at: ${formattedResetTime}`);
        }
        await log('');
        // Show claude resume command only for --tool claude (or default)
        // Uses the (cd ... && claude --resume ...) pattern for a fully copyable, executable command
        const toolForResume = argv.tool || 'claude';
        if (toolForResume === 'claude') {
          const claudeResumeCmd = buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model });
          await log('💡 To continue this session in Claude Code interactive mode:');
          await log('');
          await log(`   ${claudeResumeCmd}`);
          await log('');
        }
      }

      // If --attach-logs is enabled and we have a PR, attach logs with usage limit details
      if (shouldAttachLogs && sessionId && prNumber) {
        await log('\n📄 Attaching logs to Pull Request...');
        try {
          // Build Claude CLI resume command
          const tool = argv.tool || 'claude';
          const resumeCommand = tool === 'claude' ? buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model }) : null;
          const logUploadSuccess = await attachLogToGitHub({
            logFile: getLogFile(),
            targetType: 'pr',
            targetNumber: prNumber,
            owner,
            repo,
            $,
            log,
            sanitizeLogContent,
            // Mark this as a usage limit case for proper formatting
            isUsageLimit: true,
            limitResetTime: global.limitResetTime,
            toolName: (argv.tool || 'AI tool').toString().toLowerCase() === 'claude' ? 'Claude' : (argv.tool || 'AI tool').toString().toLowerCase() === 'codex' ? 'Codex' : (argv.tool || 'AI tool').toString().toLowerCase() === 'opencode' ? 'OpenCode' : (argv.tool || 'AI tool').toString().toLowerCase() === 'agent' ? 'Agent' : 'AI tool',
            resumeCommand,
            sessionId,
          });

          if (logUploadSuccess) {
            await log('  ✅ Logs uploaded successfully');
          } else {
            await log('  ⚠️  Failed to upload logs', { verbose: true });
          }
        } catch (uploadError) {
          await log(`  ⚠️  Error uploading logs: ${uploadError.message}`, { verbose: true });
        }
      } else if (prNumber) {
        // Fallback: Post simple failure comment if logs are not attached
        try {
          const resetTime = global.limitResetTime;
          // Build Claude CLI resume command
          const tool = argv.tool || 'claude';
          const resumeCmd = tool === 'claude' ? buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model }) : null;
          const resumeSection = resumeCmd ? `To resume after the limit resets, use:\n\`\`\`bash\n${resumeCmd}\n\`\`\`` : `Session ID: \`${sessionId}\``;
          // Format the reset time with relative time and UTC conversion if available
          const timezone = global.limitTimezone || null;
          const formattedResetTime = resetTime ? formatResetTimeWithRelative(resetTime, timezone) : null;
          const failureComment = formattedResetTime ? `❌ **Usage Limit Reached**\n\nThe AI tool has reached its usage limit. The limit will reset at: **${formattedResetTime}**\n\n${resumeSection}` : `❌ **Usage Limit Reached**\n\nThe AI tool has reached its usage limit. Please wait for the limit to reset.\n\n${resumeSection}`;

          const commentResult = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${failureComment}`;
          if (commentResult.code === 0) {
            await log('   Posted failure comment to PR');
          }
        } catch (error) {
          await log(`   Warning: Could not post failure comment: ${cleanErrorMessage(error)}`, { verbose: true });
        }
      }

      await safeExit(1, 'Usage limit reached - use --auto-resume-on-limit-reset or --auto-restart-on-limit-reset to wait for reset');
    } else {
      // auto-resume-on-limit-reset or auto-restart-on-limit-reset is enabled - attach logs and/or post waiting comment
      // Determine the mode type for comment formatting
      const limitContinueMode = shouldAutoRestartOnReset ? 'restart' : 'resume';
      if (prNumber && global.limitResetTime) {
        // If --attach-logs is enabled, upload logs with usage limit details
        if (shouldAttachLogs && sessionId) {
          await log('\n📄 Attaching logs to Pull Request (auto-continue mode)...');
          try {
            // Build Claude CLI resume command (only for logging, not shown to users when auto-resume is enabled)
            const tool = argv.tool || 'claude';
            const resumeCommand = tool === 'claude' ? buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model }) : null;
            const logUploadSuccess = await attachLogToGitHub({
              logFile: getLogFile(),
              targetType: 'pr',
              targetNumber: prNumber,
              owner,
              repo,
              $,
              log,
              sanitizeLogContent,
              // Mark this as a usage limit case for proper formatting
              isUsageLimit: true,
              limitResetTime: global.limitResetTime,
              toolName: (argv.tool || 'AI tool').toString().toLowerCase() === 'claude' ? 'Claude' : (argv.tool || 'AI tool').toString().toLowerCase() === 'codex' ? 'Codex' : (argv.tool || 'AI tool').toString().toLowerCase() === 'opencode' ? 'OpenCode' : (argv.tool || 'AI tool').toString().toLowerCase() === 'agent' ? 'Agent' : 'AI tool',
              resumeCommand,
              sessionId,
              // Tell attachLogToGitHub that auto-resume is enabled to suppress CLI commands in the comment
              // See: https://github.com/link-assistant/hive-mind/issues/1152
              isAutoResumeEnabled: true,
              autoResumeMode: limitContinueMode,
            });

            if (logUploadSuccess) {
              await log('  ✅ Logs uploaded successfully');
            } else {
              await log('  ⚠️  Failed to upload logs', { verbose: true });
            }
          } catch (uploadError) {
            await log(`  ⚠️  Error uploading logs: ${uploadError.message}`, { verbose: true });
          }
        } else {
          // Fallback: Post simple waiting comment if logs are not attached
          try {
            // Calculate wait time in d:h:m:s format
            const validation = await import('./solve.validation.lib.mjs');
            const { calculateWaitTime } = validation;
            const waitMs = calculateWaitTime(global.limitResetTime);

            const formatWaitTime = ms => {
              const seconds = Math.floor(ms / 1000);
              const minutes = Math.floor(seconds / 60);
              const hours = Math.floor(minutes / 60);
              const days = Math.floor(hours / 24);
              const s = seconds % 60;
              const m = minutes % 60;
              const h = hours % 24;
              return `${days}:${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            };

            // For waiting comments, don't show CLI commands since auto-continue will handle it automatically
            // See: https://github.com/link-assistant/hive-mind/issues/1152
            const continueModeName = limitContinueMode === 'restart' ? 'auto-restart' : 'auto-resume';
            const continueDescription = limitContinueMode === 'restart' ? 'The session will automatically restart (fresh start) when the limit resets.' : 'The session will automatically resume (with context preserved) when the limit resets.';
            // Format reset time with relative time and UTC for better user understanding
            // See: https://github.com/link-assistant/hive-mind/issues/1236
            const waitingResetTimeFormatted = formatResetTimeWithRelative(global.limitResetTime, global.limitTimezone || null) || global.limitResetTime;
            const waitingComment = `⏳ **Usage Limit Reached - Waiting to ${limitContinueMode === 'restart' ? 'Restart' : 'Continue'}**\n\nThe AI tool has reached its usage limit. ${continueModeName} is enabled.\n\n**Reset time:** ${waitingResetTimeFormatted}\n**Wait time:** ${formatWaitTime(waitMs)} (days:hours:minutes:seconds)\n\n${continueDescription}\n\nSession ID: \`${sessionId}\``;

            const commentResult = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${waitingComment}`;
            if (commentResult.code === 0) {
              await log('   Posted waiting comment to PR');
            }
          } catch (error) {
            await log(`   Warning: Could not post waiting comment: ${cleanErrorMessage(error)}`, { verbose: true });
          }
        }
      }
    }
  }

  // Handle failure cases, but skip exit if limit reached with auto-resume enabled
  // This allows the code to continue to showSessionSummary() where autoContinueWhenLimitResets() is called
  const shouldSkipFailureExitForAutoLimitContinue = limitReached && argv.autoResumeOnLimitReset;

  if (!success && !shouldSkipFailureExitForAutoLimitContinue) {
    // Show claude resume command only for --tool claude (or default) on failure
    // Uses the (cd ... && claude --resume ...) pattern for a fully copyable, executable command
    const toolForFailure = argv.tool || 'claude';
    if (sessionId && toolForFailure === 'claude') {
      const claudeResumeCmd = buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model });
      await log('');
      await log('💡 To continue this session in Claude Code interactive mode:');
      await log('');
      await log(`   ${claudeResumeCmd}`);
      await log('');
    }

    // If --attach-logs is enabled and we have a PR, attach failure logs before exiting
    // Note: sessionId is not required - logs should be uploaded even if agent failed before establishing a session
    // This aligns with the pattern in handleFailure() in solve.error-handlers.lib.mjs
    if (shouldAttachLogs && global.createdPR && global.createdPR.number) {
      await log('\n📄 Attaching failure logs to Pull Request...');
      try {
        // Build Claude CLI resume command
        const tool = argv.tool || 'claude';
        const resumeCommand = sessionId && tool === 'claude' ? buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model }) : null;
        const logUploadSuccess = await attachLogToGitHub({
          logFile: getLogFile(),
          targetType: 'pr',
          targetNumber: global.createdPR.number,
          owner,
          repo,
          $,
          log,
          sanitizeLogContent,
          // For usage limit, use a dedicated comment format to make it clear and actionable
          isUsageLimit: !!limitReached,
          limitResetTime: limitReached ? toolResult.limitResetTime : null,
          toolName: (argv.tool || 'AI tool').toString().toLowerCase() === 'claude' ? 'Claude' : (argv.tool || 'AI tool').toString().toLowerCase() === 'codex' ? 'Codex' : (argv.tool || 'AI tool').toString().toLowerCase() === 'opencode' ? 'OpenCode' : (argv.tool || 'AI tool').toString().toLowerCase() === 'agent' ? 'Agent' : 'AI tool',
          resumeCommand,
          // Include sessionId so the PR comment can present it
          sessionId,
          // If not a usage limit case, fall back to generic failure format
          errorMessage: limitReached ? undefined : `${argv.tool.toUpperCase()} execution failed`,
        });

        if (logUploadSuccess) {
          await log('  ✅ Failure logs uploaded successfully');
        } else {
          await log('  ⚠️  Failed to upload logs', { verbose: true });
        }
      } catch (uploadError) {
        await log(`  ⚠️  Error uploading logs: ${uploadError.message}`, { verbose: true });
      }
    }

    await safeExit(1, `${argv.tool.toUpperCase()} execution failed`);
  }

  // Clean up .playwright-mcp/ folder before checking for uncommitted changes
  // This prevents browser automation artifacts from triggering auto-restart (Issue #1124)
  if (argv.playwrightMcpAutoCleanup !== false) {
    const playwrightMcpDir = path.join(tempDir, '.playwright-mcp');
    try {
      const playwrightMcpExists = await fs
        .stat(playwrightMcpDir)
        .then(() => true)
        .catch(() => false);
      if (playwrightMcpExists) {
        await fs.rm(playwrightMcpDir, { recursive: true, force: true });
        await log('🧹 Cleaned up .playwright-mcp/ folder (browser automation artifacts)', { verbose: true });
      }
    } catch (cleanupError) {
      // Non-critical error, just log and continue
      await log(`⚠️  Could not clean up .playwright-mcp/ folder: ${cleanupError.message}`, { verbose: true });
    }
  } else {
    await log('ℹ️  Playwright MCP auto-cleanup disabled via --no-playwright-mcp-auto-cleanup', { verbose: true });
  }

  // Check for uncommitted changes
  // When limit is reached, force auto-commit of any uncommitted changes to preserve work
  const shouldAutoCommit = argv['auto-commit-uncommitted-changes'] || limitReached;
  const autoRestartEnabled = argv['autoRestartOnUncommittedChanges'] !== false;
  const shouldRestart = await checkForUncommittedChanges(tempDir, owner, repo, branchName, $, log, shouldAutoCommit, autoRestartEnabled);

  // Remove initial commit file (CLAUDE.md or .gitkeep) now that Claude command has finished
  await cleanupClaudeFile(tempDir, branchName, claudeCommitHash, argv);

  // Show summary of session and log file
  await showSessionSummary(sessionId, limitReached, argv, issueUrl, tempDir, shouldAttachLogs);

  // Issue #1263: Handle solution summary attachment
  // --attach-solution-summary: Always attach if result summary is available
  // --auto-attach-solution-summary: Only attach if AI didn't create any comments during session
  if (success && resultSummary && (argv.attachSolutionSummary || argv.autoAttachSolutionSummary)) {
    let shouldAttachSummary = false;

    if (argv.attachSolutionSummary) {
      // Explicit flag - always attach
      shouldAttachSummary = true;
      await log('📝 --attach-solution-summary enabled, attaching result summary...');
    } else if (argv.autoAttachSolutionSummary) {
      // Auto mode - only attach if AI didn't create comments
      await log('🔍 Checking if AI created any comments during session (--auto-attach-solution-summary)...');
      const aiCreatedComments = await checkForAiCreatedComments(referenceTime, owner, repo, prNumber, issueNumber);
      if (aiCreatedComments) {
        await log('ℹ️  AI created comments during session, skipping solution summary attachment');
      } else {
        shouldAttachSummary = true;
        await log('📝 No AI comments detected, attaching solution summary...');
      }
    }

    if (shouldAttachSummary) {
      await attachSolutionSummary({
        resultSummary,
        prNumber,
        issueNumber,
        owner,
        repo,
      });
    }
  } else if ((argv.attachSolutionSummary || argv.autoAttachSolutionSummary) && !resultSummary) {
    await log('ℹ️  No solution summary available from AI tool output', { verbose: true });
  }

  // Search for newly created pull requests and comments
  // Pass shouldRestart to prevent early exit when auto-restart is needed
  // Include agent tool pricing data when available (publicPricingEstimate, pricingInfo)
  // Issue #1088: Pass errorDuringExecution for "Finished with errors" state
  // Issue #1152: Pass sessionType for differentiated log comments
  // Issue #1154: Track if logs were already uploaded to prevent duplicates
  const verifyResult = await verifyResults(owner, repo, branchName, issueNumber, prNumber, prUrl, referenceTime, argv, shouldAttachLogs, shouldRestart, sessionId, tempDir, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo, errorDuringExecution, sessionType);
  const logsAlreadyUploaded = verifyResult?.logUploadSuccess || false;

  // Issue #1162: Auto-restart when PR title/description still has placeholder content
  if (argv.autoRestartOnNonUpdatedPullRequestDescription && (verifyResult?.prTitleHasPlaceholder || verifyResult?.prBodyHasPlaceholder)) {
    const { buildPRNotUpdatedHint } = results;
    const hintLines = buildPRNotUpdatedHint(verifyResult.prTitleHasPlaceholder, verifyResult.prBodyHasPlaceholder);

    await log('');
    await log('🔄 AUTO-RESTART: PR title/description not updated by agent');
    hintLines.forEach(async line => await log(`   ${line}`));
    await log('   Restarting tool to give agent another chance to update...');
    await log('');

    // Import executeToolIteration for re-execution
    const { executeToolIteration } = await import('./solve.restart-shared.lib.mjs');

    // Re-execute tool with hint as feedback lines
    const restartResult = await executeToolIteration({
      issueUrl,
      owner,
      repo,
      issueNumber,
      prNumber,
      branchName,
      tempDir,
      mergeStateStatus,
      feedbackLines: hintLines,
      argv: {
        ...argv,
        // Disable auto-restart for this iteration to prevent infinite loops
        autoRestartOnNonUpdatedPullRequestDescription: false,
      },
    });

    // Update session data from restart
    if (restartResult) {
      if (restartResult.sessionId) sessionId = restartResult.sessionId;
      if (restartResult.anthropicTotalCostUSD) anthropicTotalCostUSD = restartResult.anthropicTotalCostUSD;
      if (restartResult.publicPricingEstimate) publicPricingEstimate = restartResult.publicPricingEstimate;
      if (restartResult.pricingInfo) pricingInfo = restartResult.pricingInfo;
    }

    // Clean up CLAUDE.md/.gitkeep again after restart
    await cleanupClaudeFile(tempDir, branchName, null, argv);

    // Re-verify results after restart (without auto-restart flag to prevent recursion)
    const reVerifyResult = await verifyResults(owner, repo, branchName, issueNumber, prNumber, prUrl, referenceTime, { ...argv, autoRestartOnNonUpdatedPullRequestDescription: false }, shouldAttachLogs, false, sessionId, tempDir, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo, errorDuringExecution, sessionType);

    if (reVerifyResult?.prTitleHasPlaceholder || reVerifyResult?.prBodyHasPlaceholder) {
      await log('⚠️  PR title/description still not updated after restart');
    }
  }

  // Start watch mode if enabled OR if we need to handle uncommitted changes
  if (argv.verbose) {
    await log('');
    await log('🔍 Auto-restart debug:', { verbose: true });
    await log(`   argv.watch (user flag): ${argv.watch}`, { verbose: true });
    await log(`   shouldRestart (auto-detected): ${shouldRestart}`, { verbose: true });
    await log(`   temporaryWatch (will be enabled): ${shouldRestart && !argv.watch}`, { verbose: true });
    await log(`   prNumber: ${prNumber || 'null'}`, { verbose: true });
    await log(`   prBranch: ${prBranch || 'null'}`, { verbose: true });
    await log(`   branchName: ${branchName}`, { verbose: true });
    await log(`   isContinueMode: ${isContinueMode}`, { verbose: true });
  }

  // If uncommitted changes detected and auto-commit is disabled, enter temporary watch mode
  const temporaryWatchMode = shouldRestart && !argv.watch;
  if (temporaryWatchMode) {
    await log('');
    await log('🔄 AUTO-RESTART: Uncommitted changes detected');
    await log('   Starting temporary monitoring cycle (NOT --watch mode)');
    await log('   The tool will run once more to commit the changes');
    await log('   Will exit automatically after changes are committed');
    await log('');
  }

  const watchResult = await startWatchMode({
    issueUrl,
    owner,
    repo,
    issueNumber,
    prNumber,
    prBranch,
    branchName,
    tempDir,
    argv: {
      ...argv,
      watch: argv.watch || shouldRestart, // Enable watch if uncommitted changes
      temporaryWatch: temporaryWatchMode, // Flag to indicate temporary watch mode
    },
  });

  // Update session data with latest from watch mode for accurate pricing
  if (watchResult && watchResult.latestSessionId) {
    sessionId = watchResult.latestSessionId;
    anthropicTotalCostUSD = watchResult.latestAnthropicCost;
    if (argv.verbose) {
      await log('');
      await log('📊 Updated session data from watch mode:', { verbose: true });
      await log(`   Session ID: ${sessionId}`, { verbose: true });
      if (anthropicTotalCostUSD !== null && anthropicTotalCostUSD !== undefined) {
        await log(`   Anthropic cost: $${anthropicTotalCostUSD.toFixed(6)}`, { verbose: true });
      }
    }
  }

  // Track whether logs were successfully attached (used by endWorkSession)
  let logsAttached = false;

  // After watch mode completes (either user watch or temporary)
  // Push any committed changes if this was a temporary watch mode
  if (temporaryWatchMode) {
    await log('');
    await log('📤 Pushing committed changes to GitHub...');
    await log('');

    try {
      const pushResult = await $({ cwd: tempDir })`git push origin ${branchName}`;
      if (pushResult.code === 0) {
        await log('✅ Changes pushed successfully to remote branch');
        await log(`   Branch: ${branchName}`);
        await log('');
      } else {
        const errorMsg = pushResult.stderr?.toString() || 'Unknown error';
        await log('⚠️  Push failed:', { level: 'error' });
        await log(`   ${errorMsg.trim()}`, { level: 'error' });
        await log('   Please push manually:', { level: 'error' });
        await log(`   cd ${tempDir} && git push origin ${branchName}`, { level: 'error' });
      }
    } catch (error) {
      await log('⚠️  Push failed:', { level: 'error' });
      await log(`   ${cleanErrorMessage(error)}`, { level: 'error' });
      await log('   Please push manually:', { level: 'error' });
      await log(`   cd ${tempDir} && git push origin ${branchName}`, { level: 'error' });
    }

    // Attach updated logs to PR after auto-restart completes
    // Issue #1154: Skip if logs were already uploaded by verifyResults() to prevent duplicates
    // Issue #1290: Always upload if auto-restart ran but last iteration's logs weren't uploaded
    //   This ensures final logs are uploaded even when the last iteration failed
    const autoRestartRanButNotUploaded = watchResult?.autoRestartIterationsRan && !watchResult?.lastIterationLogUploaded;
    if (shouldAttachLogs && prNumber && (!logsAlreadyUploaded || autoRestartRanButNotUploaded)) {
      await log('📎 Uploading working session logs to Pull Request...');
      try {
        const logUploadSuccess = await attachLogToGitHub({
          logFile: getLogFile(),
          targetType: 'pr',
          targetNumber: prNumber,
          owner,
          repo,
          $,
          log,
          sanitizeLogContent,
          verbose: argv.verbose,
          sessionId,
          tempDir,
          anthropicTotalCostUSD,
        });

        if (logUploadSuccess) {
          await log('✅ Working session logs uploaded successfully');
          logsAttached = true;
        } else {
          await log('⚠️  Failed to upload working session logs', { level: 'warning' });
        }
      } catch (uploadError) {
        await log(`⚠️  Error uploading logs: ${uploadError.message}`, { level: 'warning' });
      }
    } else if (logsAlreadyUploaded && !autoRestartRanButNotUploaded) {
      await log('ℹ️  Logs already uploaded by verifyResults, skipping duplicate upload');
      logsAttached = true;
    }
  }

  // Start auto-restart-until-mergeable mode if enabled
  // This runs after the normal watch mode completes (if any)
  // --auto-merge implies --auto-restart-until-mergeable
  if (argv.autoMerge || argv.autoRestartUntilMergeable) {
    const autoMergeResult = await startAutoRestartUntilMergeable({
      issueUrl,
      owner,
      repo,
      issueNumber,
      prNumber,
      prBranch,
      branchName,
      tempDir,
      argv,
    });

    // Update session data with latest from auto-merge mode for accurate pricing
    if (autoMergeResult && autoMergeResult.latestSessionId) {
      sessionId = autoMergeResult.latestSessionId;
      anthropicTotalCostUSD = autoMergeResult.latestAnthropicCost;
      if (argv.verbose) {
        await log('');
        await log('📊 Updated session data from auto-restart-until-mergeable mode:', { verbose: true });
        await log(`   Session ID: ${sessionId}`, { verbose: true });
        if (anthropicTotalCostUSD !== null && anthropicTotalCostUSD !== undefined) {
          await log(`   Anthropic cost: $${anthropicTotalCostUSD.toFixed(6)}`, { verbose: true });
        }
      }
    }

    // If auto-merge succeeded, update logs attached status
    if (autoMergeResult && autoMergeResult.success) {
      logsAttached = true;
    }
  }

  // End work session using the new module
  await endWorkSession({
    isContinueMode,
    prNumber,
    argv,
    log,
    formatAligned,
    $,
    logsAttached,
  });
} catch (error) {
  // Don't report authentication errors to Sentry as they are user configuration issues
  if (!error.isAuthError) {
    reportError(error, {
      context: 'solve_main',
      operation: 'main_execution',
    });
  }
  await handleMainExecutionError({
    error,
    log,
    cleanErrorMessage,
    absoluteLogPath,
    shouldAttachLogs,
    argv,
    global,
    owner,
    repo,
    getLogFile,
    attachLogToGitHub,
    sanitizeLogContent,
    $,
  });
} finally {
  await cleanupTempDirectory(tempDir, argv, limitReached);

  // Show final log file reference so users always know where to find the complete log
  if (getLogFile()) {
    const finalLogPath = path.resolve(getLogFile());
    await log(`\n📁 Complete log file: ${finalLogPath}`);
  }

  // Issue #1346: Flush Sentry events before exit.
  // closeSentry() uses a hard Promise.race deadline so it cannot block indefinitely.
  await closeSentry();
}
