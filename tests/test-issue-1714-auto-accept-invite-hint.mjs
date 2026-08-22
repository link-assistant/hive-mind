#!/usr/bin/env node

/**
 * Regression test for issue #1714.
 *
 * After issue #1694 flipped --auto-accept-invite to default-on, the Telegram
 * /solve handler must read the *parsed* argv (not the raw args) when deciding
 * whether to suppress the "try using --auto-accept-invite" hint in
 * validateGitHubEntityExistence(). Reading raw args broke suppression on the
 * default-on path because the literal --auto-accept-invite string is no longer
 * present in the typical invocation.
 *
 * This test:
 *   1. Confirms parseArgsWithYargs() returns autoAcceptInvite=true by default
 *      and false on --no-auto-accept-invite (so the parsed-argv source is the
 *      correct single source of truth).
 *   2. Confirms the buggy `args.some(a => a === '--auto-accept-invite')` form
 *      returns false on the default-on path — i.e. it would *incorrectly*
 *      cause the hint to be shown. We assert this to lock in the regression
 *      that the production bug must NOT use this form.
 *   3. Confirms a fake stand-in for the entity check, called with the parsed
 *      autoAcceptInvite flag, suppresses the invite hint exactly when it
 *      should: omitted on the default path, omitted on explicit
 *      --auto-accept-invite, and only present on --no-auto-accept-invite.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1714
 * @see https://github.com/link-assistant/hive-mind/issues/1694
 * @see https://github.com/link-assistant/hive-mind/issues/1692
 */

import { createYargsConfig as createSolveYargsConfig } from '../src/solve.config.lib.mjs';
import { resolveYargsFactory } from '../src/yargs-factory.lib.mjs';
import { parseArgsWithYargs } from '../src/telegram-solve-command.lib.mjs';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const yargsModule = await use('yargs@17.7.2');
const yargs = resolveYargsFactory(yargsModule);

let passed = 0;
let failed = 0;

function pass(name) {
  console.log(`✅ ${name}`);
  passed++;
}

function fail(name, expected, actual) {
  console.log(`❌ ${name}`);
  console.log(`   expected: ${expected}`);
  console.log(`   actual:   ${actual}`);
  failed++;
}

function assertEqual(name, actual, expected) {
  if (actual === expected) pass(name);
  else fail(name, JSON.stringify(expected), JSON.stringify(actual));
}

console.log('\n================================================================================');
console.log('Issue #1714: --auto-accept-invite hint suppression after default flip');
console.log('================================================================================\n');

// Standin for the repo-404 branch of validateGitHubEntityExistence, mirroring
// src/github-entity-validation.lib.mjs. Only the bullet-list logic matters here.
function buildRepoNotAccessibleMessage({ owner, repo, autoAcceptInvite }) {
  const bullets = ['• Repository may be private — ensure the bot has been granted access', '• The repository name is spelled correctly', '• The repository has not been deleted, transferred, or never existed'];
  if (!autoAcceptInvite) {
    bullets.push('• If Hive Mind bot was recently invited, try using --auto-accept-invite to accept pending invitations');
  }
  return `Repository '${owner}/${repo}' is not accessible.\n\n💡 Please check:\n${bullets.join('\n')}`;
}

const URL = 'https://github.com/xlabtg/anti-corruption/pull/4';

// 1) parseArgsWithYargs reflects the default-on state.
console.log('📋 parsed argv autoAcceptInvite default\n');
{
  const argvDefault = await parseArgsWithYargs([URL], yargs, createSolveYargsConfig);
  assertEqual('default invocation -> parsed argv.autoAcceptInvite === true', argvDefault.autoAcceptInvite, true);

  const argvExplicit = await parseArgsWithYargs([URL, '--auto-accept-invite'], yargs, createSolveYargsConfig);
  assertEqual('--auto-accept-invite -> parsed argv.autoAcceptInvite === true', argvExplicit.autoAcceptInvite, true);

  const argvOptOut = await parseArgsWithYargs([URL, '--no-auto-accept-invite'], yargs, createSolveYargsConfig);
  assertEqual('--no-auto-accept-invite -> parsed argv.autoAcceptInvite === false', argvOptOut.autoAcceptInvite, false);
}

