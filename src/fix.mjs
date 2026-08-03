#!/usr/bin/env node

/**
 * `/fix` command (issue #1733).
 *
 * Currently implements `--ci-cd`: automatically generate a CI/CD remediation
 * issue for a target repository and (optionally) hand it off to
 * `/solve --development-log --deep-analysis --auto-merge`.
 *
 *   fix.mjs <github-repository-url> --ci-cd [solve options...]
 *
 * Every option `/fix` does not consume itself (e.g. --tool, --model, --think)
 * is forwarded to `/solve`.
 */

import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildSolveArgs, partitionFixArgs, summarizeRunFailures } from './fix.ci-cd.lib.mjs';
import { describeChildExit } from './child-exit.lib.mjs';
import { createCiCdIssue, prepareCiCdIssue } from './fix.ci-cd-issue.lib.mjs';
import { setupStdioLogInterceptor } from './lib.mjs';

setupStdioLogInterceptor();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`Usage: fix.mjs <github-repository-url> --ci-cd [options]

Automatically generate a CI/CD remediation issue for a repository and hand it
off to /solve --development-log --deep-analysis --auto-merge.

Options:
  --ci-cd            Generate a CI/CD remediation issue (required mode)
  --dry-run          Print the issue that would be created without creating it
  --no-solve         Create the issue but do not start /solve on it
  --version          Show version number
  --help, -h         Show help

All other options (e.g. --tool, --model, --think) are forwarded to /solve.

Examples:
  fix.mjs https://github.com/owner/repo --ci-cd
  fix.mjs https://github.com/owner/repo --ci-cd --tool codex --model gpt-5.5
  fix.mjs owner/repo --ci-cd --think max --no-solve`);
}

function resolveSolveCommand() {
  return path.join(__dirname, 'solve.mjs');
}

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('--version')) {
    const { getVersion } = await import('./version.lib.mjs');
    try {
      console.log(await getVersion());
    } catch {
      console.error('Error: Unable to determine version');
      process.exit(1);
    }
    return;
  }

  if (rawArgs.length === 0 || rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    process.exit(rawArgs.length === 0 ? 1 : 0);
  }

  const parsed = partitionFixArgs(rawArgs);

  if (!parsed.ciCd) {
    console.error('❌ /fix currently supports only --ci-cd mode. Pass --ci-cd to continue.');
    process.exit(1);
  }

  if (!parsed.repository) {
    console.error('❌ Missing or invalid GitHub repository URL. Provide it as the first argument, e.g. fix.mjs https://github.com/owner/repo --ci-cd');
    process.exit(1);
  }

  const repository = parsed.repository;
  console.log(`🔧 /fix --ci-cd for ${repository.fullName}`);

  const prepared = await prepareCiCdIssue({ repository, log: message => console.log(`   ${message}`) });
  const { defaultBranch, commit, runs, runsSource, title, body } = prepared;

  const { total, failing } = summarizeRunFailures(runs);
  console.log(`   Default branch: ${defaultBranch || 'unknown'}`);
  console.log(`   Latest commit:  ${commit?.sha ? commit.sha.slice(0, 7) : 'unknown'}`);
  console.log(`   CI/CD runs:     ${total} (${failing} not passing)${runsSource === 'branch' ? ' [recent branch runs]' : ''}`);

  if (parsed.dryRun) {
    console.log('\n--- DRY RUN: issue that would be created ---\n');
    console.log(`Title: ${title}\n`);
    console.log(body);
    return;
  }

  console.log('\n📝 Creating remediation issue...');
  const issue = await createCiCdIssue({
    repository,
    prepared,
    log: message => console.log(message),
  });
  console.log(`✅ Created issue: ${issue.url}`);

  if (!parsed.runSolve) {
    console.log('ℹ️  --no-solve set; skipping /solve. Run it manually with:');
    console.log(`   solve ${buildSolveArgs({ issueUrl: issue.url, passthrough: parsed.passthrough }).join(' ')}`);
    return;
  }

  const solveArgs = buildSolveArgs({ issueUrl: issue.url, passthrough: parsed.passthrough });
  const solveCommand = resolveSolveCommand();
  console.log(`\n🚀 Starting /solve: solve ${solveArgs.join(' ')}`);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [solveCommand, ...solveArgs], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    // Issue #2135: `signal` used to be dropped here, so a solve child that
    // aborted on a V8 heap limit was reported as "solve exited with code null".
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(describeChildExit({ command: 'solve', code, signal })));
    });
  });
}

main().catch(async error => {
  // Issue #2092: printing only error.message hid the SyntaxError cause of the
  // use-m load failure, leaving the run log undiagnosable.
  const { formatFatalError } = await import('./error-formatting.lib.mjs');
  console.error(formatFatalError(error));
  process.exit(1);
});
