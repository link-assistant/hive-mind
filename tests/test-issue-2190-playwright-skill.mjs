#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2190: Playwright is the only capability a task gets beyond the
 * minimal configuration, and it comes in three shapes:
 *
 *   default                                → Playwright MCP only
 *   --playwright-skill                     → MCP + playwright-cli skill
 *   --no-playwright-mcp --playwright-skill → skill only
 *
 * The skill is deployed into the task workspace (never into the global
 * ~/.claude / ~/.codex / ~/.agents folders), shared between both tools through
 * a symlink, and git-excluded so it never reaches the pull request.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { deployPlaywrightSkill, parsePlaywrightSkillPathFromHelp, playwrightSkillDirsUnderNpmRoot, PLAYWRIGHT_SKILL_DIRS, PLAYWRIGHT_SKILL_LINKED_DIRS, PLAYWRIGHT_SKILL_PRIMARY_DIR, resolvePlaywrightMode, resolvePlaywrightSkillSource } from '../src/playwright-skill.lib.mjs';

let passed = 0;
let failed = 0;
function pass(label) {
  console.log(`  PASS: ${label}`);
  passed++;
}
function fail(label, expected, actual) {
  console.log(`  FAIL: ${label}`);
  console.log(`    expected: ${JSON.stringify(expected)}`);
  console.log(`    actual:   ${JSON.stringify(actual)}`);
  failed++;
}
function assertEqual(actual, expected, label) {
  if (actual === expected) pass(label);
  else fail(label, expected, actual);
}
function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(label, expected, actual);
}

console.log('\n--- Mode resolution ---');
assertDeepEqual(resolvePlaywrightMode({}), { mcp: true, skill: false, mode: 'mcp' }, 'default: Playwright MCP only, no skill');
assertDeepEqual(resolvePlaywrightMode({ playwrightSkill: true }), { mcp: true, skill: true, mode: 'mcp+skill' }, '--playwright-skill: MCP + skill');
assertDeepEqual(resolvePlaywrightMode({ playwrightMcp: false, playwrightSkill: true }), { mcp: false, skill: true, mode: 'skill' }, '--no-playwright-mcp --playwright-skill: skill only');
assertDeepEqual(resolvePlaywrightMode({ playwrightMcp: false }), { mcp: false, skill: false, mode: 'none' }, '--no-playwright-mcp alone: nothing');

console.log('\n--- Skill location parsing ---');
assertEqual(parsePlaywrightSkillPathFromHelp('playwright-cli - run ...\n\nAgent skill: ../home/box/.npm/_npx/abc/node_modules/playwright-core/lib/tools/skills/playwright-cli/SKILL.md\n\nUsage: ...', '/tmp'), '/home/box/.npm/_npx/abc/node_modules/playwright-core/lib/tools/skills/playwright-cli', 'the relative path printed by --help is resolved against the cwd the CLI ran in');
assertEqual(parsePlaywrightSkillPathFromHelp('Agent skill: /opt/skills/playwright-cli/SKILL.md'), '/opt/skills/playwright-cli', 'an absolute path is kept as is');
assertEqual(parsePlaywrightSkillPathFromHelp('no skill line here'), null, 'no line → null');

console.log('\n--- Locating the skill without relying on the agent-only help hint ---');
// playwright-core prints `Agent skill:` only when CLAUDECODE or COPILOT_CLI is
// set; a plain `playwright-cli --help` in a Docker build has no such line.
const fakeRunner = handlers => {
  const commands = [];
  const tag = (strings, ...values) => {
    const command = strings.reduce((acc, part, i) => acc + part + (values[i] ?? ''), '');
    commands.push(command);
    return Promise.resolve(handlers(command) || { stdout: '', code: 0 });
  };
  return { $: () => tag, commands };
};
{
  const npmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2190-npmroot-'));
  const [packageSkillDir] = playwrightSkillDirsUnderNpmRoot(npmRoot);
  fs.mkdirSync(packageSkillDir, { recursive: true });
  fs.writeFileSync(path.join(packageSkillDir, 'SKILL.md'), '# skill\n');
  const runner = fakeRunner(command => (command.startsWith('npm root -g') ? { stdout: `${npmRoot}\n`, code: 0 } : { stdout: 'playwright-cli - run playwright mcp commands from terminal\n', code: 0 }));
  const found = await resolvePlaywrightSkillSource({ $: runner.$, force: true });
  assertEqual(found, packageSkillDir, 'the package under the global npm root is found by path, no help hint needed');
  assertEqual(runner.commands.length, 1, 'and no CLI is invoked once the path check succeeds');
  fs.rmSync(npmRoot, { recursive: true, force: true });
}
{
  const hintRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2190-hint-'));
  const hintDir = path.join(hintRoot, 'playwright-cli');
  fs.mkdirSync(hintDir, { recursive: true });
  fs.writeFileSync(path.join(hintDir, 'SKILL.md'), '# skill\n');
  const runner = fakeRunner(command => {
    if (command.startsWith('npm root -g')) return { stdout: `${path.join(hintRoot, 'empty')}\n`, code: 0 };
    if (command.includes('playwright-cli --help')) return { stdout: `playwright-cli\n\nAgent skill: ${path.join(hintDir, 'SKILL.md')}\n`, code: 0 };
    return { stdout: '', code: 0 };
  });
  const found = await resolvePlaywrightSkillSource({ $: runner.$, force: true });
  assertEqual(found, hintDir, 'when the package is elsewhere, the help hint is used as a fallback');
  assertEqual(
    runner.commands.some(command => command.startsWith('CLAUDECODE=1 playwright-cli --help')),
    true,
    'and the hint is requested with CLAUDECODE=1, the only way playwright-core prints it'
  );
  fs.rmSync(hintRoot, { recursive: true, force: true });
}
{
  const runner = fakeRunner(() => ({ stdout: 'nothing useful\n', code: 0 }));
  assertEqual(await resolvePlaywrightSkillSource({ $: runner.$, force: true }), null, 'with no package and no hint, null is returned instead of a guess');
  assertEqual(runner.commands.length, 3, 'all three probes (npm root, playwright-cli, npx) were tried');
}

