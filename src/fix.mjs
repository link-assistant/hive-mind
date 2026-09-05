#!/usr/bin/env node

/**
 * `/fix` command (issues #1733 and #2184).
 *
 * Two modes, each of which automatically generates an issue for a target
 * repository and (optionally) hands it off to `/solve`:
 *
 *   --ci-cd                     CI/CD remediation (issue #1733)
 *   --update-all-dependencies   Update every dependency in every language
 *                               (issue #2184)
 *
 *   fix.mjs <github-repository-url> --ci-cd [solve options...]
 *   fix.mjs <github-repository-url> --update-all-dependencies [solve options...]
 *
 * Every option `/fix` does not consume itself (e.g. --tool, --model, --think)
 * is forwarded to `/solve`.
 */

import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { FIX_MODE_CI_CD, FIX_MODE_UPDATE_ALL_DEPENDENCIES, FIX_MODES, buildSolveArgs, partitionFixArgs } from './fix.args.lib.mjs';
import { summarizeRunFailures } from './fix.ci-cd.lib.mjs';
import { describeChildExit } from './child-exit.lib.mjs';
import { createCiCdIssue, prepareCiCdIssue } from './fix.ci-cd-issue.lib.mjs';
import { createUpdateDependenciesIssue, prepareUpdateDependenciesIssue } from './fix.update-dependencies-issue.lib.mjs';
import { setupStdioLogInterceptor } from './lib.mjs';

setupStdioLogInterceptor();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`Usage: fix.mjs <github-repository-url> <mode> [options]

Automatically generate an issue for a repository and hand it off to /solve.

Modes (exactly one is required):
  --ci-cd                     Generate a CI/CD remediation issue
  --update-all-dependencies   Generate an issue to update every dependency in
                              every language used by the repository

Options:
  --dry-run          Print the issue that would be created without creating it
  --no-solve         Create the issue but do not start /solve on it
  --version          Show version number
  --help, -h         Show help

All other options (e.g. --tool, --model, --think) are forwarded to /solve.

Examples:
  fix.mjs https://github.com/owner/repo --ci-cd
  fix.mjs https://github.com/owner/repo --ci-cd --tool codex --model gpt-5.5
  fix.mjs https://github.com/owner/repo --update-all-dependencies
  fix.mjs owner/repo --update-all-dependencies --dry-run
  fix.mjs owner/repo --ci-cd --think max --no-solve`);
}

function resolveSolveCommand() {
  return path.join(__dirname, 'solve.mjs');
}

/**
 * Per-mode wiring: how the issue is prepared, created and summarized.
 *
 * Keeping the two modes' differences in data means the flow below (validate →
 * prepare → dry-run → create → solve) is written once, so a change to the
 * handoff cannot apply to one mode and silently skip the other.
 */
const MODE_HANDLERS = {
  [FIX_MODE_CI_CD]: {
    label: '--ci-cd',
    prepare: prepareCiCdIssue,
    create: createCiCdIssue,
    summarize: prepared => {
      const { total, failing } = summarizeRunFailures(prepared.runs);
      return [`Default branch: ${prepared.defaultBranch || 'unknown'}`, `Latest commit:  ${prepared.commit?.sha ? prepared.commit.sha.slice(0, 7) : 'unknown'}`, `CI/CD runs:     ${total} (${failing} not passing)${prepared.runsSource === 'branch' ? ' [recent branch runs]' : ''}`];
    },
  },
  [FIX_MODE_UPDATE_ALL_DEPENDENCIES]: {
    label: '--update-all-dependencies',
    prepare: prepareUpdateDependenciesIssue,
    create: createUpdateDependenciesIssue,
    summarize: prepared => {
      const manifests = prepared.ecosystems.reduce((sum, entry) => sum + entry.manifests.length, 0);
      return [`Default branch: ${prepared.defaultBranch || 'unknown'}`, `Latest commit:  ${prepared.commit?.sha ? prepared.commit.sha.slice(0, 7) : 'unknown'}`, `Ecosystems:     ${prepared.ecosystems.length} (${manifests} manifest file(s))${prepared.filesTruncated ? ' [file listing truncated by GitHub]' : ''}`, `                ${prepared.ecosystems.map(entry => entry.ecosystem.label).join(', ') || 'none detected'}`];
    },
  },
};

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

  if (parsed.modes.length === 0) {
    console.error(`❌ /fix requires a mode. Pass one of: ${FIX_MODES.map(mode => mode.flag).join(', ')}.`);
    process.exit(1);
  }

  if (parsed.modes.length > 1) {
    // Each mode creates its own issue with its own solve options, so combining
    // them would silently produce one issue and drop the other mode's prompt.
    console.error(`❌ /fix accepts one mode at a time; got ${parsed.modes.map(mode => `--${mode}`).join(' and ')}. Run /fix once per mode.`);
    process.exit(1);
  }

  const handler = MODE_HANDLERS[parsed.mode];

  if (!parsed.repository) {
    console.error(`❌ Missing or invalid GitHub repository URL. Provide it as the first argument, e.g. fix.mjs https://github.com/owner/repo ${handler.label}`);
    process.exit(1);
  }

  const repository = parsed.repository;
  console.log(`🔧 /fix ${handler.label} for ${repository.fullName}`);

  const prepared = await handler.prepare({ repository, log: message => console.log(`   ${message}`) });
  for (const line of handler.summarize(prepared)) console.log(`   ${line}`);

  if (parsed.dryRun) {
    console.log('\n--- DRY RUN: issue that would be created ---\n');
    console.log(`Title: ${prepared.title}\n`);
    console.log(prepared.body);
    return;
  }

  console.log('\n📝 Creating issue...');
  const issue = await handler.create({
    repository,
    prepared,
    log: message => console.log(message),
  });
  console.log(`✅ Created issue: ${issue.url}`);

  const solveArgs = buildSolveArgs({ issueUrl: issue.url, passthrough: parsed.passthrough, mode: parsed.mode });

  if (!parsed.runSolve) {
    console.log('ℹ️  --no-solve set; skipping /solve. Run it manually with:');
    console.log(`   solve ${solveArgs.join(' ')}`);
    return;
  }

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
