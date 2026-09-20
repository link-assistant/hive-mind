#!/usr/bin/env node

/**
 * Experiment: Test lenv parsing for issue #1086
 *
 * This experiment simulates exactly how the telegram-bot.mjs processes
 * the configuration from the issue.
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Import the same modules as telegram-bot.mjs
const { lino } = await import('../src/lino.lib.mjs');
const { loadLenvConfig, lenvReader } = await import('../src/lenv-reader.lib.mjs');

console.log('=== Issue #1086 - lenv Parsing Test ===\n');

// The exact configuration from the issue (note the line with ? and multiple spaces)
const issueConfiguration = `
TELEGRAM_BOT_TOKEN: '849...55:AA...gk_YZ...PU'
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
  --auto-resume-on-limit-reset?  --tokens-budget-stats
TELEGRAM_SOLVE_OVERRIDES:
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
TELEGRAM_BOT_VERBOSE: true
`;

console.log('Input configuration (exactly as in the issue):');
console.log(issueConfiguration);
console.log('\n---\n');

// Parse using lenvReader (just like telegram-bot.mjs does)
const parsed = lenvReader.parse(issueConfiguration);

console.log('Parsed environment variables:');
console.log(JSON.stringify(parsed, null, 2));
console.log('\n---\n');

// Now let's see what happens when we parse TELEGRAM_HIVE_OVERRIDES with lino
console.log('TELEGRAM_HIVE_OVERRIDES value:');
console.log(JSON.stringify(parsed.TELEGRAM_HIVE_OVERRIDES));
console.log('\n');

if (parsed.TELEGRAM_HIVE_OVERRIDES) {
  const hiveOverrides = lino
    .parseStringValues(parsed.TELEGRAM_HIVE_OVERRIDES)
    .map(line => line.trim())
    .filter(line => line);

  console.log('Hive overrides (parsed with lino.parseStringValues):');
  console.log(hiveOverrides);
  console.log('Count:', hiveOverrides.length);
}

console.log('\n---\n');

// Compare with TELEGRAM_SOLVE_OVERRIDES
console.log('TELEGRAM_SOLVE_OVERRIDES value:');
console.log(JSON.stringify(parsed.TELEGRAM_SOLVE_OVERRIDES));
console.log('\n');

if (parsed.TELEGRAM_SOLVE_OVERRIDES) {
  const solveOverrides = lino
    .parseStringValues(parsed.TELEGRAM_SOLVE_OVERRIDES)
    .map(line => line.trim())
    .filter(line => line);

  console.log('Solve overrides (parsed with lino.parseStringValues):');
  console.log(solveOverrides);
  console.log('Count:', solveOverrides.length);
}

console.log('\n=== Now testing with CORRECT configuration ===\n');

// The configuration as it SHOULD be (without the typo on line 7)
const correctConfiguration = `
TELEGRAM_BOT_TOKEN: '849...55:AA...gk_YZ...PU'
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
  --auto-resume-on-limit-reset
  --tokens-budget-stats
TELEGRAM_SOLVE_OVERRIDES:
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
TELEGRAM_BOT_VERBOSE: true
`;

const parsedCorrect = lenvReader.parse(correctConfiguration);

console.log('CORRECT TELEGRAM_HIVE_OVERRIDES value:');
console.log(JSON.stringify(parsedCorrect.TELEGRAM_HIVE_OVERRIDES));
console.log('\n');

if (parsedCorrect.TELEGRAM_HIVE_OVERRIDES) {
  const hiveOverridesCorrect = lino
    .parseStringValues(parsedCorrect.TELEGRAM_HIVE_OVERRIDES)
    .map(line => line.trim())
    .filter(line => line);

  console.log('Hive overrides (from CORRECT config):');
  console.log(hiveOverridesCorrect);
  console.log('Count:', hiveOverridesCorrect.length);
}

console.log('\n=== Analysis ===\n');
console.log('The issue in the original configuration appears to be on line 7 of TELEGRAM_HIVE_OVERRIDES:');
console.log('  "--auto-resume-on-limit-reset?  --tokens-budget-stats"');
console.log('');
console.log('Note the "?" after --auto-resume-on-limit-reset and two options on the same line.');
console.log('This could be a user typo or a rendering issue in the issue description.');
