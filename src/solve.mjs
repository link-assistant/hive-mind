#!/usr/bin/env node
// Import Sentry instrumentation first (must be before other imports)
import './instrument.mjs';
import { ensureUseM } from './use-m-bootstrap.lib.mjs';
const earlyArgs = process.argv.slice(2);
const { handleSolveEarlyExit } = await import('./solve.bootstrap.lib.mjs');
await handleSolveEarlyExit(earlyArgs);

const use = (globalThis.use = await ensureUseM());
const { $: __rawDollar$ } = await use('command-stream');
const { configureGitHubRateLimitLogging, wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry(__rawDollar$);
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
const { log, setLogFile, getLogFile, getAbsoluteLogPath, cleanErrorMessage, formatAligned, formatToolExecutionFailure, getVersionInfo, setupVerboseLogInterceptor, setupStdioLogInterceptor } = lib;
const githubLib = await import('./github.lib.mjs');
const { sanitizeLogContent, attachLogToGitHub, getToolDisplayName } = githubLib;
const validation = await import('./solve.validation.lib.mjs');
const { validateGitHubUrl, showAttachLogsWarning, initializeLogFile, validateUrlRequirement, validateContinueOnlyOnFeedback, performSystemChecks } = validation;
const autoContinue = await import('./solve.auto-continue.lib.mjs');
const { processAutoContinueForIssue } = autoContinue;
const repository = await import('./solve.repository.lib.mjs');
const { setupTempDirectory, cleanupTempDirectory } = repository;
const results = await import('./solve.results.lib.mjs');
const { cleanupClaudeFile, showSessionSummary, verifyResults, buildClaudeResumeCommand, buildClaudeAutonomousResumeCommand, buildSolveResumeCommand, maybeAttachWorkingSessionSummary, verifyPullRequestIssueLinkAfterAutoRestart } = results;
const claudeLib = await import('./claude.lib.mjs');
const { executeClaude } = claudeLib;
const githubLinking = await import('./github-linking.lib.mjs');
const { extractLinkedIssueNumber } = githubLinking;
const usageLimitLib = await import('./usage-limit.lib.mjs');
const { formatResetTimeWithRelative } = usageLimitLib;
const errorHandlers = await import('./solve.error-handlers.lib.mjs');
const { createUncaughtExceptionHandler, createUnhandledRejectionHandler, handleMainExecutionError, handleNoPrAvailableError } = errorHandlers;
const { notifyIssueAboutPrePullRequestFailure } = await import('./solve.pre-pr-failure-notifier.lib.mjs');
const watchLib = await import('./solve.watch.lib.mjs');
const { startWatchMode } = watchLib;
const { startAutoRestartUntilMergeable } = await import('./solve.auto-merge.lib.mjs');
const { runAutoEnsureRequirements } = await import('./solve.auto-ensure.lib.mjs');
const { runKeepWorkingUntilDone } = await import('./solve.keep-working.lib.mjs');
const { runEscalation } = await import('./solve.escalate.lib.mjs');
const exitHandler = await import('./exit-handler.lib.mjs');
const { initializeExitHandler, installGlobalExitHandlers, safeExit, logActiveHandles } = exitHandler;
const { createInterruptWrapper } = await import('./solve.interrupt.lib.mjs');
// Issue #1823: working-session guard for --do-not-shutdown-in-the-middle-of-working-session.
const { configureWorkingSession, beginWorkingSession, endWorkingSession } = await import('./working-session.lib.mjs');
const getResourceSnapshot = memoryCheck.getResourceSnapshot;
const { handleAutoPrCreation } = await import('./solve.auto-pr.lib.mjs');
const { setupRepositoryAndClone, verifyDefaultBranchAndStatus } = await import('./solve.repo-setup.lib.mjs');
const { createOrCheckoutBranch } = await import('./solve.branch.lib.mjs');
const { startWorkSession, endWorkSession, SESSION_TYPES } = await import('./solve.session.lib.mjs');
// Issue #1625: centralized markers + tracked comment posting for solve.mjs's
// own usage-limit notifications (so they're excluded from the
// "did the AI post anything?" check in --auto-attach-solution-summary).
const { postTrackedComment, USAGE_LIMIT_REACHED_MARKER } = await import('./tool-comments.lib.mjs');
const { prepareFeedbackAndTimestamps, checkUncommittedChanges, checkForkActions } = await import('./solve.preparation.lib.mjs');
const { validateAndExitOnInvalidModel } = await import('./models/index.mjs');
const { autoAcceptInviteForRepo } = await import('./solve.accept-invite.lib.mjs');
const { handleAutoForkOption, handleMaintainerForkAccess } = await import('./solve.fork-detection.lib.mjs');
// Initialize log file early (before argument parsing) to capture all output
const logFile = await initializeLogFile(null);
// Log version and raw command IMMEDIATELY after log file initialization
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

setupVerboseLogInterceptor(); // Issue #1466: capture [VERBOSE] output in log files
setupStdioLogInterceptor(); // Issue #1549: capture ALL terminal output in log file
configureGitHubRateLimitLogging({
  enabled: argv.githubRateLimitsLogging === true,
  log,
});

// Early logs go to cwd; custom log dir takes effect after argv is parsed
// Conditionally import tool-specific functions after argv is parsed
// If --use-agent-commander is enabled, use agent-commander's checkForUncommittedChanges
let checkForUncommittedChanges;
let agentCommanderLib = null;
if (argv.useAgentCommander) {
  agentCommanderLib = await import('./agent-commander.lib.mjs');
  checkForUncommittedChanges = agentCommanderLib.checkForUncommittedChanges;
} else if (argv.tool === 'opencode') {
  const opencodeLib = await import('./opencode.lib.mjs');
  checkForUncommittedChanges = opencodeLib.checkForUncommittedChanges;
} else if (argv.tool === 'gemini') {
  const geminiLib = await import('./gemini.lib.mjs');
  checkForUncommittedChanges = geminiLib.checkForUncommittedChanges;
} else if (argv.tool === 'codex') {
  const codexLib = await import('./codex.lib.mjs');
  checkForUncommittedChanges = codexLib.checkForUncommittedChanges;
} else if (argv.tool === 'agent') {
  const agentLib = await import('./agent.lib.mjs');
  checkForUncommittedChanges = agentLib.checkForUncommittedChanges;
} else if (argv.tool === 'qwen') {
  const qwenLib = await import('./qwen.lib.mjs');
  checkForUncommittedChanges = qwenLib.checkForUncommittedChanges;
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
initializeExitHandler(getAbsoluteLogPath, log, cleanupWrapper, interruptWrapper, ({ code, reason }) => notifyIssueAboutPrePullRequestFailure({ code, reason, argv, globalState: global, $, log, getLogFile, shouldAttachLogs, attachLogToGitHub, sanitizeLogContent, rawCommand }));
installGlobalExitHandlers();
// Issue #1823: Configure the working-session guard. When the experimental
// --do-not-shutdown-in-the-middle-of-working-session flag is set (hive passes it to every
// worker), an interrupt received during an AI working session is deferred: solve lets the AI
// finish, auto-commits, then shuts down gracefully instead of aborting the AI tool mid-run.
configureWorkingSession({ enabled: argv['do-not-shutdown-in-the-middle-of-working-session'] === true, log });
const markFailureNotificationPosted = targetType => {
  global.preExitFailureNotificationPosted = true;
  if (targetType === 'pr') {
    global.pullRequestFailureNotificationPosted = true;
  } else if (targetType === 'issue') {
    global.prePullRequestFailureNotificationPosted = true;
  }
};

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
global.owner = owner;
global.repo = repo;
// Issue #1752: record the source issue as soon as the URL is validated so the pre-exit
// notifier can still comment on it if a check fails before normal issue-mode setup below.
if (isIssueUrl) {
  global.issueNumber = urlNumber;
}
cleanupContext.owner = owner;
cleanupContext.repo = repo;
if (argv.autoLanguage) {
  const { applyAutoLanguageToArgv } = await import('./auto-language.lib.mjs');
  await applyAutoLanguageToArgv({ argv, githubLib, owner, repo, number: urlNumber, isIssueUrl, isPrUrl, log });
}
// Initialize i18n from --language / --ui-language / --work-language (or system locale).
const { initI18n } = await import('./i18n.lib.mjs');
await initI18n({
  language: argv.language,
  uiLanguage: argv.uiLanguage,
  workLanguage: argv.workLanguage,
});
// Setup unhandled error handlers to ensure log path is always shown
const errorHandlerOptions = {
  log,
  cleanErrorMessage,
  absoluteLogPath,
  shouldAttachLogs,
  argv,
  global,
  cleanupContext, // #1845: mutated in place; lets exception handlers auto-commit uncommitted work
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

// Validate model name EARLY - always runs regardless of --skip-tool-connection-check
const tool = argv.tool || 'claude';
await validateAndExitOnInvalidModel(argv.model, tool, safeExit);
if (argv.fallbackModel) await validateAndExitOnInvalidModel(argv.fallbackModel, tool, safeExit);
argv.originalModel ||= argv.model;

// Validate --plan-model if provided (Issue #1223)
if (argv.planModel) {
  if (tool !== 'claude') {
    await log(`❌ --plan-model is only supported with --tool claude (current tool: ${tool})`, { level: 'error' });
    await safeExit(1, '--plan-model requires --tool claude');
  }
  await validateAndExitOnInvalidModel(argv.planModel, tool, safeExit);
}

// Perform all system checks (skip tool connection check in dry-run or when --skip-tool-connection-check; model validation always runs)
const skipToolConnectionCheck = argv.dryRun || argv.skipToolConnectionCheck || argv.toolConnectionCheck === false;
const { cascadePlaywrightMcpDisable, ensureSolvePlaywrightMcpReady } = await import('./playwright-mcp.lib.mjs');
await cascadePlaywrightMcpDisable(argv, log);
if (!(await performSystemChecks(argv.minDiskSpace || 2048, skipToolConnectionCheck, argv.model, argv))) {
  await safeExit(1, 'System checks failed');
}
if (!skipToolConnectionCheck) {
  const playwrightMcpPreflight = await ensureSolvePlaywrightMcpReady({ argv, log });
  if (!playwrightMcpPreflight.ok) {
    await safeExit(1, 'Playwright MCP preflight failed');
  }
} else if (argv.playwrightMcp !== false) {
  await log('⏩ Skipping Playwright MCP preflight (dry-run mode or skip-tool-connection-check enabled)', { verbose: true });
}
// URL validation debug logging
if (argv.verbose) {
  await log('📋 URL validation:', { verbose: true });
  await log(`   Input URL: ${issueUrl}`, { verbose: true });
  await log(`   Is Issue URL: ${!!isIssueUrl}`, { verbose: true });
  await log(`   Is PR URL: ${!!isPrUrl}`, { verbose: true });
}
const claudePath = argv.executeToolWithBun ? 'bunx claude' : process.env.CLAUDE_PATH || 'claude';
// Note: owner, repo, and urlNumber are extracted from validateGitHubUrl() above
// Accept pending invitation BEFORE any access checks (auto-fork, permissions, entity validation)
if (argv.autoAcceptInvite) {
  await autoAcceptInviteForRepo(owner, repo, log, argv.verbose);
}
// Handle --auto-fork option: automatically fork public repositories without write access
await handleAutoForkOption({ owner, repo, argv, safeExit });
// Permission check BEFORE entity validation (#1552): avoids false 404 on private repos without access
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

// Issue #1552: Validate entity existence AFTER permissions (cascade: user/org → repo → issue/PR)
const entityCheck = await (await import('./github-entity-validation.lib.mjs')).validateGitHubEntityExistence({ owner, repo, number: urlNumber, type: isIssueUrl ? 'issue' : isPrUrl ? 'pull' : undefined, verbose: argv.verbose, autoAcceptInvite: !!argv.autoAcceptInvite });
if (!entityCheck.valid) {
  await log(`\n❌ ${entityCheck.error}\n`, { level: 'error' });
  await safeExit(1, `GitHub entity not found (${entityCheck.level})`);
}

// Detect repository visibility once and reuse for downstream decisions
// (auto-cleanup default + Issue #1716 private-repo fork bypass)
const { detectRepositoryVisibility } = githubLib;
const { isPublic: isRepoPublic } = await detectRepositoryVisibility(owner, repo);
if (argv.autoCleanup === undefined) {
  // For public repos: keep temp directories (default false)
  // For private repos: clean up temp directories (default true)
  argv.autoCleanup = !isRepoPublic;
  if (argv.verbose) {
    await log(`   Auto-cleanup default: ${argv.autoCleanup} (repository is ${isRepoPublic ? 'public' : 'private'})`, {
      verbose: true,
    });
  }
}
// Issue #1716: When the upstream repository is private and the user has direct
// write access, fork-based workflows should be skipped — even if the existing
// PR was originally created from a fork. Forks of private repositories often
// become inaccessible (renamed, deleted, parent re-private'd) and there's no
// reason to use them when we can push branches and PRs to the upstream repo.
const skipForkForPrivateUpstream = !isRepoPublic && !argv.fork && hasWriteAccess;
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
          const detectedForkOwner = prCheckData.headRepositoryOwner.login;
          const detectedForkRepoName = prCheckData.headRepository && prCheckData.headRepository.name ? prCheckData.headRepository.name : null;
          // Issue #1716: Skip fork mode for private upstream repos with write access.
          if (skipForkForPrivateUpstream) {
            await log(`🔒 Detected fork PR from ${detectedForkOwner}/${detectedForkRepoName || repo}, but upstream ${owner}/${repo} is private and you have write access.`);
            await log('   Working directly on the private upstream repository (Issue #1716).');
          } else {
            forkOwner = detectedForkOwner;
            // Get actual fork repository name (may be prefixed) and store for use in setupRepository
            forkRepoName = detectedForkRepoName;
            await log(`🍴 Detected fork PR from ${forkOwner}/${forkRepoName || repo}`);
            if (argv.verbose) {
              await log(`   Fork owner: ${forkOwner}`, { verbose: true });
              await log('   Will clone fork repository for continue mode', { verbose: true });
            }
          }

          // Check if maintainer can push to the fork when --allow-to-push-to-contributors-pull-requests-as-maintainer is enabled
          if (forkOwner && argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork) {
            await handleMaintainerForkAccess({ owner, repo, prNumber });
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
    await log('   This branch was created by an earlier run; this run is reusing it rather than creating a fresh branch.');
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
      const detectedForkOwner = prData.headRepositoryOwner.login;
      const detectedForkRepoName = prData.headRepository && prData.headRepository.name ? prData.headRepository.name : null;
      // Issue #1716: Skip fork mode for private upstream repos with write access.
      if (skipForkForPrivateUpstream) {
        await log(`🔒 Detected fork PR from ${detectedForkOwner}/${detectedForkRepoName || repo}, but upstream ${owner}/${repo} is private and you have write access.`);
        await log('   Working directly on the private upstream repository (Issue #1716).');
      } else {
        forkOwner = detectedForkOwner;
        // Get actual fork repository name and store for use in setupRepository
        forkRepoName = detectedForkRepoName;
        await log(`🍴 Detected fork PR from ${forkOwner}/${forkRepoName || repo}`);
        if (argv.verbose) {
          await log(`   Fork owner: ${forkOwner}`, { verbose: true });
          await log('   Will clone fork repository for continue mode', { verbose: true });
        }
      }

      // Check if maintainer can push to the fork when --allow-to-push-to-contributors-pull-requests-as-maintainer is enabled
      if (forkOwner && argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork) {
        await handleMaintainerForkAccess({ owner, repo, prNumber });
      }
    }
    await log(`📝 PR branch: ${prBranch}`);
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
// Issues #1212, #1462: Store issueNumber globally for error handlers (attach failure logs to issue when no PR exists)
global.issueNumber = issueNumber;
const workspaceInfo = argv.enableWorkspaces ? { owner, repo, issueNumber } : null;
const { tempDir, workspaceTmpDir, needsClone } = await setupTempDirectory(argv, workspaceInfo);
cleanupContext.tempDir = tempDir;
cleanupContext.argv = argv;
cleanupContext.owner = owner;
cleanupContext.repo = repo;
if (prNumber) cleanupContext.prNumber = prNumber;
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
  // Pass argv, owner, repo, issueUrl for empty repository auto-initialization (--auto-init-repository)
  const defaultBranch = await verifyDefaultBranchAndStatus({
    tempDir,
    log,
    formatAligned,
    $,
    argv,
    owner,
    repo,
    issueUrl,
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
        const pushResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
        if (pushResult.code === 0) {
          await log(`${formatAligned('✅', 'Push successful:', 'Branch updated with latest changes')}`);
        } else {
          await log(`${formatAligned('⚠️', 'Push failed:', 'Merge completed but push failed')}`, { level: 'warning' });
          await log(`  Error: ${pushResult.stderr?.toString() || pushResult.stdout?.toString() || 'Unknown error'}`, { level: 'warning' });
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
    await handleNoPrAvailableError({ isContinueMode, tempDir, issueNumber, issueUrl, owner, repo, log, formatAligned });
  }

  if (isContinueMode) {
    await log(`\n${formatAligned('🔄', 'Continue mode:', 'ACTIVE')}`);
    await log(formatAligned('', 'Using existing PR:', `#${prNumber}`, 2));
    await log(formatAligned('', 'PR URL:', prUrl, 2));
  } else if (!argv.autoPullRequestCreation) {
    await log(`\n${formatAligned('⏭️', 'Auto PR creation:', 'DISABLED')}`);
    await log(formatAligned('', 'Workflow:', 'AI will create the PR', 2));
  }

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
  const workStartTime = await startWorkSession({
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
    tempDir,
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

  // Issue #1823: Mark the start of the AI working session. While this is active and the
  // --do-not-shutdown-in-the-middle-of-working-session flag is set, an interrupt (CTRL+C/SIGTERM)
  // is deferred until the AI tool finishes its turn (see exit-handler.lib.mjs + working-session.lib.mjs).
  beginWorkingSession();

  // If --use-agent-commander is enabled, use agent-commander for all tools
  if (argv.useAgentCommander) {
    // Ensure agent-commander is available
    if (!agentCommanderLib) {
      agentCommanderLib = await import('./agent-commander.lib.mjs');
    }

    const isAvailable = await agentCommanderLib.isAgentCommanderAvailable();
    if (!isAvailable) {
      await log('\n[agent-commander] agent-commander is not installed.', { level: 'error' });
      await log('   Install it with: npm install agent-commander', { level: 'error' });
      await log('   Or remove the --use-agent-commander flag to use embedded tool logic.', { level: 'error' });
      await safeExit(1, 'agent-commander not available');
    }

    await log(`\n[agent-commander] Using agent-commander for ${argv.tool || 'claude'} execution`);

    toolResult = await agentCommanderLib.executeWithAgentCommander({
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
      $,
    });
  } else if (['opencode', 'codex', 'agent', 'gemini', 'qwen'].includes(argv.tool)) {
    const toolDispatch = {
      opencode: { lib: './opencode.lib.mjs', execFn: 'executeOpenCode', envVar: 'OPENCODE_PATH', defaultBin: 'opencode', pathKey: 'opencodePath' },
      codex: { lib: './codex.lib.mjs', execFn: 'executeCodex', envVar: 'CODEX_PATH', defaultBin: 'codex', pathKey: 'codexPath' },
      agent: { lib: './agent.lib.mjs', execFn: 'executeAgent', envVar: 'AGENT_PATH', defaultBin: 'agent', pathKey: 'agentPath' },
      gemini: { lib: './gemini.lib.mjs', execFn: 'executeGemini', envVar: 'GEMINI_PATH', defaultBin: 'gemini', pathKey: 'geminiPath' },
      qwen: { lib: './qwen.lib.mjs', execFn: 'executeQwen', envVar: 'QWEN_PATH', defaultBin: 'qwen', pathKey: 'qwenPath' },
    }[argv.tool];
    const toolLib = await import(toolDispatch.lib);

    toolResult = await toolLib[toolDispatch.execFn]({
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
      [toolDispatch.pathKey]: process.env[toolDispatch.envVar] || toolDispatch.defaultBin,
      $,
    });
  } else {
    // Default to Claude
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

  // Issue #1823: Mark the end of the AI working session. If a graceful-shutdown interrupt arrived
  // during the session (deferred by the working-session guard), honor it now: auto-commit any
  // uncommitted changes and exit gracefully — only AFTER the AI tool has fully finished its turn.
  const workingSessionState = endWorkingSession();
  if (workingSessionState.shutdownRequested) {
    const shutdownExitCode = workingSessionState.shutdownSignal === 'SIGINT' ? 130 : 143;
    await log('\n🛑 Graceful shutdown requested during the AI working session — the session has finished.', { level: 'warning' });
    await log('   Auto-committing any uncommitted changes, then shutting down...', { level: 'warning' });
    try {
      await interruptWrapper();
    } catch (interruptError) {
      await log(`⚠️  Auto-commit on graceful shutdown failed: ${cleanErrorMessage(interruptError)}`, { level: 'warning' });
    }
    // Graceful shutdown is NOT a failure: skip the pre-exit failure notifier so no spurious
    // "solver failed" comment is posted (issue #1823: no errors on graceful shutdown).
    await safeExit(shutdownExitCode, 'Graceful shutdown after AI working session', { skipPreExit: true });
  }

  const { success } = toolResult;
  let sessionId = toolResult.sessionId;
  let anthropicTotalCostUSD = toolResult.anthropicTotalCostUSD;
  let publicPricingEstimate = toolResult.publicPricingEstimate; // Used by agent tool
  let pricingInfo = toolResult.pricingInfo; // Used by agent tool for detailed pricing
  let errorDuringExecution = toolResult.errorDuringExecution || false;
  let resultSummary = toolResult.resultSummary || null;
  let resultModelUsage = toolResult.resultModelUsage || null;
  let streamTokenUsage = toolResult.streamTokenUsage || null;
  let subAgentCalls = toolResult.subAgentCalls || null; // Issue #1590

  const applyRestartResult = result => {
    if (!result) return;
    sessionId = result.sessionId || sessionId;
    anthropicTotalCostUSD = result.anthropicTotalCostUSD || anthropicTotalCostUSD;
    publicPricingEstimate = result.publicPricingEstimate || publicPricingEstimate;
    pricingInfo = result.pricingInfo || pricingInfo;
  };
  limitReached = toolResult.limitReached;
  cleanupContext.limitReached = limitReached;

  if (sessionId && (argv.resumeOnAutoRestart || argv['resume-on-auto-restart'])) {
    global.previousSessionId = sessionId;
    if (argv.verbose) {
      await log(`Session ID stored for auto-restart resume: ${sessionId}`, { verbose: true });
    }
  }

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
        // Show dual resume commands (interactive + autonomous) only for --tool claude
        if ((argv.tool || 'claude') === 'claude') {
          await log('💡 To continue this session:');
          await log(`   Interactive mode: ${buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model })}`);
          await log(`   Autonomous mode:  ${buildClaudeAutonomousResumeCommand({ tempDir, sessionId, model: argv.model })}`);
          await log('');
        } else if (argv.url) {
          const toolForResume = argv.tool || 'claude';
          const solveResumeCmd = buildSolveResumeCommand({ issueUrl: argv.url, sessionId, tool: toolForResume, model: argv.model, fallbackModel: argv.fallbackModel, tempDir });
          await log(`💡 To continue this ${toolForResume} session with solve:`);
          await log('');
          await log(`   ${solveResumeCmd}`);
          await log('');
        }
      }

      // If --attach-logs is enabled and we have a PR, attach logs with usage limit details
      if (shouldAttachLogs && sessionId && prNumber) {
        await log('\n📄 Attaching logs to Pull Request...');
        try {
          // Build Claude CLI resume command
          const tool = argv.tool || 'claude';
          const resumeCommand = tool === 'claude' ? buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model }) : sessionId ? buildSolveResumeCommand({ issueUrl: argv.url, sessionId, tool, model: argv.model, fallbackModel: argv.fallbackModel, tempDir }) : null;
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
            toolName: getToolDisplayName(argv.tool),
            resumeCommand,
            sessionId,
            requestedModel: argv.originalModel || argv.model,
            tool: argv.tool || 'claude',
            // Issue #1454: Pass resultModelUsage for accurate multi-model display
            resultModelUsage,
          });

          if (logUploadSuccess) {
            markFailureNotificationPosted('pr');
            await log('  ✅ Logs uploaded successfully');
          } else {
            // Issue #1212: Always show log upload failures (not just verbose)
            await log('  ⚠️  Failed to upload logs');
          }
        } catch (uploadError) {
          // Issue #1212: Always show log upload errors (not just verbose)
          await log(`  ⚠️  Error uploading logs: ${uploadError.message}`);
        }
      } else if (prNumber) {
        // Fallback: Post simple failure comment (no CLI commands in GitHub comments, only mention option)
        try {
          const resetTime = global.limitResetTime;
          // Issue #942: do not embed CLI commands in GitHub comments. Users
          // interact via the Telegram bot, not the CLI. The full resume
          // commands (interactive/autonomous/solve) live in the attached logs.
          const resumeSection = sessionId ? `Session ID: \`${sessionId}\`\n\nUse the \`--auto-resume-on-limit-reset\` or \`--auto-restart-on-limit-reset\` option to automatically resume when the limit resets.` : 'Use the `--auto-resume-on-limit-reset` or `--auto-restart-on-limit-reset` option to automatically resume when the limit resets.';
          // Format the reset time with relative time and UTC conversion if available
          const timezone = global.limitTimezone || null;
          const formattedResetTime = resetTime ? formatResetTimeWithRelative(resetTime, timezone) : null;
          const failureComment = formattedResetTime ? `❌ **${USAGE_LIMIT_REACHED_MARKER}**\n\nThe AI tool has reached its usage limit. The limit will reset at: **${formattedResetTime}**\n\n${resumeSection}` : `❌ **${USAGE_LIMIT_REACHED_MARKER}**\n\nThe AI tool has reached its usage limit. Please wait for the limit to reset.\n\n${resumeSection}`;

          const posted = await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: failureComment });
          if (posted.ok) {
            markFailureNotificationPosted('pr');
            await log(`   Posted failure comment to PR${posted.commentId ? ` (id=${posted.commentId})` : ''}`);
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
            const resumeCommand = tool === 'claude' ? buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model }) : sessionId ? buildSolveResumeCommand({ issueUrl: argv.url, sessionId, tool, model: argv.model, fallbackModel: argv.fallbackModel, tempDir }) : null;
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
              toolName: getToolDisplayName(argv.tool),
              resumeCommand,
              sessionId,
              // Tell attachLogToGitHub that auto-resume is enabled to suppress CLI commands in the comment
              // See: https://github.com/link-assistant/hive-mind/issues/1152
              isAutoResumeEnabled: true,
              autoResumeMode: limitContinueMode,
              requestedModel: argv.originalModel || argv.model,
              tool: argv.tool || 'claude',
              // Issue #1454: Pass resultModelUsage for accurate multi-model display
              resultModelUsage,
            });

            if (logUploadSuccess) {
              await log('  ✅ Logs uploaded successfully');
            } else {
              // Issue #1212: Always show log upload failures (not just verbose)
              await log('  ⚠️  Failed to upload logs');
            }
          } catch (uploadError) {
            // Issue #1212: Always show log upload errors (not just verbose)
            await log(`  ⚠️  Error uploading logs: ${uploadError.message}`);
          }
        } else {
          // Fallback: Post simple waiting comment if logs are not attached
          try {
            // Calculate wait time in d:h:m:s format
            const validation = await import('./solve.validation.lib.mjs');
            const { calculateWaitTime } = validation;
            const waitMs = calculateWaitTime(global.limitResetTime, global.limitTimezone || null);

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
            const waitingComment = `⏳ **${USAGE_LIMIT_REACHED_MARKER} - Waiting to ${limitContinueMode === 'restart' ? 'Restart' : 'Continue'}**\n\nThe AI tool has reached its usage limit. ${continueModeName} is enabled.\n\n**Reset time:** ${waitingResetTimeFormatted}\n**Wait time:** ${formatWaitTime(waitMs)} (days:hours:minutes:seconds)\n\n${continueDescription}\n\nSession ID: \`${sessionId}\``;

            const posted = await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: waitingComment });
            if (posted.ok) {
              await log(`   Posted waiting comment to PR${posted.commentId ? ` (id=${posted.commentId})` : ''}`);
            }
          } catch (error) {
            await log(`   Warning: Could not post waiting comment: ${cleanErrorMessage(error)}`, { verbose: true });
          }
        }
      }
    }
  }

  // Skip failure exit if limit reached with auto-resume (continues to showSessionSummary/autoContinueWhenLimitResets)
  const shouldSkipFailureExitForAutoLimitContinue = limitReached && argv.autoResumeOnLimitReset;
  if (!success && !shouldSkipFailureExitForAutoLimitContinue) {
    // Issue #942: show all three resume options on failure for richer guidance.
    //   1. Interactive claude  - opens Claude Code interactively (claude only)
    //   2. Autonomous claude   - one-shot claude --resume w/ --dangerously-skip-permissions -p (claude only)
    //   3. Solve resume        - re-enters solve.mjs with --resume, preserving tool/model/dir
    const toolForFailure = argv.tool || 'claude';
    // Issue #1845: surface the core error instead of just "<TOOL> execution failed" (terminal + comment).
    const toolFailureMessage = formatToolExecutionFailure({ tool: toolForFailure, toolResult });
    if (sessionId) {
      await log('');
      await log('💡 To continue this session:');
      if (toolForFailure === 'claude') {
        await log(`   Interactive mode:    ${buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model })}`);
        await log(`   Autonomous mode:     ${buildClaudeAutonomousResumeCommand({ tempDir, sessionId, model: argv.model })}`);
      }
      if (argv.url) {
        const solveResumeCmd = buildSolveResumeCommand({ issueUrl: argv.url, sessionId, tool: toolForFailure, model: argv.model, fallbackModel: argv.fallbackModel, tempDir });
        await log(`   Solve resume mode:   ${solveResumeCmd}`);
      }
      await log('');
    }

    // Attach failure logs before exiting (Issues #1212, #1462: fall back to issue if no PR)
    const hasPR = global.createdPR && global.createdPR.number;
    const hasIssue = global.issueNumber;
    const logTargetType = hasPR ? 'pr' : hasIssue ? 'issue' : null;
    const logTargetNumber = hasPR ? global.createdPR.number : hasIssue ? global.issueNumber : null;
    const logTargetLabel = hasPR ? 'Pull Request' : `original issue #${logTargetNumber}`;

    if (shouldAttachLogs && logTargetType && logTargetNumber) {
      await log(`\n📄 Attaching failure logs to ${logTargetLabel}...`);
      try {
        // Build Claude CLI resume command
        const tool = argv.tool || 'claude';
        const resumeCommand = sessionId ? (tool === 'claude' ? buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model }) : buildSolveResumeCommand({ issueUrl: argv.url, sessionId, tool, model: argv.model, fallbackModel: argv.fallbackModel, tempDir })) : null;
        const logUploadSuccess = await attachLogToGitHub({
          logFile: getLogFile(),
          targetType: logTargetType,
          targetNumber: logTargetNumber,
          owner,
          repo,
          $,
          log,
          sanitizeLogContent,
          // For usage limit, use a dedicated comment format to make it clear and actionable
          isUsageLimit: !!limitReached,
          limitResetTime: limitReached ? toolResult.limitResetTime : null,
          toolName: getToolDisplayName(argv.tool),
          resumeCommand,
          // Include sessionId so the PR comment can present it
          sessionId,
          // If not a usage limit case, fall back to generic failure format
          errorMessage: limitReached ? undefined : toolFailureMessage,
          requestedModel: argv.originalModel || argv.model,
          tool: argv.tool || 'claude',
          // Issue #1454: Pass resultModelUsage for accurate multi-model display
          resultModelUsage,
        });

        if (logUploadSuccess) {
          markFailureNotificationPosted(logTargetType);
          await log(`  📎 Failure logs posted to ${logTargetLabel}`);
        } else {
          // Issue #1212: Always show log upload failures (not just verbose)
          await log('  ⚠️  Failed to upload failure logs');
        }
      } catch (uploadError) {
        // Issue #1212: Always show log upload errors (not just verbose)
        await log(`  ⚠️  Error uploading failure logs: ${uploadError.message}`);
      }
    }

    // Issue #1834 (PR #1835 feedback): "on all critical errors we auto commit uncommitted changes by
    // default." A failed session exits here before the normal auto-commit chokepoint below, so commit
    // + push any work first. On by default; disable via HIVE_MIND_AUTO_COMMIT_ON_CRITICAL_ERROR=false.
    try {
      const { criticalErrorRecovery } = await import('./config.lib.mjs');
      if (criticalErrorRecovery.autoCommitUncommittedChanges) {
        const { commitUncommittedChangesOnCriticalError } = await import('./critical-error-commit.lib.mjs');
        await commitUncommittedChangesOnCriticalError({ tempDir, branchName, $, log, reason: toolFailureMessage });
      }
    } catch (preserveError) {
      await log(`  ⚠️  Could not auto-commit before failure exit: ${preserveError.message}`, { verbose: true });
    }

    await safeExit(1, toolFailureMessage);
  }

  // Clean up .playwright-mcp/ to prevent browser artifacts from triggering auto-restart (Issue #1124)
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

  // When limit is reached, force auto-commit of any uncommitted changes to preserve work.
  // Issue #1834 (PR #1835 feedback): "on all critical errors we auto commit uncommitted changes by
  // default." A failed/errored session is a critical error, so auto-commit (and push) to preserve any
  // work the agent left on disk. On by default; disable via HIVE_MIND_AUTO_COMMIT_ON_CRITICAL_ERROR=false.
  const { criticalErrorRecovery } = await import('./config.lib.mjs');
  const criticalError = success === false || errorDuringExecution === true;
  const shouldAutoCommit = argv['auto-commit-uncommitted-changes'] || limitReached || (criticalError && criticalErrorRecovery.autoCommitUncommittedChanges);
  const autoRestartEnabled = argv['autoRestartOnUncommittedChanges'] !== false;
  const shouldRestart = await checkForUncommittedChanges(tempDir, owner, repo, branchName, $, log, shouldAutoCommit, autoRestartEnabled);

  // Issue #1516: cleanupClaudeFile() moved to after completion signals (before endWorkSession)

  // Show summary of session and log file
  await showSessionSummary(sessionId, limitReached, argv, issueUrl, tempDir, shouldAttachLogs);

  // Issue #1571: Defense-in-depth guard — skip post-processing if auto-continue is handling it
  // (prevents "Solution Draft Log" / "Ready to merge" comments before "Auto Resume")
  if (limitReached && (argv.autoResumeOnLimitReset || argv.autoRestartOnLimitReset) && global.limitResetTime) {
    await safeExit(0, 'Auto-continue child process will handle post-processing');
  }

  // Issue #1263 / #1728: Working session summary attachment.
  // Routed through the shared maybeAttachWorkingSessionSummary helper so that
  // top-level solve, auto-restart-until-mergeable, and watch-mode iterations
  // all use identical attach logic. The helper internally honours
  // --attach-solution-summary (always attach) and --auto-attach-solution-summary
  // (attach only if no AI comment was posted during the session).
  await maybeAttachWorkingSessionSummary({
    argv,
    resultSummary,
    workStartTime,
    owner,
    repo,
    prNumber,
    issueNumber,
    success,
  });

  // Search for newly created pull requests and comments
  const verifyResult = await verifyResults(owner, repo, branchName, issueNumber, prNumber, prUrl, referenceTime, argv, shouldAttachLogs, shouldRestart, sessionId, tempDir, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo, errorDuringExecution, sessionType, resultModelUsage, streamTokenUsage, subAgentCalls);
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
      workspaceTmpDir,
      mergeStateStatus,
      feedbackLines: hintLines,
      argv: {
        ...argv,
        // Disable auto-restart for this iteration to prevent infinite loops
        autoRestartOnNonUpdatedPullRequestDescription: false,
      },
    });

    // Update session data from restart
    applyRestartResult(restartResult);

    // Clean up CLAUDE.md/.gitkeep again after restart
    await cleanupClaudeFile(tempDir, branchName, null, argv);

    // Re-verify results after restart (without auto-restart flag to prevent recursion)
    const reVerifyResult = await verifyResults(owner, repo, branchName, issueNumber, prNumber, prUrl, referenceTime, { ...argv, autoRestartOnNonUpdatedPullRequestDescription: false }, shouldAttachLogs, false, sessionId, tempDir, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo, errorDuringExecution, sessionType, resultModelUsage, streamTokenUsage, subAgentCalls);

    if (reVerifyResult?.prTitleHasPlaceholder || reVerifyResult?.prBodyHasPlaceholder) {
      await log('⚠️  PR title/description still not updated after restart');
    }
  }
  // Post-solve restart loops (escalate #1885 first, then finalize #1383, then keep-working #1883):
  applyRestartResult(await runEscalation({ issueUrl, owner, repo, issueNumber, prNumber, branchName, tempDir, workspaceTmpDir, argv, cleanupClaudeFile, resultSummary }));
  applyRestartResult(await runAutoEnsureRequirements({ issueUrl, owner, repo, issueNumber, prNumber, branchName, tempDir, argv, cleanupClaudeFile }));
  applyRestartResult(await runKeepWorkingUntilDone({ issueUrl, owner, repo, issueNumber, prNumber, branchName, tempDir, workspaceTmpDir, argv, cleanupClaudeFile, resultSummary }));

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
    await log('   The tool will run once more to commit or discard the changes');
    await log('   Will exit automatically after changes are committed or discarded');
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
      const pushResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
      if (pushResult.code === 0) {
        await log('✅ Changes pushed successfully to remote branch');
        await log(`   Branch: ${branchName}`);
        await log('');
      } else {
        const errorMsg = pushResult.stderr?.toString() || pushResult.stdout?.toString() || 'Unknown error';
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

    await verifyPullRequestIssueLinkAfterAutoRestart({ prNumber, issueNumber, owner, repo, argv, cleanErrorMessage });

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
          requestedModel: argv.originalModel || argv.model,
          tool: argv.tool || 'claude',
          // Issue #1454: Pass resultModelUsage for accurate multi-model display
          resultModelUsage,
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

  // Issue #1516: Cleanup after all signals (was before verifyResults, caused premature commits)
  await cleanupClaudeFile(tempDir, branchName, claudeCommitHash, argv);

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
    cleanupContext, // #1845: enable auto-commit of uncommitted work before the failure exit
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

  // Issue #1431: Log active handles before draining.
  // Always logged to file and console so future hangs are immediately visible in logs.
  // drainHandles() inside safeExit() will unref/close these before process.exit().
  await logActiveHandles(msg => log(msg));

  // Issue #1431: safeExit() unrefs handles so the event loop exits naturally, then calls process.exit(0)
  await safeExit(0, 'Process completed');
}
