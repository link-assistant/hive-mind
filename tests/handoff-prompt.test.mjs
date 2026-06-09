#!/usr/bin/env node
// Test that --use-handoff correctly gates the HANDOFF.md continuity skill
// in both the Claude and Codex system prompts, and that the option is
// registered for solve + hive (issue #1877).

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = (message, color = 'reset') => {
  console.log(`${colors[color]}${message}${colors.reset}`);
};

const testName = 'HANDOFF.md Continuity Skill (--use-handoff) Test';
log(`\n📋 Running: ${testName}`, 'blue');
log('─'.repeat(60), 'blue');

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (condition) {
    log(`✅ ${message}`, 'green');
    passed++;
  } else {
    log(`❌ ${message}`, 'red');
    failed++;
  }
};

const MARKER = 'HANDOFF.md continuity skill';

try {
  // 1. Standalone module behavior
  log('\n1️⃣  Testing handoff.prompts.lib.mjs module...', 'yellow');
  const handoffLib = await import('../src/handoff.prompts.lib.mjs');
  const { getHandoffSubPrompt, buildHandoffSubPrompt, HANDOFF_FILE_NAME } = handoffLib;

  assert(HANDOFF_FILE_NAME === 'HANDOFF.md', 'HANDOFF_FILE_NAME is "HANDOFF.md"');
  assert(getHandoffSubPrompt({ useHandoff: false }) === '', 'getHandoffSubPrompt returns empty string when disabled');
  assert(getHandoffSubPrompt(undefined) === '', 'getHandoffSubPrompt returns empty string when argv is undefined');

  const sub = getHandoffSubPrompt({ useHandoff: true });
  assert(sub.includes(MARKER), 'getHandoffSubPrompt returns the skill text when enabled');
  // Core sections / properties the skill must teach
  for (const fragment of ['read HANDOFF.md first', 'Next steps', 'Decisions', 'Critical files', 'Gotchas', 'never include secrets', 'tool-agnostic', 'one active HANDOFF.md per pull request branch']) {
    assert(sub.includes(fragment), `Skill text mentions "${fragment}"`);
  }
  assert(buildHandoffSubPrompt({ fileName: 'CUSTOM.md' }).includes('CUSTOM.md'), 'buildHandoffSubPrompt honors a custom file name');

  // 2. Claude system prompt gating
  log('\n2️⃣  Testing Claude system prompt gating...', 'yellow');
  const { buildSystemPrompt: buildClaude } = await import('../src/claude.prompts.lib.mjs');
  const claudeBase = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 2, branchName: 'b', argv: {} };
  assert(!buildClaude(claudeBase).includes(MARKER), 'Claude prompt omits handoff skill by default');
  assert(buildClaude({ ...claudeBase, argv: { useHandoff: true } }).includes(MARKER), 'Claude prompt includes handoff skill when --use-handoff is set');

  // 3. Codex system prompt gating
  log('\n3️⃣  Testing Codex system prompt gating...', 'yellow');
  const { buildSystemPrompt: buildCodex } = await import('../src/codex.prompts.lib.mjs');
  const codexBase = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 2, branchName: 'b', argv: {} };
  assert(!buildCodex(codexBase).includes(MARKER), 'Codex prompt omits handoff skill by default');
  assert(buildCodex({ ...codexBase, argv: { useHandoff: true } }).includes(MARKER), 'Codex prompt includes handoff skill when --use-handoff is set');

  // 4. Claude and Codex use the EXACT same skill text (same skill, same way)
  log('\n4️⃣  Testing both tools share identical skill text...', 'yellow');
  const claudeOn = buildClaude({ ...claudeBase, argv: { useHandoff: true } });
  const codexOn = buildCodex({ ...codexBase, argv: { useHandoff: true } });
  const skillText = buildHandoffSubPrompt();
  assert(claudeOn.includes(skillText), 'Claude prompt embeds the canonical skill text verbatim');
  assert(codexOn.includes(skillText), 'Codex prompt embeds the canonical skill text verbatim');

  // 5. Option registration in solve.config.lib.mjs
  log('\n5️⃣  Testing solve.config.lib.mjs registration...', 'yellow');
  const solveConfig = readFileSync(join(__dirname, '../src/solve.config.lib.mjs'), 'utf-8');
  assert(solveConfig.includes("'use-handoff'"), 'solve.config.lib.mjs defines --use-handoff option');
  assert(/'use-handoff':\s*\{[\s\S]*?default:\s*false/.test(solveConfig), 'solve.config.lib.mjs sets --use-handoff default to false');
  assert(solveConfig.includes('[EXPERIMENTAL]') && solveConfig.includes('HANDOFF.md continuity skill'), 'solve.config.lib.mjs marks --use-handoff as EXPERIMENTAL');

  // 6. Option-suggestions registration (so typos suggest it)
  log('\n6️⃣  Testing option-suggestions.lib.mjs registration...', 'yellow');
  const optionSuggestions = readFileSync(join(__dirname, '../src/option-suggestions.lib.mjs'), 'utf-8');
  assert(optionSuggestions.includes("'use-handoff'"), 'option-suggestions.lib.mjs lists use-handoff');

  // 7. Hive auto-forwards the option (SOLVE_OPTION_DEFINITIONS passthrough)
  log('\n7️⃣  Testing hive forwards --use-handoff to solve...', 'yellow');
  const { SOLVE_OPTION_DEFINITIONS } = await import('../src/solve.config.lib.mjs');
  assert(Object.prototype.hasOwnProperty.call(SOLVE_OPTION_DEFINITIONS, 'use-handoff'), 'use-handoff is in SOLVE_OPTION_DEFINITIONS (auto-forwarded by hive)');
} catch (error) {
  log(`\n❌ Test error: ${error.message}`, 'red');
  log(error.stack, 'red');
  failed++;
}

log('\n' + '─'.repeat(60), 'blue');
log(`📊 Test Summary: ${testName}`, 'blue');
log(`   ✅ Passed: ${passed}`, passed > 0 ? 'green' : 'reset');
log(`   ❌ Failed: ${failed}`, failed > 0 ? 'red' : 'reset');
log('─'.repeat(60), 'blue');

if (failed > 0) {
  log(`\n❌ ${testName} FAILED\n`, 'red');
  process.exit(1);
} else {
  log(`\n✅ ${testName} PASSED\n`, 'green');
  process.exit(0);
}