console.log('\n--- Deployment into the workspace ---');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2190-pw-'));
const source = path.join(root, 'source', 'playwright-cli');
fs.mkdirSync(path.join(source, 'references'), { recursive: true });
fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: playwright-cli\n---\n# Browser Automation with playwright-cli\n');
fs.writeFileSync(path.join(source, 'references', 'tracing.md'), '# tracing\n');
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
execSync('git init -q .', { cwd: repo });
fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
execSync('git add . && git -c user.name=t -c user.email=t@t commit -q -m init', { cwd: repo });
const logs = [];
const log = async message => {
  logs.push(String(message));
};

try {
  const off = await deployPlaywrightSkill({ tempDir: repo, argv: {}, log, sourceDir: source });
  assertDeepEqual(off, { deployed: false, reason: 'disabled', mode: 'mcp', paths: [], shared: false, source: null }, 'default (MCP only) deploys nothing');
  assertEqual(fs.existsSync(path.join(repo, '.claude')), false, 'no .claude folder is created in MCP-only mode');

  const on = await deployPlaywrightSkill({ tempDir: repo, argv: { playwrightSkill: true }, log, sourceDir: source });
  assertEqual(on.deployed, true, '--playwright-skill deploys the skill');
  assertEqual(on.mode, 'mcp+skill', 'the mode is reported');
  assertDeepEqual(on.paths, [PLAYWRIGHT_SKILL_PRIMARY_DIR, ...PLAYWRIGHT_SKILL_LINKED_DIRS], 'both tool locations are written');
  assertEqual(fs.readFileSync(path.join(repo, PLAYWRIGHT_SKILL_PRIMARY_DIR, 'SKILL.md'), 'utf8').includes('playwright-cli'), true, 'SKILL.md is copied for Claude Code');
  assertEqual(fs.existsSync(path.join(repo, PLAYWRIGHT_SKILL_PRIMARY_DIR, 'references', 'tracing.md')), true, 'reference files are copied too');
  const codexDir = path.join(repo, PLAYWRIGHT_SKILL_LINKED_DIRS[0]);
  assertEqual(fs.lstatSync(codexDir).isSymbolicLink(), true, 'the Codex location is a symlink to the same directory');
  assertEqual(fs.readFileSync(path.join(codexDir, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(repo, PLAYWRIGHT_SKILL_PRIMARY_DIR, 'SKILL.md'), 'utf8'), 'both tools read the very same SKILL.md');
  assertEqual(on.shared, true, 'a single shared folder is reported');

  const status = execSync('git status --porcelain', { cwd: repo }).toString().trim();
  assertEqual(status, '', 'the deployed skill is invisible to git (excluded, not ignored via the repo .gitignore)');
  assertEqual(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), 'node_modules/\n', 'the repository .gitignore is not touched (unlike `playwright-cli install`)');
  const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
  for (const dir of PLAYWRIGHT_SKILL_DIRS) assertEqual(exclude.includes(`/${dir}`), true, `${dir} is listed in .git/info/exclude`);

  const again = await deployPlaywrightSkill({ tempDir: repo, argv: { playwrightMcp: false, playwrightSkill: true }, log, sourceDir: source });
  assertEqual(again.deployed && again.mode === 'skill', true, 'skill-only mode re-deploys idempotently');
  assertEqual(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8'), exclude, 'the exclude file is not duplicated on re-deploy');

  const missing = await deployPlaywrightSkill({ tempDir: repo, argv: { playwrightSkill: true }, log, sourceDir: path.join(root, 'nope') });
  assertEqual(missing.deployed === false && missing.reason === 'skill-not-found', true, 'a missing skill source is reported, not fabricated');
  assertEqual(
    logs.some(line => line.includes('npm install -g @playwright/cli@latest')),
    true,
    'the operator is told how to install the CLI'
  );

  const home = path.join(root, 'home');
  assertEqual(fs.existsSync(home), false, 'nothing is written outside the workspace (no global ~/.claude, ~/.codex or ~/.agents)');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
