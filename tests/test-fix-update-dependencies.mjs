#!/usr/bin/env node

/**
 * Unit tests for `/fix --update-all-dependencies` and the matching
 * `/solve --update-all-dependencies` option (issue #2184).
 *
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAutomationSection, buildEcosystemsSection, buildStandardPrompt, buildStandardPromptParagraphs, buildUpdateDependenciesIssueBody, buildUpdateDependenciesIssueTitle, DEPENDENCY_ECOSYSTEMS, mapRepositoryToEcosystems, matchesEcosystem, REPORT_UPSTREAM_PARAGRAPH, UPDATE_DEPENDENCIES_FORWARDED_SOLVE_OPTIONS, UPDATE_DEPENDENCIES_ISSUE_LABELS, UPDATE_DEPENDENCIES_ISSUE_TITLE, UPDATE_DEPENDENCIES_ISSUE_TYPE } from '../src/fix.update-dependencies.lib.mjs';
import { buildSolveArgs, FIX_MODE_CI_CD, FIX_MODE_UPDATE_ALL_DEPENDENCIES, FIX_MODES, FIX_SOLVE_OPTIONS, partitionFixArgs, solveOptionsForMode } from '../src/fix.args.lib.mjs';
import { createUpdateDependenciesIssue, prepareUpdateDependenciesIssue } from '../src/fix.update-dependencies-issue.lib.mjs';
import { getRepositoryFiles } from '../src/fix.github.lib.mjs';
import { buildUpdateAllDependenciesSubPrompt, getUpdateAllDependenciesSubPrompt } from '../src/update-dependencies.prompts.lib.mjs';
import { KEEP_WORKING_PROMPT } from '../src/solve.keep-working.detect.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';
import { applyFixCommandDefaults, FIX_OWN_OPTIONS } from '../src/telegram-fix-command.lib.mjs';
import { findTaskGeneratedIssueMode, TASK_GENERATED_ISSUE_MODES } from '../src/telegram-task-command.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

// --- ecosystem catalog ------------------------------------------------------

await test('every catalog entry carries the fields the issue body renders', () => {
  assert.ok(DEPENDENCY_ECOSYSTEMS.length >= 15, 'the catalog covers the mainstream ecosystems');
  for (const ecosystem of DEPENDENCY_ECOSYSTEMS) {
    assert.ok(ecosystem.key, 'key');
    assert.ok(ecosystem.label, `label for ${ecosystem.key}`);
    assert.ok(ecosystem.manifests.length > 0 || ecosystem.pathPatterns.length > 0, `${ecosystem.key} is detectable`);
    assert.ok(ecosystem.updateCommand, `${ecosystem.key} says how to update everything`);
    assert.ok(Array.isArray(ecosystem.dependabot), `${ecosystem.key} maps to Dependabot package-ecosystem values`);
  }
});

await test('catalog keys are unique', () => {
  const keys = DEPENDENCY_ECOSYSTEMS.map(ecosystem => ecosystem.key);
  assert.equal(new Set(keys).size, keys.length);
});

await test('the catalog is frozen so a caller cannot mutate the shared entries', () => {
  assert.ok(Object.isFrozen(DEPENDENCY_ECOSYSTEMS));
  assert.ok(DEPENDENCY_ECOSYSTEMS.every(ecosystem => Object.isFrozen(ecosystem)));
});

await test('every Dependabot value in the catalog is one GitHub actually accepts', () => {
  // buildAutomationSection prints these verbatim as "Ecosystems to declare", so a
  // value GitHub rejects would make the generated .github/dependabot.yml invalid.
  // The reference list is the one captured from GitHub's docs for the case study.
  const reference = JSON.parse(readFileSync(fileURLToPath(new URL('../docs/case-studies/issue-2184/data/dependabot-package-ecosystems.json', import.meta.url)), 'utf8'));
  const accepted = new Set(reference.package_ecosystem_values);
  assert.equal(accepted.size, 33, 'the captured reference list is intact');
  for (const ecosystem of DEPENDENCY_ECOSYSTEMS) {
    for (const value of ecosystem.dependabot) {
      assert.ok(accepted.has(value), `package-ecosystem: ${value} (${ecosystem.key}) is not a value Dependabot accepts`);
    }
  }
  // The specific trap: pnpm looks like a sibling of npm/yarn/bun but is not a
  // package-ecosystem value -- pnpm-lock.yaml is covered by `npm`.
  assert.ok(!accepted.has('pnpm'));
  const javascript = DEPENDENCY_ECOSYSTEMS.find(ecosystem => ecosystem.key === 'javascript');
  assert.ok(javascript.lockfiles.includes('pnpm-lock.yaml'), 'pnpm projects are still detected');
  assert.deepEqual(javascript.dependabot, ['npm', 'yarn', 'bun']);
});

await test('matchesEcosystem matches manifests anywhere in the tree', () => {
  const npm = DEPENDENCY_ECOSYSTEMS.find(ecosystem => ecosystem.key === 'javascript');
  assert.ok(matchesEcosystem(npm, 'package.json'));
  assert.ok(matchesEcosystem(npm, 'packages/cli/package.json'));
  assert.ok(!matchesEcosystem(npm, 'packages.json'));
});

await test('matchesEcosystem ignores vendored and build directories', () => {
  // A vendored copy of someone else's manifest is not a dependency of ours;
  // listing node_modules/*/package.json would drown the real inventory.
  const npm = DEPENDENCY_ECOSYSTEMS.find(ecosystem => ecosystem.key === 'javascript');
  assert.ok(!matchesEcosystem(npm, 'node_modules/left-pad/package.json'));
  assert.ok(!matchesEcosystem(npm, 'dist/package.json'));
  assert.ok(!matchesEcosystem(npm, 'app/.venv/lib/package.json'));
});

