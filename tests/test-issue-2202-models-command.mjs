#!/usr/bin/env node
/**
 * Regression test for issue #2202 — the `/models` command and the pre-flight
 * CLI update check.
 *
 * - **R5** — "add /models command, with options like `--tool claude` and
 *   `--tool codex` and others, that will provide us with list of merged models
 *   (from fully supported, to hot loaded)". Covers the argument parsing of both
 *   front ends (`hive-models` and Telegram `/models`), the shared renderer, and
 *   the end-to-end run with the catalogue injected — so the command is tested
 *   without a network, a router, or a package registry.
 * - **R6** — "each /solve and other commands that relevant for claude/codex
 *   tools should check if new version available, and before starting task
 *   execution or before providing new models list - we should update them".
 *   Covers the narrowing (a codex listing must not reinstall Gemini), the
 *   opt-outs, the "do not count myself as a busy task" rule that would
 *   otherwise make the check a permanent no-op inside a solve run, and the
 *   guarantee that a failed refresh never takes the command down with it.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

import { describeFreshnessResult, ensureAgenticCliFreshness, parseTaskRef, resolveFreshnessTools } from '../src/agentic-cli-freshness.lib.mjs';
import { listAgenticCliUpdateTargets } from '../src/agentic-cli-updater.lib.mjs';
import { buildSolveArgs, partitionFixArgs } from '../src/fix.ci-cd.lib.mjs';
import { getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { parseTaskArguments } from '../src/task.config.lib.mjs';
import { parseHiveModelsArgs, runHiveModels } from '../src/hive-models.lib.mjs';
import { MODEL_CATALOGUE_TOOLS } from '../src/model-catalogue.lib.mjs';
import { describeCatalogueSources, formatAge, formatModelCatalogueTelegram, formatModelCatalogueText, formatModelSpec, formatTokenCount, groupHeading } from '../src/model-catalogue-render.lib.mjs';
import { parseModelsCommandArgs, registerModelsCommand } from '../src/telegram-models-command.lib.mjs';

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  PASS: ${label}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL: ${label}`);
    console.error(`     ${error?.message ?? error}`);
    failed++;
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`  PASS: ${label}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL: ${label}`);
    console.error(`     ${error?.message ?? error}`);
    failed++;
  }
}

/** A merged catalogue shaped exactly like `mergeModelCatalogue` returns one. */
const sampleMerged = (overrides = {}) => ({
  tool: 'claude',
  default: 'opus',
  bundledAndLive: [{ id: 'claude-opus-5', label: 'Claude Opus 5', aliases: ['opus', 'opus-5'], sources: ['router', 'anthropic-api'], services: ['anthropic'], spec: { limit: { context: 1000000, output: 128000 }, cost: { input: 5, output: 25 }, reasoning: true, release_date: '2026-07-24' } }],
  liveOnly: [{ id: 'claude-fable-5-2', label: 'Claude Fable 5.2', aliases: [], sources: ['anthropic-api'], services: ['anthropic'], spec: null }],
  bundledOnly: [{ id: 'opusplan', label: null, aliases: [], sources: ['bundled'], services: [], spec: null }],
  counts: { bundledAndLive: 1, liveOnly: 1, bundledOnly: 1 },
  catalogue: {
    tool: 'claude',
    ttlMs: 60 * 60 * 1000,
    hotLoad: true,
    router: { available: true, reason: null, external: false, transport: 'exec' },
    sources: [
      { id: 'router', label: 'Link.Assistant Router', kind: 'live', status: 'ok', models: [{ id: 'claude-opus-5' }], meta: {}, cached: false, ageMs: 0 },
      { id: 'anthropic-api', label: 'Anthropic GET /v1/models', kind: 'live', status: 'ok', models: [{ id: 'claude-opus-5' }, { id: 'claude-fable-5-2' }], meta: {}, cached: true, ageMs: 12 * 60 * 1000 },
      { id: 'models-dev', label: 'models.dev', kind: 'metadata', status: 'ok', models: [], meta: { metadata: { 'claude-opus-5': {}, 'claude-sonnet-5': {} } }, cached: false, ageMs: 0 },
      { id: 'bundled', label: 'Bundled with this installation', kind: 'bundled', status: 'ok', models: [{ id: 'claude-opus-5' }, { id: 'opusplan' }], meta: {}, cached: false, ageMs: 0 },
    ],
  },
  ...overrides,
});

