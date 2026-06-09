#!/usr/bin/env node
// Test the experimental --use-handoff HANDOFF.md continuity *Agent Skill*
// (issue #1877). Verifies that a real SKILL.md (Agent Skills open standard) is
// built and deployed natively for both Claude (.claude/skills/handoff) and
// Codex (.agents/skills/handoff), that the system-prompt activation nudge is
// gated by --use-handoff for both tools, and that the option is registered for
// solve + hive.

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

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

const testName = 'HANDOFF.md Continuity Agent Skill (--use-handoff) Test';
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
  // 1. Canonical SKILL.md builder (the Agent Skills standard file)
  log('\n1️⃣  Testing handoff.prompts.lib.mjs SKILL.md builder...', 'yellow');
  const handoffLib = await import('../src/handoff.prompts.lib.mjs');
  const { getHandoffSubPrompt, buildHandoffSubPrompt, buildHandoffSkillFile, buildHandoffSkillBody, HANDOFF_FILE_NAME, HANDOFF_SKILL_NAME, HANDOFF_SKILL_DESCRIPTION } = handoffLib;

  assert(HANDOFF_FILE_NAME === 'HANDOFF.md', 'HANDOFF_FILE_NAME is "HANDOFF.md"');
  assert(HANDOFF_SKILL_NAME === 'handoff', 'HANDOFF_SKILL_NAME is "handoff"');

  const skillFile = buildHandoffSkillFile();
  // Valid Agent Skills frontmatter: opens with ---, has name + description.
  assert(skillFile.startsWith('---\n'), 'SKILL.md starts with YAML frontmatter');
  assert(/^---\nname: handoff\ndescription: .+\n---\n/.test(skillFile), 'SKILL.md frontmatter has name and description');
  assert(skillFile.includes(HANDOFF_SKILL_DESCRIPTION), 'SKILL.md frontmatter uses the canonical description');
  assert(skillFile.includes(MARKER), 'SKILL.md body contains the continuity-skill heading');

  // Core sections / properties the skill must teach (now live in SKILL.md body)
  for (const fragment of ['read HANDOFF.md first', 'Next steps', 'Decisions', 'Critical files', 'Gotchas', 'Never include secrets', 'tool-agnostic', 'one active HANDOFF.md per pull request branch']) {
    assert(skillFile.includes(fragment), `SKILL.md mentions "${fragment}"`);
  }
  assert(buildHandoffSkillBody({ fileName: 'CUSTOM.md' }).includes('CUSTOM.md'), 'buildHandoffSkillBody honors a custom file name');

  // 2. Minimal activation nudge (system prompt), gated by --use-handoff
  log('\n2️⃣  Testing the activation nudge gating...', 'yellow');
  assert(getHandoffSubPrompt({ useHandoff: false }) === '', 'getHandoffSubPrompt returns empty string when disabled');
  assert(getHandoffSubPrompt(undefined) === '', 'getHandoffSubPrompt returns empty string when argv is undefined');
  const nudge = getHandoffSubPrompt({ useHandoff: true });
  assert(nudge.includes(MARKER), 'getHandoffSubPrompt returns the nudge when enabled');
  assert(nudge.includes('.claude/skills/handoff') && nudge.includes('.agents/skills/handoff'), 'nudge points to both native skill directories');
  // The nudge is a pointer, not the full procedure — keep it short.
  assert(nudge.length < buildHandoffSkillFile().length, 'nudge is shorter than the full SKILL.md (procedure lives in the skill)');

  // 3. Claude system prompt gating
  log('\n3️⃣  Testing Claude system prompt gating...', 'yellow');
  const { buildSystemPrompt: buildClaude } = await import('../src/claude.prompts.lib.mjs');
  const claudeBase = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 2, branchName: 'b', argv: {} };
  assert(!buildClaude(claudeBase).includes(MARKER), 'Claude prompt omits handoff nudge by default');
  assert(buildClaude({ ...claudeBase, argv: { useHandoff: true } }).includes(MARKER), 'Claude prompt includes handoff nudge when --use-handoff is set');

  // 4. Codex system prompt gating
  log('\n4️⃣  Testing Codex system prompt gating...', 'yellow');
  const { buildSystemPrompt: buildCodex } = await import('../src/codex.prompts.lib.mjs');
  const codexBase = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 2, branchName: 'b', argv: {} };
  assert(!buildCodex(codexBase).includes(MARKER), 'Codex prompt omits handoff nudge by default');
  assert(buildCodex({ ...codexBase, argv: { useHandoff: true } }).includes(MARKER), 'Codex prompt includes handoff nudge when --use-handoff is set');

  // 5. Claude and Codex use the EXACT same nudge AND the same skill file
  log('\n5️⃣  Testing both tools share identical skill text...', 'yellow');
  const claudeOn = buildClaude({ ...claudeBase, argv: { useHandoff: true } });
  const codexOn = buildCodex({ ...codexBase, argv: { useHandoff: true } });
  assert(claudeOn.includes(buildHandoffSubPrompt()), 'Claude prompt embeds the canonical nudge verbatim');
  assert(codexOn.includes(buildHandoffSubPrompt()), 'Codex prompt embeds the canonical nudge verbatim');

  // 6. Deployment module writes the SKILL.md into both native skill directories
  log('\n6️⃣  Testing handoff-skill.lib.mjs deployment...', 'yellow');
  const { deployHandoffSkill, HANDOFF_SKILL_DIRS } = await import('../src/handoff-skill.lib.mjs');
  assert(HANDOFF_SKILL_DIRS.length === 2, 'two native skill directories are targeted (Claude + Codex)');

  const repoDir = mkdtempSync(join(tmpdir(), 'handoff-skill-'));
  try {
    execSync('git init -q', { cwd: repoDir });

    // Disabled: no deployment, nothing written.
    const off = await deployHandoffSkill({ tempDir: repoDir, argv: { useHandoff: false } });
    assert(off.deployed === false && off.paths.length === 0, 'deployHandoffSkill is a no-op when --use-handoff is off');
    assert(!existsSync(join(repoDir, '.claude')) && !existsSync(join(repoDir, '.agents')), 'no skill dirs created when disabled');

    // Enabled: SKILL.md deployed for both tools and git-excluded.
    const on = await deployHandoffSkill({ tempDir: repoDir, argv: { useHandoff: true } });
    assert(on.deployed === true && on.paths.length === 2, 'deployHandoffSkill writes both SKILL.md files when enabled');
    const claudeSkill = join(repoDir, '.claude', 'skills', 'handoff', 'SKILL.md');
    const codexSkill = join(repoDir, '.agents', 'skills', 'handoff', 'SKILL.md');
    assert(existsSync(claudeSkill), '.claude/skills/handoff/SKILL.md exists');
    assert(existsSync(codexSkill), '.agents/skills/handoff/SKILL.md exists');
    assert(readFileSync(claudeSkill, 'utf8') === readFileSync(codexSkill, 'utf8'), 'both deployed SKILL.md files are byte-identical');
    assert(readFileSync(claudeSkill, 'utf8') === buildHandoffSkillFile(), 'deployed SKILL.md matches the canonical builder output');

    const exclude = readFileSync(join(repoDir, '.git', 'info', 'exclude'), 'utf8');
    assert(exclude.includes('/.claude/skills/handoff/') && exclude.includes('/.agents/skills/handoff/'), 'git exclude lists both skill dirs');

    // git must not see the deployed skill files (kept out of the PR).
    const status = execSync('git status --porcelain', { cwd: repoDir }).toString();
    assert(!status.includes('.claude/skills') && !status.includes('.agents/skills'), 'deployed skill files are invisible to git status');

    // Idempotent: re-running does not duplicate exclude entries.
    await deployHandoffSkill({ tempDir: repoDir, argv: { useHandoff: true } });
    const exclude2 = readFileSync(join(repoDir, '.git', 'info', 'exclude'), 'utf8');
    const occurrences = exclude2.split('/.claude/skills/handoff/').length - 1;
    assert(occurrences === 1, 'git exclude entry is not duplicated on re-deploy');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }

  // 7. Option registration in solve.config.lib.mjs
  log('\n7️⃣  Testing solve.config.lib.mjs registration...', 'yellow');
  const solveConfig = readFileSync(join(__dirname, '../src/solve.config.lib.mjs'), 'utf-8');
  assert(solveConfig.includes("'use-handoff'"), 'solve.config.lib.mjs defines --use-handoff option');
  assert(/'use-handoff':\s*\{[\s\S]*?default:\s*false/.test(solveConfig), 'solve.config.lib.mjs sets --use-handoff default to false');
  assert(solveConfig.includes('[EXPERIMENTAL]') && solveConfig.includes('HANDOFF.md continuity'), 'solve.config.lib.mjs marks --use-handoff as EXPERIMENTAL');
  assert(solveConfig.includes('Agent Skills') || solveConfig.includes('SKILL.md'), 'solve.config.lib.mjs describes the native Agent Skill');

  // 8. Option-suggestions registration (so typos suggest it)
  log('\n8️⃣  Testing option-suggestions.lib.mjs registration...', 'yellow');
  const optionSuggestions = readFileSync(join(__dirname, '../src/option-suggestions.lib.mjs'), 'utf-8');
  assert(optionSuggestions.includes("'use-handoff'"), 'option-suggestions.lib.mjs lists use-handoff');

  // 9. Hive auto-forwards the option (SOLVE_OPTION_DEFINITIONS passthrough)
  log('\n9️⃣  Testing hive forwards --use-handoff to solve...', 'yellow');
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
