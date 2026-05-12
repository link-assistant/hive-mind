#!/usr/bin/env node

/**
 * Regression test for issue #1772.
 *
 * In fork mode a custom base branch can exist in upstream but be absent from
 * the user's fork. Branch creation must copy that custom base branch to the
 * fork before creating issue-<n>-<id>, otherwise later PR creation still cannot
 * compare against origin/<baseBranch>.
 */

import assert from 'assert';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createOrCheckoutBranch } from '../src/solve.branch.lib.mjs';

const customBaseBranch = 'feat/lefine-quote-description';
const issueBranchSuffix = 'b16c6ee6a912';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(command, cwd) {
  const result = spawnSync('bash', ['-lc', command], {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error([`Command failed: ${command}`, `cwd: ${cwd}`, `exit: ${result.status}`, `stdout: ${result.stdout}`, `stderr: ${result.stderr}`].join('\n'));
  }

  return result.stdout.toString();
}

function createDollar() {
  return options =>
    (strings, ...values) => {
      const command = strings.reduce((acc, part, index) => {
        const value = index < values.length ? shellQuote(values[index]) : '';
        return acc + part + value;
      }, '');

      const result = spawnSync('bash', ['-lc', command], {
        cwd: options?.cwd,
        encoding: 'utf8',
      });

      return Promise.resolve({
        code: result.status ?? 1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      });
    };
}

function write(path, contents) {
  writeFileSync(path, contents, 'utf8');
}

const tempRoot = mkdtempSync(join(tmpdir(), 'hive-issue-1772-'));

try {
  const upstreamWork = join(tempRoot, 'upstream-work');
  const upstreamBare = join(tempRoot, 'upstream.git');
  const forkBare = join(tempRoot, 'fork.git');
  const workDir = join(tempRoot, 'work');

  mkdirSync(upstreamWork);
  run('git init', upstreamWork);
  run('git config user.email "test@example.com"', upstreamWork);
  run('git config user.name "Test User"', upstreamWork);
  write(join(upstreamWork, 'README.md'), '# Test repository\n');
  run('git add README.md', upstreamWork);
  run('git commit -m "Initial release"', upstreamWork);
  run('git branch -M release', upstreamWork);
  run(`git checkout -b ${shellQuote(customBaseBranch)}`, upstreamWork);
  write(join(upstreamWork, 'quote.txt'), 'Quote description work\n');
  run('git add quote.txt', upstreamWork);
  run('git commit -m "Add quote description"', upstreamWork);
  const upstreamFeatureHead = run('git rev-parse HEAD', upstreamWork).trim();
  run('git checkout release', upstreamWork);

  run(`git clone --bare ${shellQuote(upstreamWork)} ${shellQuote(upstreamBare)}`, tempRoot);
  run(`git clone --bare ${shellQuote(upstreamBare)} ${shellQuote(forkBare)}`, tempRoot);
  run(`git --git-dir ${shellQuote(forkBare)} update-ref -d refs/heads/${customBaseBranch}`, tempRoot);

  const forkBranchesBefore = run(`git --git-dir ${shellQuote(forkBare)} for-each-ref --format='%(refname)' refs/heads`, tempRoot);
  assert(!forkBranchesBefore.includes(`refs/heads/${customBaseBranch}`), 'test setup should omit custom base branch from fork');

  run(`git clone ${shellQuote(forkBare)} ${shellQuote(workDir)}`, tempRoot);
  run('git config user.email "test@example.com"', workDir);
  run('git config user.name "Test User"', workDir);
  run(`git remote add upstream ${shellQuote(upstreamBare)}`, workDir);
  run('git fetch upstream', workDir);
  run('git checkout release', workDir);

  const logLines = [];
  const branchName = await createOrCheckoutBranch({
    isContinueMode: false,
    prBranch: null,
    issueNumber: 56,
    tempDir: workDir,
    defaultBranch: 'release',
    argv: {
      baseBranch: customBaseBranch,
      verbose: true,
    },
    log: async message => logLines.push(String(message)),
    formatAligned: (icon, label, value) => `${icon} ${label} ${value}`,
    $: createDollar(),
    crypto: {
      randomBytes: () => Buffer.from(issueBranchSuffix, 'hex'),
    },
    owner: 'lefinepro',
    repo: 'kefine',
  });

  assert.strictEqual(branchName, `issue-56-${issueBranchSuffix}`);
  assert.strictEqual(run('git branch --show-current', workDir).trim(), branchName);
  assert.strictEqual(run('git rev-parse HEAD', workDir).trim(), upstreamFeatureHead);

  const forkBaseRef = run(`git --git-dir ${shellQuote(forkBare)} rev-parse refs/heads/${customBaseBranch}`, tempRoot).trim();
  assert.strictEqual(forkBaseRef, upstreamFeatureHead, 'custom base branch should be pushed to fork origin');

  const joinedLogs = logLines.join('\n');
  assert(joinedLogs.includes('Syncing base branch:'), 'should log proactive fork base branch sync');
  assert(joinedLogs.includes('Fork updated:'), 'should log fork base branch update');

  console.log('PASS issue #1772 fork custom base branch regression');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