console.log('\n--- R5: the rendering shared by both front ends ---');

check('the three groups are labelled so a reader can tell them apart', () => {
  const text = formatModelCatalogueText(sampleMerged());
  assert.match(text, /Bundled and live \(1\) — shipped with this installation and confirmed reachable now/);
  assert.match(text, /Hot loaded \(1\)/, 'R5: live-only models are the "hot loaded" group');
  assert.match(text, /Bundled only \(1\)/);
  assert.match(text, /claude-fable-5-2/, 'a model no live source shipped with us must still be listed');
});

check('aliases and the default model are visible, because that is what a user types', () => {
  const text = formatModelCatalogueText(sampleMerged(), { defaultModel: 'opus' });
  assert.match(text, /claude-opus-5 \(opus, opus-5\)/);
  assert.match(text, /\* claude-opus-5/, 'the default model is marked');
});

check('--details prints the R8 specification columns', () => {
  const text = formatModelCatalogueText(sampleMerged(), { details: true });
  assert.match(text, /1M ctx/);
  assert.match(text, /128K out/);
  assert.match(text, /\$5\/\$25 per Mtok/);
  assert.match(text, /via Link\.Assistant Router, Anthropic GET \/v1\/models/, 'R8: which source supplied a model is part of the answer');
});

check('a model with no specification prints no invented one', () => {
  assert.equal(formatModelSpec({ id: 'x', spec: null }), '');
  assert.equal(formatModelSpec({ id: 'x', spec: { limit: { context: 200000 } } }), '200K ctx');
});

check('token counts and ages are rendered for humans', () => {
  assert.equal(formatTokenCount(200000), '200K');
  assert.equal(formatTokenCount(1000000), '1M');
  assert.equal(formatTokenCount(0), null, 'a missing limit is absent, not zero');
  assert.equal(formatAge(45 * 1000), '45s');
  assert.equal(formatAge(12 * 60 * 1000), '12 min');
  assert.equal(formatAge(60 * 60 * 1000), '1h 0m');
});

check('a metadata source reports specifications, not a misleading zero', () => {
  const described = describeCatalogueSources(sampleMerged().catalogue);
  const modelsDev = described.find(source => source.id === 'models-dev');
  assert.match(modelsDev.text, /specifications for 2 model\(s\)/);
  const anthropic = described.find(source => source.id === 'anthropic-api');
  assert.match(anthropic.text, /2 model\(s\) · cached 12 min/, 'a cached answer says how old it is');
});

check('with hot load off the bundled group is not accused of being unconfirmed', () => {
  const merged = sampleMerged();
  merged.catalogue.hotLoad = false;
  assert.equal(groupHeading('bundledOnly', { hotLoad: false }).title, 'Bundled');
  const text = formatModelCatalogueText(merged);
  assert.match(text, /live sources were not consulted/);
  assert.doesNotMatch(text, /no live source confirmed them/);
});

check('the router explains itself once, not twice', () => {
  const merged = sampleMerged();
  merged.catalogue.router = { available: false, reason: 'router catalogue reads are disabled', external: false, transport: null };
  const withRouterSource = formatModelCatalogueText(merged);
  assert.equal((withRouterSource.match(/router/gi) ?? []).length > 0, true);
  assert.doesNotMatch(withRouterSource, /- router: not read/, 'the router already has a source line here');

  merged.catalogue.sources = merged.catalogue.sources.filter(source => source.id !== 'router');
  assert.match(formatModelCatalogueText(merged), /- router: not read — router catalogue reads are disabled/, 'when it never became a source line, say why');
});

check('the Telegram rendering stays inside one message', () => {
  const huge = sampleMerged();
  huge.bundledAndLive = Array.from({ length: 500 }, (_, index) => ({ id: `model-${index}`, label: null, aliases: [], sources: ['router'], services: [], spec: null }));
  huge.counts.bundledAndLive = 500;
  const text = formatModelCatalogueTelegram(huge);
  assert.ok(text.length <= 3600, `expected the Telegram rendering to be budgeted, got ${text.length} characters`);
  assert.match(text, /and 460 more/, 'the models that did not fit are counted, not silently dropped');
  assert.match(text, /Cached for 1h 0m/, 'the footer survives the truncation');
});

console.log('\n--- R5: hive-models argument parsing ---');

