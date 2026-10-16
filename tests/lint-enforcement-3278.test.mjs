#!/usr/bin/env node
/**
 * Issue #3278: the repository's own ESLint config enforces the bot rules.
 *
 * - A deliberately added `execSync`, `readFileSync` or unbounded `$` call in a
 *   bot handler module fails `npm run lint`.
 * - Every baseline entry carries the reason the file may keep its findings,
 *   and its count is exact, so a converted call has to shrink the baseline.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3278
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
// A bot command module with no baseline entry: it must stay free of findings.
const handlerFile = path.join(rootDir, 'src', 'telegram-top-command.lib.mjs');
const RULES = ['no-sync-in-bot-process', 'require-exec-timeout'];

const readBaseline = name => JSON.parse(fs.readFileSync(path.join(rootDir, 'eslint-rules', 'baselines', `${name}.json`), 'utf8'));

const hiveMessages = async (eslint, code, filePath = handlerFile) => {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter(message => message.ruleId?.startsWith('hive/'));
};

test('an added sync call or unbounded command in a bot handler fails lint', async () => {
  const eslint = new ESLint({ cwd: rootDir });
  const original = fs.readFileSync(handlerFile, 'utf8');
  assert.deepEqual(await hiveMessages(eslint, original), [], 'the handler module is clean as committed');

  const cases = [
    { snippet: "import { execSync } from 'node:child_process';\nexport const probe3278 = () => execSync('docker ps');\n", rule: 'hive/no-sync-in-bot-process' },
    { snippet: "import { readFileSync } from 'node:fs';\nexport const probe3278 = () => readFileSync('/tmp/state.json', 'utf8');\n", rule: 'hive/no-sync-in-bot-process' },
    { snippet: 'export const probe3278 = async $ => await $`gh api user`;\n', rule: 'hive/require-exec-timeout' },
    { snippet: 'export const probe3278 = async $ => await $({ timeout: 1000 })`git fetch origin`;\n', rule: 'hive/require-exec-timeout' },
  ];
  for (const { snippet, rule } of cases) {
    const messages = await hiveMessages(eslint, `${original}\n${snippet}`);
    assert.ok(
      messages.some(message => message.ruleId === rule && message.severity === 2),
      `${rule} reports:\n${snippet}`
    );
  }

  const bounded = 'export const probe3278 = async $ => await $({ signal: AbortSignal.timeout(30_000) })`gh api user`;\n';
  assert.deepEqual(await hiveMessages(eslint, `${original}\n${bounded}`), [], 'a `$` call bounded by an AbortSignal passes');
});

test('every baseline entry gives its reason', () => {
  for (const name of RULES) {
    for (const [file, entry] of Object.entries(readBaseline(name))) {
      assert.ok(fs.existsSync(path.join(rootDir, file)), `${name}: ${file} exists`);
      assert.ok(Number.isInteger(entry.count) && entry.count > 0, `${name}: ${file} has a positive count`);
      assert.ok(typeof entry.reason === 'string' && entry.reason.trim().length >= 20, `${name}: ${file} says why it may keep its findings`);
    }
  }
});

test('baseline counts are exact, so a converted call shrinks the baseline', async () => {
  for (const name of RULES) {
    const baseline = readBaseline(name);
    const files = Object.keys(baseline);
    // The same config, with the baseline emptied: every remaining finding is reported.
    const eslint = new ESLint({ cwd: rootDir, overrideConfig: { rules: { [`hive/${name}`]: ['error', { baseline: {} }] } } });
    const results = await eslint.lintFiles(files.map(file => path.join(rootDir, file)));
    const counts = Object.fromEntries(results.map(result => [path.relative(rootDir, result.filePath).split(path.sep).join('/'), result.messages.filter(message => message.ruleId === `hive/${name}`).length]));
    for (const file of files) {
      assert.equal(counts[file], baseline[file].count, `${name}: ${file} has ${counts[file]} finding(s), its baseline says ${baseline[file].count}`);
    }
  }
});