await test('mapRepositoryToEcosystems combines Linguist bytes with committed manifests', () => {
  const { detected } = mapRepositoryToEcosystems({
    languages: { Python: 9000, JavaScript: 100 },
    files: ['pyproject.toml', 'package.json'],
  });
  assert.deepEqual(
    detected.map(entry => entry.ecosystem.key),
    ['python', 'javascript'],
    'the language that dominates the repository is listed first'
  );
  assert.deepEqual(detected[0].manifests, ['pyproject.toml']);
});

await test('mapRepositoryToEcosystems detects an ecosystem from manifests alone', () => {
  // Terraform and Helm are not Linguist languages of a JS repository, but their
  // manifests still pin versions that go stale.
  const { detected } = mapRepositoryToEcosystems({
    languages: { JavaScript: 100 },
    files: ['package.json', 'helm/app/Chart.yaml'],
  });
  assert.ok(detected.some(entry => entry.ecosystem.key === 'infrastructure'));
});

await test('mapRepositoryToEcosystems reports languages with no manifest of their own', () => {
  const { unmatchedLanguages } = mapRepositoryToEcosystems({ languages: { Shell: 100, JavaScript: 900 }, files: ['package.json'] });
  assert.deepEqual(unmatchedLanguages, ['Shell']);
});

await test('GitHub Actions is detected from workflow files without a manifest name', () => {
  const { detected } = mapRepositoryToEcosystems({ languages: {}, files: ['.github/workflows/ci.yml'] });
  assert.ok(detected.some(entry => entry.ecosystem.key === 'github-actions'));
});

await test('a repository with nothing detectable yields no ecosystems rather than throwing', () => {
  const { detected, unmatchedLanguages } = mapRepositoryToEcosystems({});
  assert.deepEqual(detected, []);
  assert.deepEqual(unmatchedLanguages, []);
});

// --- issue body -------------------------------------------------------------

await test('buildEcosystemsSection lists manifests, lockfiles and the update command', () => {
  const section = buildEcosystemsSection({ languages: { JavaScript: 100 }, files: ['package.json', 'package-lock.json'] });
  assert.match(section, /JavaScript \/ TypeScript/);
  assert.match(section, /`package\.json`/);
  assert.match(section, /Lockfiles to regenerate and commit: `package-lock\.json`/);
  assert.match(section, /npm-check-updates/);
});

await test('buildEcosystemsSection still asks for a manual sweep when nothing is detected', () => {
  assert.match(buildEcosystemsSection({}), /No package ecosystem was detected automatically/);
});

