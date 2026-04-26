#!/usr/bin/env node

// Script to analyze and suggest fixes for unused variables

import fs from 'fs/promises';
import path from 'path';

const fixes = [
  // solve.mjs - remove unused imports
  {
    file: 'src/solve.mjs',
    fixes: [
      {
        line: 59,
        old: 'const { initializeConfig, parseArguments, createYargsConfig } = config;',
        new: 'const { initializeConfig, parseArguments } = config;',
        reason: 'createYargsConfig is already imported earlier',
      },
      {
        line: 63,
        old: 'const { initializeSentry, withSentry, addBreadcrumb, reportError, flushSentry, closeSentry } = sentryLib;',
        new: 'const { initializeSentry, addBreadcrumb, reportError } = sentryLib;',
        reason: 'withSentry, flushSentry, closeSentry are not used',
      },
      {
        line: 65,
        old: `const os = (await use('os')).default;`,
        new: `// const os = (await use('os')).default; // Not currently used`,
        reason: 'os is not used in solve.mjs',
      },
      {
        line: 73,
        old: 'const { sanitizeLogContent, checkFileInBranch, checkGitHubPermissions, attachLogToGitHub } = githubLib;',
        new: 'const { sanitizeLogContent, attachLogToGitHub } = githubLib;',
        reason: 'checkFileInBranch, checkGitHubPermissions are not used',
      },
      {
        line: 75,
        old: 'const { validateClaudeConnection } = claudeLib;',
        new: '// const { validateClaudeConnection } = claudeLib; // Not currently used',
        reason: 'validateClaudeConnection is not used',
      },
      {
        line: 77,
        old: 'const { validateGitHubUrl, showAttachLogsWarning, initializeLogFile, validateUrlRequirement, validateContinueOnlyOnFeedback, performSystemChecks, parseUrlComponents, parseResetTime, calculateWaitTime } = validation;',
        new: 'const { validateGitHubUrl, showAttachLogsWarning, initializeLogFile, validateUrlRequirement, validateContinueOnlyOnFeedback, performSystemChecks, parseUrlComponents } = validation;',
        reason: 'parseResetTime, calculateWaitTime are not used',
      },
      {
        line: 79,
        old: 'const { autoContinueWhenLimitResets, checkExistingPRsForAutoContinue, processPRMode, processAutoContinueForIssue } = autoContinue;',
        new: 'const { processAutoContinueForIssue } = autoContinue;',
        reason: 'Other functions are not used',
      },
      {
        line: 83,
        old: 'const { cleanupClaudeFile, showSessionSummary, verifyResults, handleExecutionError } = results;',
        new: 'const { cleanupClaudeFile, showSessionSummary, verifyResults } = results;',
        reason: 'handleExecutionError is not used',
      },
      {
        line: 85,
        old: 'const { executeClaude, executeClaudeCommand, buildSystemPrompt, buildUserPrompt, checkForUncommittedChanges } = claudeExecution;',
        new: 'const { executeClaude, checkForUncommittedChanges } = claudeExecution;',
        reason: 'executeClaudeCommand, buildSystemPrompt, buildUserPrompt are not used',
      },
    ],
  },
  // hive.mjs - remove unused imports
  {
    file: 'src/hive.mjs',
    fixes: [
      {
        line: 21,
        old: `const { log, setLogFile, logFile, cleanErrorMessage, maskToken, getAbsoluteLogPath, formatAligned, displayFormattedError } = lib;`,
        new: `const { log, setLogFile, logFile, cleanErrorMessage, maskToken, getAbsoluteLogPath } = lib;`,
        reason: 'formatAligned, displayFormattedError are not used',
      },
      {
        line: 29,
        old: `const { sanitizeLogContent, checkGitHubPermissions, fetchAllIssuesWithPagination, fetchProjectIssues, parseGitHubUrl, normalizeGitHubUrl, batchCheckPullRequestsForIssues } = githubLib;`,
        new: `const { sanitizeLogContent, checkGitHubPermissions, fetchAllIssuesWithPagination, fetchProjectIssues, parseGitHubUrl, batchCheckPullRequestsForIssues } = githubLib;`,
        reason: 'normalizeGitHubUrl is not used',
      },
      {
        line: 41,
        old: `const { initializeSentry, reportError, addBreadcrumb, flushSentry, closeSentry } = sentryLib;`,
        new: `const { initializeSentry, reportError, addBreadcrumb } = sentryLib;`,
        reason: 'flushSentry, closeSentry are not used',
      },
    ],
  },
];

console.log('Unused Variables Fix Analysis');
console.log('==============================\n');

for (const fileFixSet of fixes) {
  console.log(`\nFile: ${fileFixSet.file}`);
  console.log('-------------------');
  for (const fix of fileFixSet.fixes) {
    console.log(`\nLine ${fix.line}:`);
    console.log(`Reason: ${fix.reason}`);
    console.log(`Old: ${fix.old.substring(0, 80)}...`);
    console.log(`New: ${fix.new.substring(0, 80)}...`);
  }
}

console.log('\n\nSummary:');
console.log('========');
console.log(`Total files to fix: ${fixes.length}`);
console.log(`Total fixes needed: ${fixes.reduce((sum, f) => sum + f.fixes.length, 0)}`);