check('no --tool means every tool', () => {
  assert.deepEqual(parseHiveModelsArgs([]).tools, MODEL_CATALOGUE_TOOLS);
});

check('--tool is repeatable and accepts a comma list', () => {
  assert.deepEqual(parseHiveModelsArgs(['--tool', 'claude', '--tool', 'codex']).tools, ['claude', 'codex']);
  assert.deepEqual(parseHiveModelsArgs(['--tool=codex,claude']).tools, ['codex', 'claude']);
  assert.deepEqual(parseHiveModelsArgs(['-t', 'codex']).tools, ['codex']);
});

check('an unknown tool or option is an error the caller can print', () => {
  assert.match(parseHiveModelsArgs(['--tool', 'gpt']).error, /Unknown tool: gpt/);
  assert.match(parseHiveModelsArgs(['--nope']).error, /Unknown option: --nope/);
  assert.equal(parseHiveModelsArgs(['--tool', 'claude']).error, null);
});

check('the flags that change what is printed are parsed', () => {
  const args = parseHiveModelsArgs(['--refresh', '--details', '--json', '--no-update', '--verbose']);
  assert.equal(args.refresh, true);
  assert.equal(args.details, true);
  assert.equal(args.json, true);
  assert.equal(args.update, false, 'R6: --no-update opts out of the version check');
  assert.equal(args.verbose, true);
  assert.equal(parseHiveModelsArgs([]).update, true, 'R6: the check is on by default');
  assert.equal(parseHiveModelsArgs(['--no-tool-update']).update, false, 'R6: the spelling /solve and /task use works here too');
});

console.log('\n--- R5: hive-models end to end, with the catalogue injected ---');

await checkAsync('the text output lists the requested tool and nothing else', async () => {
  const lines = [];
  const asked = [];
  const code = await runHiveModels(['--tool', 'claude'], {
    env: {},
    log: (...parts) => lines.push(parts.join(' ')),
    error: () => {},
    loadCatalogue: async options => {
      asked.push(options.tool);
      return sampleMerged();
    },
    freshness: async () => ({ status: 'throttled', updated: [], upToDate: [], failed: [] }),
  });
  assert.equal(code, 0);
  assert.deepEqual(asked, ['claude']);
  assert.match(lines.join('\n'), /Models for claude/);
});

await checkAsync('--json prints the merged structure so it can be piped', async () => {
  const lines = [];
  const code = await runHiveModels(['--tool', 'claude', '--json'], {
    env: {},
    log: (...parts) => lines.push(parts.join(' ')),
    error: () => {},
    loadCatalogue: async () => sampleMerged(),
    freshness: async () => ({ status: 'checked', updated: [], upToDate: [], failed: [] }),
  });
  assert.equal(code, 0);
  const parsed = JSON.parse(lines.join('\n'));
  assert.deepEqual(Object.keys(parsed.tools), ['claude']);
  assert.equal(parsed.tools.claude.liveOnly[0].id, 'claude-fable-5-2');
  assert.equal(parsed.cliUpdate.status, 'checked', 'R6: the update outcome is part of the machine-readable answer');
});

await checkAsync('--refresh is passed through to the catalogue loader', async () => {
  let seen = null;
  await runHiveModels(['--tool', 'codex', '--refresh'], { env: {}, log: () => {}, error: () => {}, loadCatalogue: async options => ((seen = options.refresh), sampleMerged()), freshness: async () => ({ status: 'disabled' }) });
  assert.equal(seen, true);
});

await checkAsync('one tool failing does not lose the tools that worked', async () => {
  const lines = [];
  const errors = [];
  const code = await runHiveModels(['--tool', 'claude', '--tool', 'codex'], {
    env: {},
    log: (...parts) => lines.push(parts.join(' ')),
    error: (...parts) => errors.push(parts.join(' ')),
    loadCatalogue: async options => {
      if (options.tool === 'codex') throw new Error('router exploded');
      return sampleMerged();
    },
    freshness: async () => ({ status: 'disabled' }),
  });
  assert.equal(code, 0, 'a partial answer is still an answer');
  assert.match(errors.join('\n'), /Could not build the codex catalogue: router exploded/);
  assert.match(lines.join('\n'), /Models for claude/);
});

