#!/usr/bin/env node

/**
 * Regression test for issue #1658.
 * Verifies --configuration can provide Telegram overrides that contain
 * parenthesized LINO option/value links such as (--isolation screen).
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const configuration = `
TELEGRAM_BOT_TOKEN: 'test-token-issue-1658'
TELEGRAM_ALLOWED_CHATS:
  -1002975819706
  -1002861722681
TELEGRAM_HIVE_OVERRIDES:
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-accept-invite
  --tokens-budget-stats
  --auto-attach-solution-summary
  (--isolation screen)
TELEGRAM_SOLVE_OVERRIDES:
  --attach-logs
  --verbose
  --no-tool-check
  --auto-accept-invite
  --tokens-budget-stats
  --auto-attach-solution-summary
  (--isolation screen)
TELEGRAM_BOT_VERBOSE: true
`;

const telegramEnvKeys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHATS', 'TELEGRAM_ALLOWED_TOPICS', 'TELEGRAM_HIVE_OVERRIDES', 'TELEGRAM_SOLVE_OVERRIDES', 'TELEGRAM_BOT_VERBOSE', 'TELEGRAM_CONFIGURATION', 'TELEGRAM_ISOLATION'];

const env = { ...process.env };
for (const key of telegramEnvKeys) {
  delete env[key];
}

const proc = spawn(process.execPath, [join(projectRoot, 'src/telegram-bot.mjs'), '--configuration', configuration, '--dry-run'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';

proc.stdout.on('data', chunk => {
  stdout += chunk.toString();
});

proc.stderr.on('data', chunk => {
  stderr += chunk.toString();
});

proc.on('close', code => {
  const output = stdout + stderr;
  const expectations = [
    ['exits successfully', code === 0],
    ['loads token from --configuration', output.includes('Token: test-token...')],
    ['validates solve overrides', output.includes('✅ Solve overrides validated successfully')],
    ['validates hive overrides', output.includes('✅ Hive overrides validated successfully')],
    ['keeps isolation flag in summary', output.includes('--isolation')],
    ['keeps isolation value in summary', output.includes('screen')],
    ['does not report missing token', !output.includes('TELEGRAM_BOT_TOKEN not set')],
  ];

  let failed = 0;
  for (const [name, passed] of expectations) {
    console.log(`${passed ? '✅' : '❌'} ${name}`);
    if (!passed) failed++;
  }

  if (failed > 0) {
    console.error('\n--- Output ---');
    console.error(output);
    process.exit(1);
  }

  console.log('\n✅ Issue #1658 Telegram configuration regression passed');
});

proc.on('error', error => {
  console.error(`❌ Failed to spawn telegram bot dry-run: ${error.message}`);
  process.exit(1);
});