// 2) The buggy raw-args form returns false on the default-on path. This locks
// in the regression that the production code must NOT use this form.
console.log('\n📋 raw args form is broken on the default-on path (regression lock-in)\n');
{
  const args = [URL]; // typical default invocation, no explicit flag
  const buggy = args.some(a => a === '--auto-accept-invite');
  assertEqual('args.some(a => a === "--auto-accept-invite") on default invocation === false', buggy, false);
}

// 3) End-to-end (no network): the hint is suppressed exactly when the parsed
// flag is on. Mirrors what telegram-bot.mjs:970 must do after the fix.
console.log('\n📋 hint suppression behaviour driven by parsed argv\n');
{
  const cases = [
    {
      name: 'default invocation (no flag) suppresses --auto-accept-invite hint',
      args: [URL],
      hintMustBePresent: false,
    },
    {
      name: 'explicit --auto-accept-invite suppresses --auto-accept-invite hint',
      args: [URL, '--auto-accept-invite'],
      hintMustBePresent: false,
    },
    {
      name: '--no-auto-accept-invite shows --auto-accept-invite hint',
      args: [URL, '--no-auto-accept-invite'],
      hintMustBePresent: true,
    },
  ];

  for (const c of cases) {
    const parsed = await parseArgsWithYargs(c.args, yargs, createSolveYargsConfig);
    const message = buildRepoNotAccessibleMessage({
      owner: 'xlabtg',
      repo: 'anti-corruption',
      autoAcceptInvite: !!parsed?.autoAcceptInvite,
    });
    const hasHint = message.includes('--auto-accept-invite');
    if (hasHint === c.hintMustBePresent) {
      pass(c.name);
    } else {
      fail(c.name, `hintPresent=${c.hintMustBePresent}`, `hintPresent=${hasHint}\n   message:\n${message}`);
    }
  }
}

// 4) Static check: the production handler must read parsed argv, not raw args,
// for this specific call. Reading the file directly catches the regression at
// its source so a future refactor cannot silently revert the fix.
console.log('\n📋 source-level guard for src/telegram-bot.mjs\n');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'telegram-bot.mjs'), 'utf8');

  const lines = source.split('\n');
  const callLineIdx = lines.findIndex(l => l.includes('validateGitHubEntityExistence({') && l.includes('autoAcceptInvite'));
  if (callLineIdx === -1) {
    fail('locate validateGitHubEntityExistence call in telegram-bot.mjs', 'one match', 'none');
  } else {
    const callLine = lines[callLineIdx];
    if (callLine.includes("args.some(a => a === '--auto-accept-invite')")) {
      fail('telegram-bot.mjs validateGitHubEntityExistence call must NOT use raw args.some(...) for autoAcceptInvite (issue #1714)', 'parsed argv (e.g. parsedSolveArgs?.autoAcceptInvite)', callLine.trim());
    } else if (/autoAcceptInvite:\s*!!\s*parsedSolveArgs\?\.autoAcceptInvite/.test(callLine) || /autoAcceptInvite:\s*parsedSolveArgs\?\.autoAcceptInvite/.test(callLine)) {
      pass('telegram-bot.mjs validateGitHubEntityExistence call uses parsedSolveArgs.autoAcceptInvite');
    } else {
      fail('telegram-bot.mjs validateGitHubEntityExistence call uses parsed argv for autoAcceptInvite', 'parsedSolveArgs?.autoAcceptInvite', callLine.trim());
    }
  }
}

console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================\n');

process.exit(failed === 0 ? 0 : 1);
