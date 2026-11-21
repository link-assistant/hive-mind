#!/usr/bin/env node
/**
 * RuleTester tests for hive/no-slow-await-in-telegram-handler: a handler
 * registered on the bot must not await known-slow work directly.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import noSlowAwaitInTelegramHandler from '../eslint-rules/no-slow-await-in-telegram-handler.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const slowAwait = name => ({ messageId: 'slowAwait', data: { name } });
const lines = (...parts) => parts.join('\n');

ruleTester.run('no-slow-await-in-telegram-handler', noSlowAwaitInTelegramHandler, {
  valid: [
    // Fast work in a handler.
    "bot.command('help', async ctx => { await ctx.reply('help'); });",
    // Slow work handed to the background is not awaited by the handler.
    "bot.command('solve', async ctx => { runInBackground(async () => { await executeAndUpdateMessage(ctx, msg, cmd); }); await ctx.reply('Queued'); });",
    // A handler built by a wrapper is the wrapper's responsibility.
    lines('const handleSolve = detachHandler(async ctx => { await executeAndUpdateMessage(ctx); });', "bot.command('solve', handleSolve);"),
    "bot.command('solve', detachHandler(async ctx => { await preflightRepositoryTarget(ctx); }));",
    // Not a bot object.
    "emitter.on('data', async () => { await sleep(1000); });",
    // Slow work outside any handler.
    'async function startup() { await refreshTaskImage(); }',
    // A function registered nowhere is not a handler.
    'const later = async ctx => { await validateGitHubEntityExistence(ctx); };',
    // Not slow: docker is not the command.
    "bot.command('ls', async () => { await execAsync('ls docker'); });",
    // Reasoned exception.
    lines("bot.command('wait', async ctx => {", '  // hive-handler-slow-ok: an admin-only diagnostic', '  await sleep(1000);', '});'),
    // A handler resolved by name with only fast awaits.
    lines('async function handleHelp(ctx) { await ctx.reply("help"); }', 'bot.help(handleHelp);'),
  ],
  invalid: [
    {
      code: "bot.command('solve', async ctx => { await executeAndUpdateMessage(ctx, msg, cmd); });",
      errors: [slowAwait('executeAndUpdateMessage')],
    },
    // Named handlers are resolved through scope analysis.
    {
      code: lines('async function handleSolve(ctx) { await preflightRepositoryTarget(ctx); }', "bot.command('solve', handleSolve);"),
      errors: [slowAwait('preflightRepositoryTarget')],
    },
    {
      code: lines('const handleSolve = async ctx => { await autoAcceptInviteForRepo(ctx); };', "bot.command(['solve', 'do'], handleSolve);"),
      errors: [slowAwait('autoAcceptInviteForRepo')],
    },
    // The handler is checked once even when registered twice.
    {
      code: lines('const handler = async () => { await sleep(10); };', "bot.command('a', handler);", "bot.command('b', handler);"),
      errors: [slowAwait('sleep')],
    },
    // docker child processes, as exec* or as a `$` template.
    {
      code: "bot.command('codex', async () => { await execAsync('docker pull image'); });",
      errors: [slowAwait("execAsync('docker …')")],
    },
    {
      code: "bot.command('codex', async () => { await $`docker pull ${image}`; });",
      errors: [slowAwait('docker')],
    },
    // Name patterns.
    {
      code: "bot.on('message', async () => { await runImageMaintenance(); await agentUpdater(); await sessionRefresh(); });",
      errors: [slowAwait('runImageMaintenance'), slowAwait('agentUpdater'), slowAwait('sessionRefresh')],
    },
    // Member calls and other bot spellings.
    {
      code: "this.bot.action('retry', async () => { await this.sidecar.waitForFormalAiSidecarHealth(); });",
      errors: [slowAwait('waitForFormalAiSidecarHealth')],
    },
    {
      code: 'telegramBot.hears(/go/, async () => { if (ready) { await sleep(5); } });',
      errors: [slowAwait('sleep')],
    },
    // A marker without a reason does not count.
    {
      code: "bot.command('w', async () => { await sleep(1); }); // hive-handler-slow-ok:",
      errors: [slowAwait('sleep')],
    },
    // Extra slow names from the options.
    {
      code: "bot.command('deploy', async () => { await deployEverything(); });",
      options: [{ slowCalls: ['deployEverything'] }],
      errors: [slowAwait('deployEverything')],
    },
  ],
});