await test('buildAutomationSection asks for dependabot.yml only when it is missing', () => {
  const missing = buildAutomationSection({ languages: { JavaScript: 1 }, files: ['package.json'] });
  assert.match(missing, /There is no `\.github\/dependabot\.yml`/);
  assert.match(missing, /`npm`/, 'the Dependabot package-ecosystem values are spelled out');

  const present = buildAutomationSection({ languages: { JavaScript: 1 }, files: ['package.json', '.github/dependabot.yml'] });
  assert.match(present, /already exists/);
  assert.doesNotMatch(present, /There is no/);
});

await test('buildAutomationSection recognizes the .yaml spelling too', () => {
  const present = buildAutomationSection({ languages: { JavaScript: 1 }, files: ['package.json', '.github/dependabot.yaml'] });
  assert.match(present, /already exists/);
});

await test('the issue is a Task labelled dependencies, not a Bug', () => {
  // /solve --deep-analysis emits root-cause and debug-output paragraphs only
  // for bugs; a dependency bump has no root cause to find.
  assert.equal(UPDATE_DEPENDENCIES_ISSUE_TYPE, 'Task');
  assert.deepEqual([...UPDATE_DEPENDENCIES_ISSUE_LABELS], ['dependencies']);
  assert.equal(buildUpdateDependenciesIssueTitle(), UPDATE_DEPENDENCIES_ISSUE_TITLE);
});

