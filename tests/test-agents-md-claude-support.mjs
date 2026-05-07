#!/usr/bin/env node

import assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdtemp, rm, writeFile, readFile, access } from 'fs/promises';
import os from 'os';
import path from 'path';
import { cleanupAgentsMdAsClaudeMd, prepareAgentsMdAsClaudeMd } from '../src/agents-md-claude-support.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';

const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

const createDollar =
  () =>
  options =>
  async (strings, ...values) => {
    const command = strings.reduce((acc, part, index) => acc + part + (index < values.length ? shellQuote(values[index]) : ''), '');
    try {
      const stdout = execFileSync('bash', ['-lc', command], {
        cwd: options?.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout, stderr: '' };
    } catch (error) {
      return {
        code: error.status ?? 1,
        stdout: error.stdout?.toString() || '',
        stderr: error.stderr?.toString() || '',
      };
    }
  };

const $ = createDollar();
const logs = [];
const log = async message => logs.push(message);
const formatAligned = (_icon, label, value) => `${label} ${value}`;

async function fileExists(filePath) {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function createRepo() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agents-md-claude-support-'));
  git(tempDir, ['init', '-q']);
  git(tempDir, ['config', 'user.email', 'test@example.com']);
  git(tempDir, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(tempDir, 'README.md'), '# Test\n');
  git(tempDir, ['add', 'README.md']);
  git(tempDir, ['commit', '-q', '-m', 'Initial commit']);
  return tempDir;
}

async function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    console.log('PASSED');
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    throw error;
  }
}

