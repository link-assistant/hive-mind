#!/usr/bin/env node

/**
 * Issue #2220: a serialised writer still checks out `github.sha`.
 *
 * Reproduces, with real git and no GitHub, the failure that principle 10 of
 * docs/CI-CD-BEST-PRACTICES.md did not warn about: two write jobs that never
 * overlap in time (the concurrency group did its job) still collide, because
 * both checked out the commit that triggered their own run and the second one
 * therefore starts behind the branch.
 *
 * Part 1 -- what the guide used to describe: writer B pushes and is rejected.
 * Part 2 -- what the guide now prescribes: the same push, classified and
 *           retried on top of the tip that writer A landed.
 *
 * Usage: node experiments/issue-2220-serialised-writer-race.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pushWithRebaseRetry } from '../scripts/version-and-commit.lib.mjs';

const root = mkdtempSync(join(tmpdir(), 'issue-2220-'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// A push that only reports, so both halves of the experiment can use one runner.
const runner = async (command, args, { cwd } = {}) => {
  try {
    return { code: 0, stdout: execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout?.toString() ?? '', stderr: error.stderr?.toString() ?? '' };
  }
};

try {
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', origin]);

  const seed = join(root, 'seed');
  execFileSync('git', ['clone', origin, seed]);
  git(seed, 'config', 'user.email', 'ci@example.com');
  git(seed, 'config', 'user.name', 'CI');
  writeFileSync(join(seed, 'version'), '1.0.0\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'seed');
  git(seed, 'push', 'origin', 'main');
  const triggeringSha = git(seed, 'rev-parse', 'HEAD');

  // Both runs were triggered by the same commit, so `actions/checkout` gives
  // both of them the same tree -- which is the whole point.
  const checkout = name => {
    const dir = join(root, name);
    execFileSync('git', ['clone', origin, dir]);
    git(dir, 'config', 'user.email', 'ci@example.com');
    git(dir, 'config', 'user.name', 'CI');
    git(dir, 'checkout', '--detach', triggeringSha);
    git(dir, 'checkout', '-B', 'main');
    return dir;
  };

  const writerA = checkout('writer-a');
  const writerB = checkout('writer-b');
  console.log(`Both writers checked out github.sha = ${triggeringSha.slice(0, 7)}\n`);

  // Writer A runs first and finishes completely: the group is working.
  writeFileSync(join(writerA, 'version'), '1.1.0\n');
  git(writerA, 'commit', '-am', 'release 1.1.0 (writer A)');
  git(writerA, 'push', 'origin', 'main');
  console.log(`Writer A landed ${git(writerA, 'rev-parse', 'HEAD').slice(0, 7)} -- no overlap with writer B.\n`);

  // Writer B starts only now, and is already behind.
  writeFileSync(join(writerB, 'notes.md'), 'changelog for writer B\n');
  git(writerB, 'add', '.');
  git(writerB, 'commit', '-m', 'changelog (writer B)');

  console.log('--- Part 1: the push the guide did not warn about ---');
  const naive = await runner('git', ['push', 'origin', 'main'], { cwd: writerB });
  console.log(`exit code ${naive.code}`);
  console.log(naive.stderr.trim());

  console.log('\n--- Part 2: the recovery the guide now prescribes ---');
  const landed = await pushWithRebaseRetry({
    runner: (command, args) => runner(command, args, { cwd: writerB }),
    sleeper: async () => {},
  });
  console.log(`pushed on attempt ${landed.attempt}`);
  console.log(`origin/main history: ${git(writerB, 'log', '--oneline', 'origin/main').split('\n').reverse().join(' -> ')}`);
  console.log(`writer A's commit survived: ${git(writerB, 'log', '--oneline', 'origin/main').includes('writer A')}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
