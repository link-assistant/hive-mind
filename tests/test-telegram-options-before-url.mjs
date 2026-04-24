#!/usr/bin/env node

/**
 * Regression tests for Telegram commands that put options before the URL.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1662
 */

import assert from 'assert/strict';
import { applySolveToolAlias, getFirstParsedPositionalArg, getSolveToolAliasFromText, moveArgumentToFront, parseArgsWithYargs, parseCommandArgs } from '../src/telegram-solve-command.lib.mjs';
import { createYargsConfig as createSolveYargsConfig } from '../src/solve.config.lib.mjs';
import { createYargsConfig as createHiveYargsConfig } from '../src/hive.config.lib.mjs';
import { resolveYargsFactory } from '../src/yargs-factory.lib.mjs';

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = resolveYargsFactory(yargsModule);

const issueUrl = 'https://github.com/konard/p-vs-np/issues/476';
const repoUrl = 'https://github.com/link-assistant/hive-mind';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

await test('/codex accepts --model before issue URL', async () => {
  const parsedArgs = parseCommandArgs(`/codex --model gpt-5.4-mini ${issueUrl}`);
  const args = applySolveToolAlias(parsedArgs, getSolveToolAliasFromText('/codex'));
  const urlArg = await getFirstParsedPositionalArg(args, yargs, createSolveYargsConfig, ['issue-url']);
  const normalizedArgs = moveArgumentToFront(args, urlArg);

  assert.equal(urlArg, issueUrl);
  assert.deepEqual(normalizedArgs, [issueUrl, '--model', 'gpt-5.4-mini', '--tool', 'codex']);

  const argv = await parseArgsWithYargs(normalizedArgs, yargs, createSolveYargsConfig);
  assert.equal(argv['issue-url'], issueUrl);
  assert.equal(argv.model, 'gpt-5.4-mini');
  assert.equal(argv.tool, 'codex');
});

await test('/solve reply options without URL remain available for reply extraction', async () => {
  const args = parseCommandArgs('/solve --model opus');
  const urlArg = await getFirstParsedPositionalArg(args, yargs, createSolveYargsConfig, ['issue-url']);
  assert.equal(urlArg, null);
});

await test('/codex invalid --think reports each choice once after URL probing', async () => {
  const parsedArgs = parseCommandArgs(`/codex ${issueUrl} --think ma`);
  const args = applySolveToolAlias(parsedArgs, getSolveToolAliasFromText('/codex'));

  await getFirstParsedPositionalArg(args, yargs, createSolveYargsConfig, ['issue-url']);

  const normalizedArgs = moveArgumentToFront(args, issueUrl);
  await assert.rejects(
    () => parseArgsWithYargs(normalizedArgs, yargs, createSolveYargsConfig),
    error => {
      const message = error.message || String(error);
      assert.match(message, /Argument: think, Given: "ma"/);
      assert.equal((message.match(/"off"/g) || []).length, 1);
      assert.equal((message.match(/"max"/g) || []).length, 1);
      return true;
    }
  );
});

await test('/hive accepts options before repository URL', async () => {
  const args = parseCommandArgs(`/hive --all-issues ${repoUrl}`);
  const urlArg = await getFirstParsedPositionalArg(args, yargs, createHiveYargsConfig, ['github-url']);
  const normalizedArgs = moveArgumentToFront(args, urlArg);

  assert.equal(urlArg, repoUrl);
  assert.deepEqual(normalizedArgs, [repoUrl, '--all-issues']);

  const argv = await parseArgsWithYargs(normalizedArgs, yargs, createHiveYargsConfig);
  assert.equal(argv['github-url'], repoUrl);
  assert.equal(argv.allIssues, true);
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