async function withRepo(testFn) {
  const tempDir = await createRepo();
  try {
    await testFn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const enabledArgv = { autoSupportAgentsMdAsClaudeMd: true, tool: 'claude' };
const disabledArgv = { autoSupportAgentsMdAsClaudeMd: false, tool: 'claude' };
const agentsContent = '# Agent Instructions\n\nRun tests before committing.\n';

await runTest('disabled option does not create CLAUDE.md', async () => {
  await withRepo(async tempDir => {
    await writeFile(path.join(tempDir, 'AGENTS.md'), agentsContent);
    const state = await prepareAgentsMdAsClaudeMd({ tempDir, argv: disabledArgv, fs: { readFile, writeFile }, path, log, formatAligned });
    assert.equal(state.created, false);
    assert.equal(await fileExists(path.join(tempDir, 'CLAUDE.md')), false);
  });
});

await runTest('enabled option creates and removes an untracked temporary CLAUDE.md', async () => {
  await withRepo(async tempDir => {
    await writeFile(path.join(tempDir, 'AGENTS.md'), agentsContent);
    const fsApi = { readFile, writeFile, rm };
    const state = await prepareAgentsMdAsClaudeMd({ tempDir, argv: enabledArgv, prompt: 'Fix issue', fs: fsApi, path, log, formatAligned });
    assert.equal(state.created, true);
    assert.equal(await readFile(path.join(tempDir, 'CLAUDE.md'), 'utf8'), agentsContent);

    const cleanup = await cleanupAgentsMdAsClaudeMd({ state, tempDir, fs: fsApi, path, $, log, formatAligned });
    assert.equal(cleanup.action, 'removed-untracked');
    assert.equal(await fileExists(path.join(tempDir, 'CLAUDE.md')), false);
  });
});

await runTest('existing different CLAUDE.md is left untouched', async () => {
  await withRepo(async tempDir => {
    await writeFile(path.join(tempDir, 'AGENTS.md'), agentsContent);
    await writeFile(path.join(tempDir, 'CLAUDE.md'), '# Existing Claude instructions\n');
    const state = await prepareAgentsMdAsClaudeMd({ tempDir, argv: enabledArgv, fs: { readFile, writeFile }, path, log, formatAligned });
    assert.equal(state.created, false);
    assert.equal(await readFile(path.join(tempDir, 'CLAUDE.md'), 'utf8'), '# Existing Claude instructions\n');
  });
});

await runTest('solve option is experimental and disabled by default', async () => {
  const option = SOLVE_OPTION_DEFINITIONS['auto-support-agents-md-as-claude-md'];
  assert.equal(option.type, 'boolean');
  assert.equal(option.default, false);
  assert.match(option.description, /EXPERIMENTAL/);
});

await runTest('existing matching CLAUDE.md is removed unless user input mentions it', async () => {
  await withRepo(async tempDir => {
    await writeFile(path.join(tempDir, 'AGENTS.md'), agentsContent);
    await writeFile(path.join(tempDir, 'CLAUDE.md'), agentsContent);
    const fsApi = { readFile, writeFile, rm };
    const state = await prepareAgentsMdAsClaudeMd({ tempDir, argv: enabledArgv, prompt: 'Fix issue', fs: fsApi, path, log, formatAligned });
    assert.equal(state.created, false);
    assert.equal(state.cleanupCandidate, true);
    const cleanup = await cleanupAgentsMdAsClaudeMd({ state, tempDir, fs: fsApi, path, $, log, formatAligned });
    assert.equal(cleanup.action, 'removed-untracked');
    assert.equal(await fileExists(path.join(tempDir, 'CLAUDE.md')), false);
  });
});

await runTest('existing matching CLAUDE.md is kept when user input mentions it', async () => {
  await withRepo(async tempDir => {
    await writeFile(path.join(tempDir, 'AGENTS.md'), agentsContent);
    await writeFile(path.join(tempDir, 'CLAUDE.md'), agentsContent);
    const state = await prepareAgentsMdAsClaudeMd({ tempDir, argv: enabledArgv, prompt: 'Please update CLAUDE.md', fs: { readFile, writeFile }, path, log, formatAligned });
    assert.equal(state.created, false);
    assert.equal(state.cleanupCandidate, false);
    assert.equal(await readFile(path.join(tempDir, 'CLAUDE.md'), 'utf8'), agentsContent);
  });
});

await runTest('committed unchanged temporary CLAUDE.md is deleted when input does not mention it', async () => {
  await withRepo(async tempDir => {
    await writeFile(path.join(tempDir, 'AGENTS.md'), agentsContent);
    const fsApi = { readFile, writeFile, rm };
    const state = await prepareAgentsMdAsClaudeMd({ tempDir, argv: enabledArgv, prompt: 'Fix issue', fs: fsApi, path, log, formatAligned });
    git(tempDir, ['add', 'CLAUDE.md']);
    git(tempDir, ['commit', '-q', '-m', 'Accidentally commit temporary CLAUDE.md']);

    const cleanup = await cleanupAgentsMdAsClaudeMd({ state, tempDir, fs: fsApi, path, $, log, formatAligned });
    assert.equal(cleanup.action, 'removed-committed-copy');
    assert.equal(await fileExists(path.join(tempDir, 'CLAUDE.md')), false);
    assert.equal(git(tempDir, ['ls-files', 'CLAUDE.md']), '');
  });
});

await runTest('committed unchanged temporary CLAUDE.md is kept when user input mentions it', async () => {
  await withRepo(async tempDir => {
    await writeFile(path.join(tempDir, 'AGENTS.md'), agentsContent);
    const fsApi = { readFile, writeFile, rm };
    const state = await prepareAgentsMdAsClaudeMd({ tempDir, argv: enabledArgv, prompt: 'Please update CLAUDE.md', fs: fsApi, path, log, formatAligned });
    git(tempDir, ['add', 'CLAUDE.md']);
    git(tempDir, ['commit', '-q', '-m', 'Keep CLAUDE.md on purpose']);

    const cleanup = await cleanupAgentsMdAsClaudeMd({ state, tempDir, fs: fsApi, path, $, log, formatAligned });
    assert.equal(cleanup.action, 'left-user-mentioned-claude-md');
    assert.equal(await readFile(path.join(tempDir, 'CLAUDE.md'), 'utf8'), agentsContent);
    assert.equal(git(tempDir, ['ls-files', 'CLAUDE.md']), 'CLAUDE.md');
  });
});

await runTest('modified temporary CLAUDE.md is left untouched', async () => {
  await withRepo(async tempDir => {
    await writeFile(path.join(tempDir, 'AGENTS.md'), agentsContent);
    const fsApi = { readFile, writeFile, rm };
    const state = await prepareAgentsMdAsClaudeMd({ tempDir, argv: enabledArgv, prompt: 'Fix issue', fs: fsApi, path, log, formatAligned });
    await writeFile(path.join(tempDir, 'CLAUDE.md'), `${agentsContent}\nExtra Claude notes.\n`);

    const cleanup = await cleanupAgentsMdAsClaudeMd({ state, tempDir, fs: fsApi, path, $, log, formatAligned });
    assert.equal(cleanup.action, 'left-modified');
    assert.equal(await fileExists(path.join(tempDir, 'CLAUDE.md')), true);
  });
});

await runTest('lowercase agents.md is supported', async () => {
  await withRepo(async tempDir => {
    await writeFile(path.join(tempDir, 'agents.md'), agentsContent);
    const fsApi = { readFile, writeFile, rm };
    const state = await prepareAgentsMdAsClaudeMd({ tempDir, argv: enabledArgv, prompt: 'Fix issue', fs: fsApi, path, log, formatAligned });
    assert.equal(state.created, true);
    assert.equal(await readFile(path.join(tempDir, 'CLAUDE.md'), 'utf8'), agentsContent);
    await cleanupAgentsMdAsClaudeMd({ state, tempDir, fs: fsApi, path, $, log, formatAligned });
  });
});

console.log('\nAll AGENTS.md to CLAUDE.md support tests passed.');