await checkAsync('--help exits zero without touching the network', async () => {
  const lines = [];
  let loaded = 0;
  const code = await runHiveModels(['--help'], { env: {}, log: (...parts) => lines.push(parts.join(' ')), error: () => {}, loadCatalogue: async () => (loaded++, sampleMerged()), freshness: async () => ({ status: 'disabled' }) });
  assert.equal(code, 0);
  assert.equal(loaded, 0);
  assert.match(lines.join('\n'), /Usage: hive-models/);
});

await checkAsync('an unparseable command line exits non-zero', async () => {
  const errors = [];
  const code = await runHiveModels(['--tool', 'gpt'], { env: {}, log: () => {}, error: (...parts) => errors.push(parts.join(' ')), loadCatalogue: async () => sampleMerged(), freshness: async () => ({ status: 'disabled' }) });
  assert.equal(code, 1);
  assert.match(errors.join('\n'), /Unknown tool: gpt/);
});

console.log('\n--- R5: the Telegram /models command ---');

check('the chat argument forms all mean the same thing', () => {
  assert.deepEqual(parseModelsCommandArgs('/models').tools, ['claude'], 'a bare /models answers the default tool');
  assert.deepEqual(parseModelsCommandArgs('/models --tool codex').tools, ['codex']);
  assert.deepEqual(parseModelsCommandArgs('/models --tool=codex').tools, ['codex']);
  assert.deepEqual(parseModelsCommandArgs('/models codex').tools, ['codex'], 'a chat is not a shell');
  assert.deepEqual(parseModelsCommandArgs('/models --all').tools, MODEL_CATALOGUE_TOOLS);
  assert.equal(parseModelsCommandArgs('/models --details --refresh').details, true);
  assert.equal(parseModelsCommandArgs('/models --details --refresh').refresh, true);
  assert.equal(parseModelsCommandArgs('/models --no-update').update, false);
  assert.equal(parseModelsCommandArgs('/models --no-tool-update').update, false, 'the opt-out is spelled the same way everywhere');
  assert.match(parseModelsCommandArgs('/models --tool gpt').error, /Unknown tool: gpt/);
  assert.match(parseModelsCommandArgs('/models --wat').error, /Unknown option: --wat/);
});

const makeBot = () => {
  const commands = [];
  return { commands, command: (pattern, handler) => commands.push({ pattern, handler }) };
};

const makeCtx = (text = '/models') => ({ chat: { id: -100, type: 'supergroup' }, from: { id: 7, username: 'operator' }, message: { message_id: 42, text } });

await checkAsync('the handler answers an authorized group chat with the catalogue', async () => {
  const bot = makeBot();
  const replies = [];
  const { handleModelsCommand } = registerModelsCommand(bot, {
    isOldMessage: () => false,
    isForwardedOrReply: () => false,
    isGroupChat: () => true,
    isChatAuthorized: () => true,
    safeReply: async (ctx, text) => replies.push(text),
    loadCatalogue: async () => sampleMerged(),
    freshness: async () => ({ status: 'throttled', updated: [], upToDate: [], failed: [] }),
    env: {},
  });
  assert.equal(bot.commands.length, 1, 'the command registers itself');
  assert.equal(bot.commands[0].pattern.test('models'), true);
  await handleModelsCommand(makeCtx());
  assert.equal(replies.length, 1, 'a throttled update check says nothing; only the catalogue is sent');
  assert.match(replies[0], /Models for claude/);
  assert.match(replies[0], /Hot loaded/);
});

await checkAsync('the guard ladder matches every other command', async () => {
  const replies = [];
  const shared = { isOldMessage: () => false, isForwardedOrReply: () => false, isGroupChat: () => true, isChatAuthorized: () => true, safeReply: async (ctx, text) => replies.push(text), loadCatalogue: async () => sampleMerged(), freshness: async () => ({ status: 'disabled' }), env: {} };

  const old = registerModelsCommand(makeBot(), { ...shared, isOldMessage: () => true });
  await old.handleModelsCommand(makeCtx());
  assert.equal(replies.length, 0, 'a message from before the bot started is ignored silently');

  const forwarded = registerModelsCommand(makeBot(), { ...shared, isForwardedOrReply: () => true });
  await forwarded.handleModelsCommand(makeCtx());
  assert.equal(replies.length, 0, 'a forward is ignored silently');

  const dm = registerModelsCommand(makeBot(), { ...shared, isGroupChat: () => false });
  await dm.handleModelsCommand(makeCtx());
  assert.match(replies.at(-1), /only works in group chats/);

  const unauthorized = registerModelsCommand(makeBot(), { ...shared, isChatAuthorized: () => false });
  await unauthorized.handleModelsCommand(makeCtx());
  assert.match(replies.at(-1), /not authorized/);
});