await test('buildUpdateDependenciesIssueBody keeps the collected context in a collapsed block', () => {
  const body = buildUpdateDependenciesIssueBody({
    repository: { fullName: 'owner/repo', url: 'https://github.com/owner/repo' },
    defaultBranch: 'main',
    commit: { sha: 'abcdef1234567890', url: 'https://github.com/owner/repo/commit/abcdef1', message: 'Release v1\n\nbody' },
    languages: { JavaScript: 100 },
    files: ['package.json'],
  });
  assert.match(body, /### Dependency ecosystems detected in this repository/);
  assert.match(body, /<summary>Context collected by <code>\/fix --update-all-dependencies<\/code><\/summary>/);
  assert.match(body, /`abcdef1`/, 'the commit is abbreviated');
  assert.match(body, /Release v1/);
  assert.doesNotMatch(body, /\nbody/, 'only the commit subject is quoted');
});

await test('buildUpdateDependenciesIssueBody records a truncated file listing', () => {
  const body = buildUpdateDependenciesIssueBody({
    repository: { fullName: 'owner/repo', url: 'https://github.com/owner/repo' },
    defaultBranch: 'main',
    commit: null,
    languages: { JavaScript: 100 },
    files: ['package.json'],
    filesTruncated: true,
  });
  assert.match(body, /truncated/i, 'a partial inventory must say so, or it reads as complete');
});

// --- standard prompt --------------------------------------------------------

await test('the standard prompt states each requirement the issue asks for', () => {
  const prompt = buildStandardPrompt({ ecosystems: [], omittedOptions: [] });
  assert.match(prompt, /"All" is literal/, 'update everything, not a selection');
  assert.match(prompt, /resolved from the registry/, 'versions come from the registry, not from memory');
  assert.match(prompt, /Cross major versions deliberately/);
  assert.match(prompt, /Use the new features/, 'issue #2184 asks for less duplicated code afterwards');
  assert.match(prompt, /regenerate and commit every lockfile/);
  assert.match(prompt, /bring every pin to the same version/);
  assert.match(prompt, /make CI green/);
  assert.match(prompt, /security advisories/);
});

await test('the standard prompt names the detected ecosystems when they are known', () => {
  const { detected } = mapRepositoryToEcosystems({ languages: { JavaScript: 100 }, files: ['package.json'] });
  assert.match(buildStandardPrompt({ ecosystems: detected, omittedOptions: [] }), /in JavaScript \/ TypeScript\./);
  assert.match(buildStandardPrompt({ ecosystems: [], omittedOptions: [] }), /every language and package manager present in the repository/);
});

await test('paragraphs already provided by a forwarded /solve option are dropped', () => {
  // Same contract as /fix --ci-cd: /fix forwards --deep-analysis, which already
  // tells the AI to report upstream bugs, so the issue must not repeat it.
  const withOption = buildStandardPrompt({ ecosystems: [] });
  const withoutOption = buildStandardPrompt({ ecosystems: [], omittedOptions: [] });
  assert.ok(!withOption.includes(REPORT_UPSTREAM_PARAGRAPH));
  assert.ok(withoutOption.includes(REPORT_UPSTREAM_PARAGRAPH));
  assert.ok(UPDATE_DEPENDENCIES_FORWARDED_SOLVE_OPTIONS.includes('--deep-analysis'));
});

await test('every tagged paragraph names options /fix actually forwards', () => {
  const forwarded = new Set(UPDATE_DEPENDENCIES_FORWARDED_SOLVE_OPTIONS);
  for (const paragraph of buildStandardPromptParagraphs()) {
    for (const option of paragraph.providedBy) {
      assert.ok(forwarded.has(option), `${option} is tagged but never forwarded, so the paragraph could never be dropped`);
    }
  }
});

await test('the prompt ends with the keep-working reinforcement /solve already uses', () => {
  assert.ok(buildStandardPrompt({ ecosystems: [] }).endsWith(KEEP_WORKING_PROMPT));
});

// --- /fix argument handling -------------------------------------------------

await test('FIX_MODES lists both modes with their flags', () => {
  assert.deepEqual(
    FIX_MODES.map(mode => mode.flag),
    ['--ci-cd', '--update-all-dependencies']
  );
});

await test('partitionFixArgs consumes --update-all-dependencies as the mode', () => {
  const parsed = partitionFixArgs(['owner/repo', '--update-all-dependencies', '--tool', 'codex']);
  assert.equal(parsed.mode, FIX_MODE_UPDATE_ALL_DEPENDENCIES);
  assert.deepEqual(parsed.modes, [FIX_MODE_UPDATE_ALL_DEPENDENCIES]);
  assert.deepEqual(parsed.passthrough, ['--tool', 'codex']);
  assert.equal(parsed.repository.fullName, 'owner/repo');
});

await test('partitionFixArgs reports both modes rather than silently picking one', () => {
  const parsed = partitionFixArgs(['owner/repo', '--ci-cd', '--update-all-dependencies']);
  assert.deepEqual(parsed.modes, [FIX_MODE_CI_CD, FIX_MODE_UPDATE_ALL_DEPENDENCIES]);
  assert.equal(parsed.mode, null, 'an ambiguous request must not resolve to a mode');
});

await test('partitionFixArgs still defaults to no mode when none is given', () => {
  const parsed = partitionFixArgs(['owner/repo']);
  assert.deepEqual(parsed.modes, []);
  assert.equal(parsed.mode, null);
});

await test('/fix --update-all-dependencies turns the option on in the spawned /solve', () => {
  const args = buildSolveArgs({ issueUrl: 'https://github.com/owner/repo/issues/1', passthrough: ['--tool', 'codex'], mode: FIX_MODE_UPDATE_ALL_DEPENDENCIES });
  assert.deepEqual(args, ['https://github.com/owner/repo/issues/1', '--development-log', '--deep-analysis', '--auto-merge', '--update-all-dependencies', '--tool', 'codex']);
});

await test('--ci-cd does not gain the dependency option', () => {
  const args = buildSolveArgs({ issueUrl: 'u', mode: FIX_MODE_CI_CD });
  assert.deepEqual(args, ['u', ...FIX_SOLVE_OPTIONS]);
  assert.deepEqual([...solveOptionsForMode(FIX_MODE_CI_CD)], [...FIX_SOLVE_OPTIONS]);
});

await test('an option the user already passed is not added twice', () => {
  const args = buildSolveArgs({ issueUrl: 'u', passthrough: ['--deep-analysis'], mode: FIX_MODE_UPDATE_ALL_DEPENDENCIES });
  assert.equal(args.filter(arg => arg === '--deep-analysis').length, 1);
});

// --- GitHub-backed collection ----------------------------------------------

const treeResponse = JSON.stringify({ truncated: false, files: ['package.json', 'package-lock.json', '.github/workflows/ci.yml'] });

await test('getRepositoryFiles returns the committed blob paths', async () => {
  const { files, truncated } = await getRepositoryFiles(
    { fullName: 'owner/repo' },
    'main',
    async () => ({ code: 0, stdout: treeResponse, stderr: '' }),
    () => {}
  );
  assert.deepEqual(files, ['package.json', 'package-lock.json', '.github/workflows/ci.yml']);
  assert.equal(truncated, false);
});

await test('getRepositoryFiles degrades to an empty inventory when the API fails', async () => {
  // A private repository or a missing scope must not stop the issue from being
  // generated out of the data that *was* readable.
  const warnings = [];
  const { files } = await getRepositoryFiles(
    { fullName: 'owner/repo' },
    'main',
    async () => ({ code: 1, stdout: '', stderr: 'Not Found' }),
    message => warnings.push(message)
  );
  assert.deepEqual(files, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Could not list repository files/);
});

await test('getRepositoryFiles asks for nothing when there is no branch to read', async () => {
  let called = false;
  const { files } = await getRepositoryFiles(
    { fullName: 'owner/repo' },
    null,
    async () => {
      called = true;
      return { code: 0, stdout: '', stderr: '' };
    },
    () => {}
  );
  assert.equal(called, false);
  assert.deepEqual(files, []);
});

await test('prepare + create collect the context and open one typed issue', async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    const endpoint = args[1] || '';
    if (endpoint.includes('/languages')) return { code: 0, stdout: JSON.stringify({ JavaScript: 9000 }), stderr: '' };
    if (endpoint.endsWith('owner/repo')) return { code: 0, stdout: 'main\n', stderr: '' };
    if (endpoint.includes('/commits/')) return { code: 0, stdout: JSON.stringify({ sha: 'abcdef1234567', message: 'Latest', url: 'https://github.com/owner/repo/commit/abcdef1' }), stderr: '' };
    if (endpoint.includes('/git/trees/')) return { code: 0, stdout: treeResponse, stderr: '' };
    if (args[0] === 'issue' && args[1] === 'create') return { code: 0, stdout: 'https://github.com/owner/repo/issues/9\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };

  const repository = { owner: 'owner', repo: 'repo', fullName: 'owner/repo', url: 'https://github.com/owner/repo' };
  const prepared = await prepareUpdateDependenciesIssue({ repository, run, warn: () => {} });
  assert.equal(prepared.defaultBranch, 'main');
  assert.equal(prepared.title, UPDATE_DEPENDENCIES_ISSUE_TITLE);
  assert.ok(prepared.ecosystems.some(entry => entry.ecosystem.key === 'javascript'));
  assert.ok(prepared.ecosystems.some(entry => entry.ecosystem.key === 'github-actions'));
  assert.match(prepared.body, /package-lock\.json/);

  const issue = await createUpdateDependenciesIssue({ repository, prepared, run });
  assert.equal(issue.url, 'https://github.com/owner/repo/issues/9');
  const createCall = calls.find(call => call.args[0] === 'issue' && call.args[1] === 'create');
  assert.ok(createCall);
  assert.ok(createCall.args.includes('Task'), 'the issue is typed Task');
  assert.ok(createCall.args.includes('dependencies'), 'the issue is labelled dependencies');
});

// --- /solve, /hive option ---------------------------------------------------

await test('/solve exposes --update-all-dependencies, disabled by default', () => {
  const option = SOLVE_OPTION_DEFINITIONS['update-all-dependencies'];
  assert.ok(option, 'the option is defined');
  assert.equal(option.type, 'boolean');
  assert.equal(option.default, false, 'issue #2184: "By default it is disabled."');
  assert.match(option.description, /latest version/i);
});

await test('/hive forwards the option to /solve automatically', () => {
  assert.ok(getSolvePassthroughOptionNames().includes('update-all-dependencies'));
});

// --- /solve sub-prompt ------------------------------------------------------

await test('the sub-prompt is empty unless the option is set', () => {
  assert.equal(getUpdateAllDependenciesSubPrompt({}), '');
  assert.equal(getUpdateAllDependenciesSubPrompt(null), '');
  assert.equal(getUpdateAllDependenciesSubPrompt({ updateAllDependencies: false }), '');
});

await test('the sub-prompt reuses the standard prompt wording', () => {
  const prompt = getUpdateAllDependenciesSubPrompt({ updateAllDependencies: true });
  assert.match(prompt, /Dependency updates \(--update-all-dependencies\)/);
  assert.match(prompt, /"All" is literal/);
  assert.match(prompt, /Cross major versions deliberately/);
  assert.match(prompt, /Use the new features/);
});

await test('the sub-prompt does not repeat what /solve already says', () => {
  const prompt = buildUpdateAllDependenciesSubPrompt();
  assert.ok(!prompt.includes(KEEP_WORKING_PROMPT), '/solve emits the keep-working reinforcement itself');
});

await test('the sub-prompt drops paragraphs the enabled /solve options already provide', () => {
  const withDeepAnalysis = getUpdateAllDependenciesSubPrompt({ updateAllDependencies: true, deepAnalysis: true });
  assert.ok(!withDeepAnalysis.includes(REPORT_UPSTREAM_PARAGRAPH));
  assert.ok(getUpdateAllDependenciesSubPrompt({ updateAllDependencies: true }).includes(REPORT_UPSTREAM_PARAGRAPH));
});

await test('every tool system prompt includes the sub-prompt when the option is on', async () => {
  // The gate is per tool: a tool whose prompt file is not wired up would ship
  // the option as a silent no-op for anyone using --tool <that one>.
  const params = { owner: 'owner', repo: 'repo', issueNumber: 1, branchName: 'issue-1' };
  for (const tool of ['claude', 'codex', 'opencode', 'agent', 'qwen', 'gemini']) {
    const { buildSystemPrompt } = await import(`../src/${tool}.prompts.lib.mjs`);
    const enabled = buildSystemPrompt({ ...params, argv: { updateAllDependencies: true } });
    const disabled = buildSystemPrompt({ ...params, argv: {} });
    assert.match(enabled, /Dependency updates \(--update-all-dependencies\)/, `${tool} includes the sub-prompt`);
    assert.doesNotMatch(disabled, /Dependency updates \(--update-all-dependencies\)/, `${tool} omits it by default`);
  }
});

// --- Telegram ---------------------------------------------------------------

await test('the Telegram /fix default mode does not fight an explicit one', () => {
  // /fix rejects two modes at once, so implying --ci-cd on top of an explicit
  // --update-all-dependencies would make every such request fail.
  assert.deepEqual(applyFixCommandDefaults(['owner/repo']), ['owner/repo', '--ci-cd']);
  assert.deepEqual(applyFixCommandDefaults(['owner/repo', '--update-all-dependencies']), ['owner/repo', '--update-all-dependencies']);
  assert.deepEqual(applyFixCommandDefaults(['owner/repo', '--ci-cd']), ['owner/repo', '--ci-cd']);
});

await test('the Telegram /fix validator knows the new flag is fix-owned', () => {
  assert.ok(FIX_OWN_OPTIONS.includes('--update-all-dependencies'));
  assert.ok(FIX_OWN_OPTIONS.includes('--ci-cd'));
});

await test('/task --update-all-dependencies is a generated-issue mode', () => {
  assert.deepEqual(
    TASK_GENERATED_ISSUE_MODES.map(mode => mode.flag),
    ['--ci-cd', '--update-all-dependencies']
  );
  assert.equal(findTaskGeneratedIssueMode(['--update-all-dependencies', 'owner/repo']).mode, FIX_MODE_UPDATE_ALL_DEPENDENCIES);
  assert.equal(findTaskGeneratedIssueMode(['--ci-cd', 'owner/repo']).mode, FIX_MODE_CI_CD);
  assert.equal(findTaskGeneratedIssueMode(['owner/repo']), null);
  assert.equal(findTaskGeneratedIssueMode(['--update-all-dependencies'], 'split'), null, '/split has no generated-issue mode');
});

await test('the /task follow-up keeps the option on for the suggested /solve', () => {
  const mode = TASK_GENERATED_ISSUE_MODES.find(entry => entry.mode === FIX_MODE_UPDATE_ALL_DEPENDENCIES);
  assert.match(mode.followUp, /--update-all-dependencies/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
