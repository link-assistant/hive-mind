#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkReplacementRepositoryBranchSafety } from '../src/solve.repository-safety.lib.mjs';

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const renderCommand = (strings, values) => strings.reduce((acc, chunk, index) => acc + chunk + (index < values.length ? String(values[index]) : ''), '');

function makeFakeDollar(handler) {
  const calls = [];
  const $ =
    options =>
    async (strings, ...values) => {
      const command = renderCommand(strings, values).trim();
      calls.push({ options, command });
      const response = await handler(command, options);
      return {
        code: response?.code ?? 0,
        stdout: Buffer.from(response?.stdout ?? ''),
        stderr: Buffer.from(response?.stderr ?? ''),
      };
    };
  $.calls = calls;
  return $;
}

await test('blocks replacement deletion when a side branch has commits not reachable from upstream', async () => {
  const $ = makeFakeDollar(command => {
    if (command.startsWith('git init')) return { stdout: '' };
    if (command.includes('git fetch') && command.includes('Payel-git-ol/Octra.git')) return { stdout: '' };
    if (command.includes('git fetch') && command.includes('konard/Payel-git-ol-Octra.git')) return { stdout: '' };
    if (command.startsWith('git for-each-ref')) {
      return {
        stdout: ['replacement/master 5d713671483ac3a26d24826f89c61cecdb6a0da3', 'replacement/issue-9-86efa1403a45 7f860d683f3025b3caa810d4c633b127f9f50fe8'].join('\n'),
      };
    }
    if (command.includes('git rev-list --count replacement/master')) return { stdout: '0\n' };
    if (command.includes('git rev-list --count replacement/issue-9-86efa1403a45')) return { stdout: '1\n' };
    if (command.includes('git log -1 --format=%s replacement/issue-9-86efa1403a45')) return { stdout: 'Revert "Initial commit with task details"\n' };
    throw new Error(`Unexpected command: ${command}`);
  });

  const result = await checkReplacementRepositoryBranchSafety({
    $,
    owner: 'Payel-git-ol',
    repo: 'Octra',
    existingRepository: 'konard/Payel-git-ol-Octra',
  });

  assert.equal(result.safeToDelete, false);
  assert.equal(result.branchCount, 2);
  assert.deepEqual(result.uniqueBranches, [
    {
      ref: 'issue-9-86efa1403a45',
      sha: '7f860d683f3025b3caa810d4c633b127f9f50fe8',
      uniqueCommitCount: 1,
      subject: 'Revert "Initial commit with task details"',
    },
  ]);
  assert.match(result.safetyCheckDescription, /Local Git branch reachability found 1 replacement branch tip/);
  assert.match(result.safetyCheckDescription, /issue-9-86efa1403a45/);
  assert.match(result.safetyCheckDescription, /7f860d683f30/);
});

await test('allows replacement deletion only when every replacement branch tip is reachable upstream', async () => {
  const $ = makeFakeDollar(command => {
    if (command.startsWith('git init')) return { stdout: '' };
    if (command.includes('git fetch')) return { stdout: '' };
    if (command.startsWith('git for-each-ref')) {
      return {
        stdout: ['replacement/master 5d713671483ac3a26d24826f89c61cecdb6a0da3', 'replacement/create/adapter-node 2cf16ba84a89126370aad665555efdbc9980d28d'].join('\n'),
      };
    }
    if (command.includes('git rev-list --count replacement/master')) return { stdout: '0\n' };
    if (command.includes('git rev-list --count replacement/create/adapter-node')) return { stdout: '0\n' };
    throw new Error(`Unexpected command: ${command}`);
  });

  const result = await checkReplacementRepositoryBranchSafety({
    $,
    owner: 'Payel-git-ol',
    repo: 'Octra',
    existingRepository: 'konard/Payel-git-ol-Octra',
  });

  assert.equal(result.safeToDelete, true);
  assert.equal(result.branchCount, 2);
  assert.deepEqual(result.uniqueBranches, []);
  assert.match(result.safetyCheckDescription, /all 2 replacement branch tip/);
});

await test('repository setup calls the all-branch safety helper before auto-recovery deletion', async () => {
  const source = readFileSync(new URL('../src/solve.repository.lib.mjs', import.meta.url), 'utf8');

  assert.match(source, /checkReplacementRepositoryBranchSafety/);
  assert.match(source, /Checking all replacement branches against upstream refs/);
  assert.match(source, /Default branch has .* ahead of upstream/);
});