await checkAsync('a broken catalogue is reported in chat rather than crashing the bot', async () => {
  const replies = [];
  const { handleModelsCommand } = registerModelsCommand(makeBot(), {
    isOldMessage: () => false,
    isForwardedOrReply: () => false,
    isGroupChat: () => true,
    isChatAuthorized: () => true,
    safeReply: async (ctx, text) => replies.push(text),
    loadCatalogue: async () => {
      throw new Error('no router');
    },
    freshness: async () => ({ status: 'disabled' }),
    env: {},
  });
  await handleModelsCommand(makeCtx());
  assert.match(replies.at(-1), /Could not build the claude catalogue: no router/);
});

console.log('\n--- R6: check for a newer CLI before answering or starting work ---');

check('tool names used by commands map onto updater targets', () => {
  assert.deepEqual(resolveFreshnessTools(['claude', 'codex']), ['claude', 'codex']);
  assert.deepEqual(resolveFreshnessTools('claude-code'), ['claude'], 'an alias resolves to the target it installs');
  assert.deepEqual(resolveFreshnessTools(['opencode', 'opencode']), ['opencode'], 'duplicates collapse');
  assert.deepEqual(resolveFreshnessTools(['not-a-cli']), [], 'an unknown tool narrows to nothing rather than to everything');
});

check('a caller narrowing intersects with the operator allow/deny lists, it does not override them', () => {
  assert.deepEqual(
    listAgenticCliUpdateTargets({}, { only: ['codex'] }).map(target => target.id),
    ['codex'],
    'R6: listing codex models must not reinstall Gemini'
  );
  assert.deepEqual(listAgenticCliUpdateTargets({ HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE: 'codex' }, { only: ['codex'] }), [], 'an excluded CLI stays excluded even when a command asks for it');
  assert.deepEqual(
    listAgenticCliUpdateTargets({ HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY: 'claude,codex' }, { only: ['codex', 'gemini'] }).map(target => target.id),
    ['codex'],
    'the intersection of both lists is what runs'
  );
  assert.equal(listAgenticCliUpdateTargets({}).length > 1, true, 'with no narrowing the behaviour is unchanged');
});

check('a task reference can be recognised from the URL a command was given', () => {
  assert.deepEqual(parseTaskRef('https://github.com/link-assistant/hive-mind/issues/2202'), { owner: 'link-assistant', repo: 'hive-mind', number: 2202 });
  assert.deepEqual(parseTaskRef('https://github.com/o/r/pull/9'), { owner: 'o', repo: 'r', number: 9 });
  assert.equal(parseTaskRef('not a url'), null);
  assert.deepEqual(parseTaskRef({ owner: 'o', repo: 'r', number: 3 }), { owner: 'o', repo: 'r', number: 3 });
});

await checkAsync('--no-update and the environment switch both skip the check entirely', async () => {
  let called = 0;
  const update = async () => (called++, { status: 'checked' });
  const skipped = await ensureAgenticCliFreshness({ tools: ['claude'], enabled: false, env: {}, updateImpl: update });
  assert.equal(skipped.status, 'skipped');
  const disabled = await ensureAgenticCliFreshness({ tools: ['claude'], env: { HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE: '0' }, updateImpl: update });
  assert.equal(disabled.status, 'disabled');
  assert.equal(called, 0, 'neither opt-out may reach the registry');
});

await checkAsync('the narrowed tool list reaches the updater', async () => {
  let seen = null;
  await ensureAgenticCliFreshness({ tools: ['codex'], env: {}, updateImpl: async options => ((seen = options.only), { status: 'checked' }) });
  assert.deepEqual(seen, ['codex']);
});

await checkAsync('a command does not count its own task as the busy task', async () => {
  // The idle gate scans running solve/task processes. Without this filter a
  // solve run checking for updates would find itself and defer forever.
  const active = [
    { owner: 'link-assistant', repo: 'hive-mind', number: 2202, type: 'issue' },
    { owner: 'other', repo: 'repo', number: 1, type: 'issue' },
  ];
  let observed = null;
  await ensureAgenticCliFreshness({
    tools: ['claude'],
    env: {},
    ignoreTasks: ['https://github.com/link-assistant/hive-mind/issues/2202'],
    getActiveTasksImpl: async () => active,
    updateImpl: async options => {
      observed = await options.getActiveTasksImpl({});
      return { status: 'checked' };
    },
  });
  assert.deepEqual(
    observed.map(task => task.number),
    [1],
    'only the other task counts as busy'
  );
});

