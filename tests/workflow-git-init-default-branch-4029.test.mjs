/** @hive-mind-test-suite default */
/**
 * Issue #4029: every `actions/checkout` runs `git init`, which prints a
 * nine-line "Using 'master' as the name for the initial branch" hint unless
 * `init.defaultBranch` is configured. Seven workflows (including the reusable
 * native Codex build, which does not inherit the caller's `env`) printed it on
 * every job. Each workflow that checks out or initialises a repository sets the
 * value once, at workflow level.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const directory = new URL('../.github/workflows/', import.meta.url);
const workflows = readdirSync(directory).filter(name => /\.ya?ml$/u.test(name));

test('every workflow that runs git init configures init.defaultBranch at workflow level', () => {
  const checked = [];
  for (const name of workflows) {
    const text = readFileSync(new URL(name, directory), 'utf8');
    if (!/actions\/checkout@|\bgit init\b/u.test(text)) continue;
    checked.push(name);
    const top = /^env:[^\n]*\n((?: {2}.*\n|#.*\n)*)/mu.exec(text)?.[1] ?? '';
    const pairs = new Map();
    for (const match of top.matchAll(/^ {2}GIT_CONFIG_(KEY|VALUE)_(\d+): '?([^'\n]+)'?$/gmu)) pairs.set(`${match[1]}${match[2]}`, match[3]);
    const count = Number(/^ {2}GIT_CONFIG_COUNT: '?(\d+)'?$/mu.exec(top)?.[1] ?? 0);
    const index = [...Array(count).keys()].find(i => pairs.get(`KEY${i}`) === 'init.defaultBranch');
    assert.notEqual(index, undefined, `${name}: workflow-level env lacks GIT_CONFIG init.defaultBranch`);
    assert.equal(pairs.get(`VALUE${index}`), 'main', name);
  }
  assert.ok(checked.length >= 10, `only ${checked.length} workflows checked`);
});
