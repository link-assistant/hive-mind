#!/usr/bin/env node
/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCodexGeolocationConfigArgs, buildGeolocationEnv, isGeolocationSharingEnabled, SHARE_GEOLOCATION_OPTION, withGeolocationPolicy } from '../src/geolocation-policy.lib.mjs';
import { getWorkLocale, setWorkLocale } from '../src/i18n.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS, parseArguments } from '../src/solve.config.lib.mjs';
import { getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';
import { getPreservedSolveCliArgs } from '../src/solve.forwarded-args.lib.mjs';
import { buildArgsFromParsedArgv } from '../src/cli-option-forwarding.lib.mjs';
import { buildAgentCommanderControllerOptions } from '../src/agent-commander.lib.mjs';
import { parseTaskArguments } from '../src/task.config.lib.mjs';
import { buildStartAgentArgs } from '../src/task.agent-command.lib.mjs';

const tools = ['claude', 'codex', 'agent', 'opencode', 'gemini', 'qwen'];
const privateArgs = ['-c', 'tools.web_search.location={country="",region="",city="",timezone=""}'];

test('location sharing requires an explicit boolean opt-in', () => {
  assert.equal(SHARE_GEOLOCATION_OPTION.default, false);
  assert.equal(SOLVE_OPTION_DEFINITIONS['share-geolocation'], SHARE_GEOLOCATION_OPTION);
  for (const argv of [undefined, {}, { shareGeolocation: false }, { shareGeolocation: 'true' }]) {
    assert.equal(isGeolocationSharingEnabled(argv), false);
    assert.deepEqual(buildGeolocationEnv(argv), { TZ: 'UTC' });
    assert.deepEqual(buildCodexGeolocationConfigArgs(argv), privateArgs);
  }
  for (const argv of [{ shareGeolocation: true }, { 'share-geolocation': true }]) {
    assert.equal(isGeolocationSharingEnabled(argv), true);
    assert.deepEqual(buildGeolocationEnv(argv), {});
    assert.deepEqual(buildCodexGeolocationConfigArgs(argv), []);
  }
});

test('all six system prompt builders apply the selected policy', async () => {
  const previous = getWorkLocale();
  setWorkLocale('en');
  try {
    for (const tool of tools) {
      const { buildSystemPrompt } = await import(`../src/${tool}.prompts.lib.mjs`);
      for (const shareGeolocation of [false, true]) {
        const params = { owner: 'example', repo: 'project', issueNumber: 1, prNumber: 2, branchName: 'test', argv: { tool, shareGeolocation } };
        const prompt = buildSystemPrompt(params);
        assert.ok(prompt.includes(withGeolocationPolicy('', params.argv)), `${tool}: policy missing`);
        assert.ok(prompt.includes(shareGeolocation ? 'minimum precision' : 'IP-geolocation'), `${tool}: wrong preference`);
        assert.equal(withGeolocationPolicy(prompt, params.argv), prompt, `${tool}: duplicated policy`);
      }
    }
  } finally {
    setWorkLocale(previous);
  }
});

test('every work locale supplies both policies', () => {
  const previous = getWorkLocale();
  try {
    for (const locale of ['en', 'ru', 'zh', 'hi']) {
      setWorkLocale(locale);
      const privatePolicy = withGeolocationPolicy('custom instructions');
      const allowedPolicy = withGeolocationPolicy('custom instructions', { shareGeolocation: true });
      assert.ok(privatePolicy.startsWith('custom instructions\n\n'));
      assert.notEqual(privatePolicy, allowedPolicy);
      assert.ok(privatePolicy.length > 100);
    }
  } finally {
    setWorkLocale(previous);
  }
});

test('hive forwarding and solve relaunches preserve both choices', async () => {
  assert.ok(getSolvePassthroughOptionNames().includes('share-geolocation'));
  for (const flag of ['--share-geolocation', '--no-share-geolocation']) {
    const preserved = getPreservedSolveCliArgs({ rawArgs: ['https://github.com/example/project/issues/1', flag] });
    assert.deepEqual(preserved, [flag]);
    const argv = await parseArguments(undefined, () => ['https://github.com/example/project/issues/1', ...preserved]);
    assert.equal(argv.shareGeolocation, flag === '--share-geolocation');
    assert.equal(parseTaskArguments(['node', 'task', 'Example task', flag]).shareGeolocation, argv.shareGeolocation);
    const forwarded = buildArgsFromParsedArgv({ argv, definitions: SOLVE_OPTION_DEFINITIONS, optionNames: ['share-geolocation'] });
    assert.equal((await parseArguments(undefined, () => ['https://github.com/example/project/issues/1', ...forwarded])).shareGeolocation, argv.shareGeolocation);
  }
});

test('agent-commander and task planning preserve privacy and opt-in', () => {
  for (const tool of tools) {
    for (const shareGeolocation of [false, true]) {
      const argv = { shareGeolocation };
      const controller = buildAgentCommanderControllerOptions({ tool, tempDir: '/tmp/test', prompt: 'task', systemPrompt: 'custom instructions', argv });
      assert.equal(controller.systemPrompt, withGeolocationPolicy('custom instructions', argv));
      assert.equal(controller.toolOptions.extraEnv?.TZ, shareGeolocation ? undefined : 'UTC');
      if (tool === 'codex') assert.equal(controller.toolOptions.extraArgs.includes(privateArgs[1]), !shareGeolocation);
      const args = buildStartAgentArgs({ tool, workingDirectory: '/tmp/test', prompt: 'task', systemPrompt: 'custom instructions', model: 'default', isolation: 'none', ...argv });
      assert.equal(args[args.indexOf('--system-prompt') + 1], controller.systemPrompt);
      assert.equal(args.includes('TZ=UTC'), !shareGeolocation);
      assert.equal(args.includes(privateArgs[1]), tool === 'codex' && !shareGeolocation);
    }
  }
});
