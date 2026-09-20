#!/usr/bin/env node

/**
 * Regression coverage for issue #1785.
 *
 * Empty repositories can still report an unborn branch name through
 * `git branch --show-current`. The solver must detect that HEAD has no commit
 * before branch creation tries to use origin/<defaultBranch>.
 */

import assert from 'assert';
import { verifyDefaultBranchAndStatus } from '../src/solve.repo-setup.lib.mjs';

function createMockDollar({ commands }) {
  const calls = [];

  const runCommand = command => {
    calls.push(command);
    const response = commands[command];
    if (!response) {
      throw new Error(`Unexpected command: ${command}`);
    }
    return {
      code: response.code ?? 0,
      stdout: Buffer.from(response.stdout ?? ''),
      stderr: Buffer.from(response.stderr ?? ''),
    };
  };

  const tag = (strings, ...values) => {
    const command = strings.reduce((acc, part, index) => acc + part + (values[index] ?? ''), '');
    return Promise.resolve(runCommand(command));
  };

  const dollar = options => {
    if (options && typeof options === 'object' && 'cwd' in options) {
      return tag;
    }
    return tag(options);
  };

  dollar.calls = calls;
  return dollar;
}

const logs = [];
const log = async message => {
  logs.push(String(message));
};
const formatAligned = (_icon, label, value) => `${label} ${value}`.trim();

const $ = createMockDollar({
  commands: {
    'git branch --show-current': { stdout: 'main\n' },
    'git rev-parse --verify HEAD 2>&1': {
      code: 128,
      stdout: "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\nHEAD\n",
    },
    'git branch -r': { stdout: '' },
    'git status --porcelain': { stdout: '' },
  },
});

let threw = false;
try {
  await verifyDefaultBranchAndStatus({
    tempDir: '/tmp/empty-repo',
    log,
    formatAligned,
    $,
    argv: {},
    owner: 'glsfull',
    repo: 'med',
    issueUrl: null,
  });
} catch (error) {
  threw = true;
  assert.match(error.message, /Empty repository detected/);
}

assert.equal(threw, true, 'empty repository should fail before branch creation');
assert(!$.calls.includes('git status --porcelain'), 'empty repository should not continue into normal status checks');
assert(
  logs.some(line => line.includes('EMPTY REPOSITORY DETECTED')),
  'empty repository guidance should be logged'
);

console.log('PASS issue #1785 empty repository default branch regression');