await checkAsync('every active task still blocks the refresh when none of them is ours', async () => {
  let observed = null;
  await ensureAgenticCliFreshness({
    tools: ['claude'],
    env: {},
    ignoreTasks: ['https://github.com/link-assistant/hive-mind/issues/2202'],
    getActiveTasksImpl: async () => [{ owner: 'other', repo: 'repo', number: 1 }],
    updateImpl: async options => {
      observed = await options.getActiveTasksImpl({});
      return { status: 'busy' };
    },
  });
  assert.equal(observed.length, 1, 'a CLI is never swapped out from under someone else’s running task');
});

await checkAsync('a refresh that throws is reported, not propagated', async () => {
  const result = await ensureAgenticCliFreshness({
    tools: ['claude'],
    env: {},
    updateImpl: async () => {
      throw new Error('npm is down');
    },
  });
  assert.equal(result.status, 'error');
  assert.match(result.reason, /npm is down/);
  assert.deepEqual(result.updated, [], 'the caller can read the result without guarding every field');
});

check('the freshness summary only speaks when it has something to say', () => {
  assert.equal(describeFreshnessResult({ status: 'throttled', updated: [], failed: [] }), null);
  assert.equal(describeFreshnessResult({ status: 'checked', updated: [], upToDate: [{ id: 'claude' }], failed: [] }), null, 'nothing changed, so say nothing');
  assert.match(describeFreshnessResult({ status: 'checked', updated: [{ id: 'codex', from: '1.0.0', to: '1.1.0' }], failed: [] }), /Updated codex 1\.0\.0 → 1\.1\.0/);
  assert.match(describeFreshnessResult({ status: 'checked', updated: [], failed: [{ id: 'codex' }] }), /Could not update codex/);
  assert.match(describeFreshnessResult({ status: 'busy', updated: [], failed: [] }), /other tasks are running/);
});

console.log('\n--- R6: the commands that drive a CLI are wired to the check ---');

check('/solve, /hive and /task expose the same opt-out', () => {
  const definition = SOLVE_OPTION_DEFINITIONS['tool-update'];
  assert.ok(definition, 'R6: solve must declare --tool-update, or yargs strict mode rejects it');
  assert.equal(definition.type, 'boolean');
  assert.equal(definition.default, true, 'the check is on by default; --no-tool-update opts out');
  assert.equal(getSolvePassthroughOptionNames().includes('tool-update'), true, 'hive forwards it to every solve child it starts');
  assert.equal(parseTaskArguments(['node', 'task.mjs', 'a task']).toolUpdate, true);
  assert.equal(parseTaskArguments(['node', 'task.mjs', 'a task', '--no-tool-update']).toolUpdate, false);
});

check('the run excludes its own task from the idle gate', () => {
  // A regression here is silent: the check would still run, find the calling
  // solve in the process list, and defer every single time.
  const solve = fs.readFileSync(new URL('../src/solve.mjs', import.meta.url), 'utf8');
  assert.match(solve, /await ensureAgenticCliFreshness\(.*ignoreTasks: \[issueUrl\]/, 'solve must not count itself as a busy task');
  assert.match(solve, /!prepareOnly && argv\.toolUpdate !== false/, 'a dry run must not install anything');
  const task = fs.readFileSync(new URL('../src/task.mjs', import.meta.url), 'utf8');
  assert.match(task, /ensureAgenticCliFreshness\(/, 'task drives a CLI too');
  assert.match(task, /!argv\.dryRun && argv\.toolUpdate !== false/, 'a task dry run drives no CLI, so it installs nothing either');
});

check('/fix reaches the check through the solve child it starts', () => {
  const passthrough = partitionFixArgs(['https://github.com/o/r', '--ci-cd', '--tool', 'codex', '--no-tool-update']).passthrough;
  assert.deepEqual(passthrough, ['--tool', 'codex', '--no-tool-update'], 'fix forwards the opt-out rather than swallowing it');
  assert.match(buildSolveArgs({ issueUrl: 'https://github.com/o/r/issues/1', passthrough }).join(' '), /--no-tool-update/);
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
