/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2102.
 *
 * The Codex capability preflight built its requirement corpus from the GitHub
 * issue alone (title + body + comments). A repository that declares its
 * mandatory plugins in `AGENTS.md` — the live case was CEHR2005/GCS-TS#5, whose
 * issue body only says "Follow the repository and nested engine `AGENTS.md`
 * instructions" — therefore produced zero requirements, the preflight returned
 * early, and `codex exec` started against an unprovisioned CODEX_HOME. The model
 * then called `request_plugin_install` and codex rejected it with
 * `plugin_id must match one of the entries in the <recommended_plugins> list`,
 * so two solver sessions produced no work at all.
 *
 * Covered here:
 *   1. the root cause: the issue-only corpus detects nothing for that repository;
 *   2. the fix: repository agent instruction files (root + nested `AGENTS.md`,
 *      `CLAUDE.md`, `.codex/*.md`) feed the detector through a bounded walk;
 *   3. the bounds: depth/file/byte caps and skipped directories;
 *   4. the escape hatch: `--require-codex-plugin` / `HIVE_MIND_CODEX_REQUIRED_PLUGINS`;
 *   5. the scanned-source log line, including the zero-requirement case;
 *   6. the `request_plugin_install` rejection diagnostic, echo-proof per #1955.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildPluginCachePath, detectRequiredCodexCapabilities, normalizePluginSelector, readMaterializedPluginSkills, runCodexCapabilityPreflight } from '../src/codex-capability-preflight.lib.mjs';
import { executeCodexCommand, parseCodexExecJsonOutput } from '../src/codex.lib.mjs';
import { detectMalformedFlags } from '../src/option-suggestions.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
// The two modules below are imported as namespaces on purpose: the API this
// regression introduces does not exist yet, and a namespace import keeps the RED
// run a readable assertion failure instead of a module-link SyntaxError.
import * as preflightModule from '../src/codex-capability-preflight.lib.mjs';
import * as codexHealthModule from '../src/codex-health.lib.mjs';

const SUPERPOWERS_SKILLS = ['brainstorming', 'dispatching-parallel-agents', 'executing-plans', 'finishing-a-development-branch', 'receiving-code-review', 'requesting-code-review', 'subagent-driven-development', 'systematic-debugging', 'test-driven-development', 'using-git-worktrees', 'using-superpowers', 'verification-before-completion', 'writing-plans', 'writing-skills'];
const PLUGIN_VERSION = '5.1.3';
const CODEX_BASE_ENV = { PATH: '/bin', RUST_LOG: 'codex_core_plugins=trace,codex_core_skills=trace' };

// CEHR2005/GCS-TS#5 verbatim: the issue delegates the workflow to AGENTS.md and
// the single comment names the plugin without a marketplace, so nothing in the
// issue corpus is a qualified capability reference.
const ISSUE_TITLE = 'Implement GCS v5 trait bonus calculation';
const ISSUE_BODY = ['## Implementation process', '', '- Follow the repository and nested engine `AGENTS.md` instructions.', '- Implement through TDD with recorded RED/GREEN evidence.', '- Complete specification-compliance, code-quality, and final branch reviews before merge.'].join('\n');
const ISSUE_COMMENT = 'you need to install superpowers plugin before start';

// CEHR2005/GCS-TS AGENTS.md, "Mandatory Superpowers implementation workflow"
// section verbatim (docs/case-studies/issue-2102/data/gcs-ts-AGENTS.md).
const ROOT_AGENTS_MD = `# Repository Operating Notes

## Canonical development environment

- The canonical repository gate is \`docker compose run --rm toolchain pnpm check\`.
- Read the nearest nested \`AGENTS.md\` before changing a scoped component. The rules in \`packages/gcs-engine/AGENTS.md\` are normative for the engine.

## Mandatory Superpowers implementation workflow

- Before inspecting implementation details or changing files for an implementation issue, invoke \`superpowers:using-superpowers\` from \`plugin://superpowers@openai-curated-remote\`.
- If the official Superpowers capability is absent, attempt to install the exact plugin \`superpowers@openai-curated-remote\` through the environment-supported plugin installation workflow.
- Execute approved plans in an isolated worktree using \`superpowers:using-git-worktrees\`.
- Use \`superpowers:subagent-driven-development\` for implementation plans: dispatch a fresh implementation subagent per plan task.
- Use \`superpowers:test-driven-development\` and record observed RED and GREEN evidence for every behavior change.
- Invoke \`superpowers:systematic-debugging\` for unexpected failures before proposing or applying fixes.
- Before completion, invoke \`superpowers:verification-before-completion\` and \`superpowers:requesting-code-review\`, run the canonical gate, inspect the complete diff, and resolve accepted findings through TDD.
- Use \`superpowers:dispatching-parallel-agents\` only after proving the delegated work has no shared files.
`;

const NESTED_AGENTS_MD = `# GCS Engine Operating Rules

- The source of truth is pinned to GCS v5.44.0 and GCS Master Library v5.12.0.
- The canonical gate is \`docker compose run --rm toolchain pnpm check\`.
`;

const ROOT_CLAUDE_MD = ['# Claude instructions', '', '- Use the `superpowers:brainstorming` skill before writing a plan.', ''].join('\n');
const CODEX_INSTRUCTIONS_MD = ['# Codex instructions', '', '- You must invoke `superpowers:writing-plans` before implementation.', ''].join('\n');

const EXPECTED_SKILLS = ['superpowers:brainstorming', 'superpowers:dispatching-parallel-agents', 'superpowers:requesting-code-review', 'superpowers:subagent-driven-development', 'superpowers:systematic-debugging', 'superpowers:test-driven-development', 'superpowers:using-git-worktrees', 'superpowers:using-superpowers', 'superpowers:verification-before-completion', 'superpowers:writing-plans'];

const makeGhRunCommand = ({ title = ISSUE_TITLE, body = ISSUE_BODY, comments = [ISSUE_COMMENT] } = {}) => {
  const calls = [];
  const runCommand = async invocation => {
    calls.push(invocation);
    const { command, args } = invocation;
    if (command !== 'gh') throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    if (args.some(arg => arg.endsWith('/comments'))) return { stdout: JSON.stringify(comments.map(comment => ({ body: comment }))), stderr: '', code: 0 };
    return { stdout: JSON.stringify({ title, body }), stderr: '', code: 0 };
  };
  return { calls, runCommand };
};

const writeProject = async (root, files) => {
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return root;
};

// ---------------------------------------------------------------------------
// 1. Root cause: the shipped corpus (issue title + body + comments) is blind to
//    a repository whose requirements live in AGENTS.md.
// ---------------------------------------------------------------------------
{
  const issueCorpus = [ISSUE_TITLE, ISSUE_BODY, ISSUE_COMMENT].join('\n');
  const fromIssueOnly = detectRequiredCodexCapabilities(issueCorpus);
  assert.deepEqual(fromIssueOnly.plugins, [], 'the issue text never names a plugin@marketplace selector');
  assert.deepEqual(fromIssueOnly.skills, [], 'the issue text never names a qualified skill');
  assert.match(issueCorpus, /AGENTS\.md/u, 'the issue delegates its mandatory workflow to AGENTS.md');

  // The detector itself was never broken: the same detector finds every
  // requirement once AGENTS.md is part of the corpus.
  const fromAgentsMd = detectRequiredCodexCapabilities(ROOT_AGENTS_MD);
  assert.deepEqual(fromAgentsMd.plugins, ['superpowers@openai-curated']);
  assert(fromAgentsMd.skills.includes('superpowers:using-superpowers'));

  // Issue #2102: keep the `-remote` rewrite. Recorded CLI evidence from the
  // operator container (codex 0.145.0): `codex plugin list --available --json`
  // offers `superpowers@openai-curated`, while
  // `codex plugin add superpowers@openai-curated-remote` fails because
  // `openai-curated-remote` is a synthesized remote namespace that the CLI
  // cannot install from. Prose (and GCS-TS's AGENTS.md) names the remote
  // spelling, so normalization is what makes the requirement installable.
  assert.equal(normalizePluginSelector('superpowers@openai-curated-remote'), 'superpowers@openai-curated');
  assert.equal(normalizePluginSelector('superpowers@openai-curated'), 'superpowers@openai-curated');
}

// ---------------------------------------------------------------------------
// 2. The fix: repository agent instruction files feed the detector.
// ---------------------------------------------------------------------------
assert.equal(typeof preflightModule.collectAgentInstructionFiles, 'function', 'issue #2102: the preflight must expose a bounded agent-instruction-file walk');
assert.equal(typeof preflightModule.collectCodexCapabilityRequirements, 'function', 'issue #2102: the preflight must expose a requirement collector that reads the checked-out repository');
const { collectAgentInstructionFiles, collectCodexCapabilityRequirements, parseRequiredCapabilityOverrides } = preflightModule;

const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'issue-2102-project-'));
await writeProject(projectRoot, {
  'AGENTS.md': ROOT_AGENTS_MD,
  'CLAUDE.md': ROOT_CLAUDE_MD,
  '.codex/instructions.md': CODEX_INSTRUCTIONS_MD,
  'packages/gcs-engine/AGENTS.md': NESTED_AGENTS_MD,
  // Vendored dependencies are third-party instructions, never requirements of
  // the task being solved.
  'node_modules/some-package/AGENTS.md': '- You must install vendored@openai-curated before anything else.\n',
  '.git/AGENTS.md': '- You must install gitinternal@openai-curated.\n',
  // Beyond the depth bound.
  'a/b/c/d/AGENTS.md': '- You must install toodeep@openai-curated.\n',
  // Not an instruction file.
  'packages/gcs-engine/README.md': '- You must install readme@openai-curated.\n',
});

{
  const walk = await collectAgentInstructionFiles({ projectDir: projectRoot });
  assert.deepEqual(
    walk.files.map(file => file.relativePath),
    ['AGENTS.md', 'CLAUDE.md', '.codex/instructions.md', 'packages/gcs-engine/AGENTS.md'],
    'root and nested agent instruction files are scanned in a deterministic order'
  );
  assert.equal(walk.files[0].text, ROOT_AGENTS_MD, 'instruction file contents are returned for detection');
  assert(!walk.files.some(file => file.relativePath.includes('node_modules')), 'vendored instructions are excluded');
  assert(!walk.files.some(file => file.relativePath.startsWith('.git/')), 'repository internals are excluded');
  assert(!walk.files.some(file => file.relativePath.includes('README')), 'only agent instruction filenames are scanned');
  assert.deepEqual(await collectAgentInstructionFiles({ projectDir: path.join(projectRoot, 'missing') }), { files: [], skipped: [] }, 'a missing checkout is not an error');
  assert.deepEqual(await collectAgentInstructionFiles({}), { files: [], skipped: [] }, 'no checkout means no repository sources');
}

{
  const gh = makeGhRunCommand();
  const requirements = await collectCodexCapabilityRequirements({
    owner: 'CEHR2005',
    repo: 'GCS-TS',
    issueNumber: 5,
    projectDir: projectRoot,
    runCommand: gh.runCommand,
    env: {},
  });

  assert.deepEqual(requirements.plugins, ['superpowers@openai-curated'], 'the mandatory plugin declared in AGENTS.md is discovered');
  assert.deepEqual(requirements.skills, EXPECTED_SKILLS, 'every mandatory skill from AGENTS.md, CLAUDE.md and .codex/ is discovered');
  assert.deepEqual(requirements.sources, ['issue #5', '1 comment', 'AGENTS.md', 'CLAUDE.md', '.codex/instructions.md', 'packages/gcs-engine/AGENTS.md'], 'the collector reports every source it scanned so a negative result is explainable');
  assert(requirements.explicit.includes('superpowers@openai-curated'), 'an AGENTS.md plugin requirement is explicit and therefore fails closed (#2088)');
  assert(requirements.explicit.includes('superpowers:using-superpowers'), 'a qualified AGENTS.md skill requirement is explicit');
  assert(
    requirements.evidence.some(entry => entry.capability === 'superpowers@openai-curated' && entry.source === 'AGENTS.md'),
    'evidence names the file a requirement came from'
  );
  assert(
    requirements.evidence.some(entry => entry.capability === 'superpowers:writing-plans' && entry.source === '.codex/instructions.md'),
    'evidence distinguishes repository instruction sources'
  );
  assert(!requirements.plugins.includes('vendored@openai-curated'), 'node_modules instructions never become requirements');
  assert(!requirements.plugins.includes('toodeep@openai-curated'), 'the walk is bounded by depth');
  assert(!requirements.plugins.includes('readme@openai-curated'), 'non-instruction markdown is not scanned');

  // Issue #2077 protection is untouched: prose that merely mentions a
  // capability-shaped token stays out of the corpus.
  const advisoryProject = await writeProject(await mkdtemp(path.join(os.tmpdir(), 'issue-2102-advisory-')), {
    'AGENTS.md': ['# Notes', '', '- Screenshots must use a 16:9 aspect ratio.', '- The dev server needs localhost:3000 to be free.', '- Contact ops@example.com if the required node@20 toolchain is missing.', ''].join('\n'),
  });
  const advisory = await collectCodexCapabilityRequirements({ owner: 'CEHR2005', repo: 'GCS-TS', issueNumber: 5, projectDir: advisoryProject, runCommand: makeGhRunCommand().runCommand, env: {} });
  assert.deepEqual(advisory.plugins, [], 'prose tokens in AGENTS.md are not plugin requirements');
  assert.deepEqual(advisory.skills, [], 'prose tokens in AGENTS.md are not skill requirements');
  assert(
    advisory.rejected.some(entry => entry.source === 'AGENTS.md'),
    'rejected tokens keep their source for --verbose diagnostics'
  );
  await rm(advisoryProject, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 3. The walk stays bounded: depth, file count and per-file size.
// ---------------------------------------------------------------------------
{
  const boundsRoot = await writeProject(await mkdtemp(path.join(os.tmpdir(), 'issue-2102-bounds-')), {
    'AGENTS.md': '- Must install first@openai-curated.\n',
    'CLAUDE.md': '- Must install second@openai-curated.\n',
    'apps/AGENTS.md': '- Must install third@openai-curated.\n',
    'apps/web/AGENTS.md': '- Must install fourth@openai-curated.\n',
    'huge/AGENTS.md': `- Must install oversized@openai-curated.\n${'x'.repeat(4096)}`,
    'tools/AGENTS.md': '- Must install fifth@openai-curated.\n',
  });

  const bounded = await collectAgentInstructionFiles({ projectDir: boundsRoot, maxDepth: 1, maxFiles: 3, maxBytes: 512 });
  assert.deepEqual(
    bounded.files.map(file => file.relativePath),
    ['AGENTS.md', 'CLAUDE.md', 'apps/AGENTS.md'],
    'depth and file-count caps hold'
  );
  assert(!bounded.files.some(file => file.relativePath === 'apps/web/AGENTS.md'), 'the depth cap holds');
  assert(
    bounded.skipped.some(entry => entry.relativePath === 'huge/AGENTS.md' && entry.reason === 'too-large'),
    'an oversized instruction file is skipped and reported'
  );
  assert(
    bounded.skipped.some(entry => entry.reason === 'max-files'),
    'the file cap is reported rather than silently truncating'
  );
  await rm(boundsRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 4. Escape hatch: an operator can declare the requirement directly.
// ---------------------------------------------------------------------------
{
  assert.equal(typeof parseRequiredCapabilityOverrides, 'function', 'issue #2102: operators need a --require-codex-plugin escape hatch');
  assert.deepEqual(parseRequiredCapabilityOverrides('superpowers@openai-curated-remote, other@personal'), { plugins: ['other@personal', 'superpowers@openai-curated'], invalid: [] }, 'comma-separated selectors are normalized');
  assert.deepEqual(parseRequiredCapabilityOverrides(['superpowers@openai-curated', 'superpowers']), { plugins: ['superpowers@openai-curated'], invalid: ['superpowers'] }, 'a selector without a marketplace cannot be installed and is reported');
  assert.deepEqual(parseRequiredCapabilityOverrides(''), { plugins: [], invalid: [] });
  assert.deepEqual(parseRequiredCapabilityOverrides(undefined), { plugins: [], invalid: [] });

  const bareProject = await writeProject(await mkdtemp(path.join(os.tmpdir(), 'issue-2102-override-')), { 'AGENTS.md': '# Notes\n\n- Nothing mandatory here.\n' });
  const fromOption = await collectCodexCapabilityRequirements({ owner: 'CEHR2005', repo: 'GCS-TS', issueNumber: 5, projectDir: bareProject, runCommand: makeGhRunCommand().runCommand, env: {}, requiredPlugins: 'superpowers@openai-curated-remote' });
  assert.deepEqual(fromOption.plugins, ['superpowers@openai-curated'], '--require-codex-plugin adds a requirement');
  assert(fromOption.explicit.includes('superpowers@openai-curated'), 'an operator-declared requirement fails closed');
  assert(fromOption.sources.includes('--require-codex-plugin'), 'the override is reported as a scanned source');

  const fromEnv = await collectCodexCapabilityRequirements({ owner: 'CEHR2005', repo: 'GCS-TS', issueNumber: 5, projectDir: bareProject, runCommand: makeGhRunCommand().runCommand, env: { HIVE_MIND_CODEX_REQUIRED_PLUGINS: 'superpowers@openai-curated' } });
  assert.deepEqual(fromEnv.plugins, ['superpowers@openai-curated'], 'HIVE_MIND_CODEX_REQUIRED_PLUGINS adds a requirement');
  assert(fromEnv.sources.includes('HIVE_MIND_CODEX_REQUIRED_PLUGINS'));
  await rm(bareProject, { recursive: true, force: true });

  // The library API is only reachable if the CLI exposes it, and the option has
  // to be known to the argument-shape diagnostics like every other option.
  assert.equal(SOLVE_OPTION_DEFINITIONS['require-codex-plugin']?.type, 'string', 'issue #2102: --require-codex-plugin is a real solve option');
  assert(
    detectMalformedFlags(['--', 'require-codex-plugin']).errors.some(error => error.includes('"--require-codex-plugin"')),
    'the option is known to the malformed-flag detector'
  );
}

// ---------------------------------------------------------------------------
// 5. End-to-end preflight: the AGENTS.md requirement is provisioned into
//    repository-scoped state, the #2094 loader boundary stays armed, and the
//    scanned sources are logged in both the positive and negative case.
// ---------------------------------------------------------------------------
const makeCodexFixture = async ({ label, marketplace = 'openai-curated', projectFiles }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `issue-2102-${label}-`));
  const pluginId = `superpowers@${marketplace}`;
  const source = path.join(root, 'marketplace', 'plugins', 'superpowers');
  for (const skill of SUPERPOWERS_SKILLS) {
    await mkdir(path.join(source, 'skills', skill), { recursive: true });
    await writeFile(path.join(source, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\n---\n`);
  }
  const baseCodexHome = path.join(root, '.codex');
  await mkdir(path.join(baseCodexHome, '.tmp', 'plugins'), { recursive: true });
  await writeFile(path.join(baseCodexHome, '.tmp', 'plugins.sha'), 'fixture-sha\n');
  await writeFile(path.join(baseCodexHome, 'config.toml'), '[features]\nremote_plugin = true\nmulti_agent = true\n');
  await writeFile(path.join(baseCodexHome, 'auth.json'), '{"auth_mode":"chatgpt"}\n');
  const projectDir = await writeProject(path.join(root, 'target-checkout'), projectFiles);
  return { root, source, pluginId, baseCodexHome, projectDir, entry: { pluginId, name: 'superpowers', source: { source: 'local', path: source } } };
};

// Mirrors codex-rs 0.145.0: the plugin CLI reports local enablement while the
// prompt loader drops `*@openai-curated` whenever the remote catalog is active.
const makeCodexRunCommand = (fixture, { catalogHasPlugin = true } = {}) => {
  const calls = [];
  const runCommand = async invocation => {
    calls.push(invocation);
    const { command, args, env } = invocation;
    if (command === 'gh' && args.some(arg => arg.endsWith('/comments'))) return { stdout: JSON.stringify([{ body: ISSUE_COMMENT }]), stderr: '', code: 0 };
    if (command === 'gh') return { stdout: JSON.stringify({ title: ISSUE_TITLE, body: ISSUE_BODY }), stderr: '', code: 0 };
    if (command !== 'codex') throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);

    const codexHome = env.CODEX_HOME;
    const configPath = path.join(codexHome, 'config.toml');
    const cacheRoot = buildPluginCachePath({ codexHome, pluginId: fixture.pluginId });
    if (args[0] === 'plugin' && args[1] === 'add') {
      const { cp } = await import('node:fs/promises');
      await cp(path.join(fixture.source, 'skills'), path.join(cacheRoot, PLUGIN_VERSION, 'skills'), { recursive: true });
      const config = await readFile(configPath, 'utf8');
      if (!config.includes(`[plugins."${fixture.pluginId}"]`)) await writeFile(configPath, `${config.trimEnd()}\n\n[plugins."${fixture.pluginId}"]\nenabled = true\n`);
      return { stdout: JSON.stringify({ pluginId: fixture.pluginId }), stderr: '', code: 0 };
    }
    if (args[0] === 'plugin' && args[1] === 'list') {
      const config = await readFile(configPath, 'utf8').catch(() => '');
      const installed = config.includes(`[plugins."${fixture.pluginId}"]`);
      return {
        stdout: JSON.stringify({
          installed: installed ? [{ ...fixture.entry, installed: true, enabled: true, version: PLUGIN_VERSION }] : [],
          available: catalogHasPlugin ? [fixture.entry] : [],
        }),
        stderr: '',
        code: 0,
      };
    }
    if (args[0] === 'debug' && args[1] === 'prompt-input') {
      const config = await readFile(configPath, 'utf8').catch(() => '');
      const auth = JSON.parse(await readFile(path.join(codexHome, 'auth.json'), 'utf8').catch(() => '{}'));
      const remoteCatalogActive = auth.auth_mode === 'chatgpt' && !/^remote_plugin\s*=\s*false\s*$/mu.test(config);
      const filtered = fixture.pluginId.endsWith('@openai-curated') && remoteCatalogActive;
      const { skills } = await readMaterializedPluginSkills({ codexHome, pluginId: fixture.pluginId });
      const exposed = filtered ? [] : [...skills].sort();
      const rendered = ['- imagegen: Generate images. (file: /system/SKILL.md)', ...exposed.map(skill => `- ${skill}: Skill. (file: ${cacheRoot}/SKILL.md)`)].join('\n');
      return { stdout: JSON.stringify({ text: `<skills_instructions>\n### Available skills\n${rendered}\n</skills_instructions>` }), stderr: '', code: 0 };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  return { calls, runCommand };
};

{
  const fixture = await makeCodexFixture({
    label: 'agents-md',
    projectFiles: { 'AGENTS.md': ROOT_AGENTS_MD, 'packages/gcs-engine/AGENTS.md': NESTED_AGENTS_MD },
  });
  const codex = makeCodexRunCommand(fixture);
  const logs = [];
  const result = await runCodexCapabilityPreflight({
    owner: 'CEHR2005',
    repo: 'GCS-TS',
    issueNumber: 5,
    projectDir: fixture.projectDir,
    baseCodexHome: fixture.baseCodexHome,
    runCommand: codex.runCommand,
    env: CODEX_BASE_ENV,
    log: async (message, options) => logs.push({ message, options }),
  });

  assert.equal(result.required, true, 'an AGENTS.md requirement provisions Codex before exec');
  assert.deepEqual(result.plugins, ['superpowers@openai-curated']);
  assert.equal(result.codexHome, path.join(fixture.baseCodexHome, 'hive-mind', 'repositories', 'CEHR2005', 'GCS-TS'));
  const scopedConfig = await readFile(path.join(result.codexHome, 'config.toml'), 'utf8');
  assert.match(scopedConfig, /^remote_plugin\s*=\s*false\s*$/mu, 'issue #2094: the scoped loader override engages on the AGENTS.md path');
  assert.match(scopedConfig, /\[plugins\."superpowers@openai-curated"\]/u);
  const materialized = await readMaterializedPluginSkills({ codexHome: result.codexHome, pluginId: fixture.pluginId });
  assert.equal(materialized.skills.size, 14, 'the complete 14-skill Superpowers payload is materialized');
  assert(
    logs.some(entry => entry.message.includes('detected 1 plugin and 8 skill requirement(s)') && entry.message.includes('sources: issue #5, 1 comment, AGENTS.md, packages/gcs-engine/AGENTS.md')),
    `the preflight reports what it scanned; got: ${JSON.stringify(logs.map(entry => entry.message))}`
  );
  await rm(fixture.root, { recursive: true, force: true });
}

{
  // Issue #2088 fail-closed semantics survive the new source: an explicitly
  // mandated plugin the catalog cannot provide stops the run before `codex exec`.
  const fixture = await makeCodexFixture({ label: 'fail-closed', projectFiles: { 'AGENTS.md': ROOT_AGENTS_MD } });
  const codex = makeCodexRunCommand(fixture, { catalogHasPlugin: false });
  const logs = [];
  await assert.rejects(
    () =>
      runCodexCapabilityPreflight({
        owner: 'CEHR2005',
        repo: 'GCS-TS',
        issueNumber: 5,
        projectDir: fixture.projectDir,
        baseCodexHome: fixture.baseCodexHome,
        runCommand: codex.runCommand,
        env: CODEX_BASE_ENV,
        log: async (message, options) => logs.push({ message, options }),
      }),
    error => {
      assert.equal(error.name, 'CodexCapabilityPreflightError');
      assert.equal(error.details.failClosed, true, 'an AGENTS.md-mandated plugin is an explicit requirement');
      assert.match(error.message, /superpowers@openai-curated/u);
      return true;
    }
  );
  assert(logs.some(entry => entry.message.includes('names this capability explicitly')));

  // ...unless the operator opts into a degraded run.
  const advisory = await runCodexCapabilityPreflight({
    owner: 'CEHR2005',
    repo: 'GCS-TS',
    issueNumber: 5,
    projectDir: fixture.projectDir,
    baseCodexHome: fixture.baseCodexHome,
    runCommand: makeCodexRunCommand(fixture, { catalogHasPlugin: false }).runCommand,
    env: { ...CODEX_BASE_ENV, HIVE_MIND_CODEX_CAPABILITY_ADVISORY: '1' },
  });
  assert.equal(advisory.degraded, true, 'HIVE_MIND_CODEX_CAPABILITY_ADVISORY=1 still allows a degraded run');
  await rm(fixture.root, { recursive: true, force: true });
}

{
  // The zero-requirement case names the sources it scanned, so a future
  // "nothing detected" report is diagnosable from the log alone.
  const fixture = await makeCodexFixture({ label: 'no-requirements', projectFiles: { 'AGENTS.md': '# Notes\n\n- The canonical gate is `pnpm check`.\n' } });
  const logs = [];
  const result = await runCodexCapabilityPreflight({
    owner: 'CEHR2005',
    repo: 'GCS-TS',
    issueNumber: 5,
    projectDir: fixture.projectDir,
    baseCodexHome: fixture.baseCodexHome,
    runCommand: makeCodexRunCommand(fixture).runCommand,
    env: CODEX_BASE_ENV,
    log: async (message, options) => logs.push({ message, options }),
  });
  assert.equal(result.required, false);
  assert(
    logs.some(entry => entry.message === '🔌 Codex capability preflight: no plugin or skill requirements detected (sources: issue #5, 1 comment, AGENTS.md)' && entry.options?.verbose),
    `the negative result names its sources; got: ${JSON.stringify(logs.map(entry => entry.message))}`
  );
  await rm(fixture.root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 6. `request_plugin_install` rejection: a named Hive Mind diagnostic that
//    points at the preflight, and never fires on echoed text (#1955).
// ---------------------------------------------------------------------------
assert.equal(typeof codexHealthModule.matchCodexPluginInstallRejection, 'function', 'issue #2102: the runtime plugin-install rejection must be recognized');
assert.equal(typeof codexHealthModule.getCodexPluginProvisioningHealth, 'function', 'issue #2102: the rejection must be reported as a named Hive Mind failure');
const { getCodexPluginProvisioningHealth, matchCodexPluginInstallRejection } = codexHealthModule;

// Verbatim from docs/case-studies/issue-2102/raw/solution-draft-log-pr-1784809014365.txt.
const REJECTION_TOOL_RESULT = '2026-07-23T12:16:31.963987Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=request_plugin_install call_id=call_ccuteZ4s1AdV1wKVgJdt0Fk5 arguments={"plugin_id":"superpowers@openai-curated-remote","suggest_reason":"Repository requires the mandatory Superpowers workflow."} duration_ms=0 success=false output=plugin_id must match one of the entries in the <recommended_plugins> list mcp_server= mcp_server_origin= event.timestamp=2026-07-23T12:16:31.963Z app.version=0.145.0 auth_mode="Chatgpt" originator=codex_exec model=gpt-5.6-sol';
const REJECTION_ROUTER_ERROR = '2026-07-23T12:16:31.965122Z ERROR codex_core::tools::router: error=plugin_id must match one of the entries in the <recommended_plugins> list';

{
  const toolResult = matchCodexPluginInstallRejection(REJECTION_TOOL_RESULT);
  assert.equal(toolResult?.pluginId, 'superpowers@openai-curated-remote', 'the requested plugin id is captured');
  assert.equal(toolResult?.callId, 'call_ccuteZ4s1AdV1wKVgJdt0Fk5');
  assert.match(toolResult?.message, /plugin_id must match one of the entries in the <recommended_plugins> list/u);
  assert.equal(matchCodexPluginInstallRejection(REJECTION_ROUTER_ERROR)?.source, 'router');
  assert.equal(matchCodexPluginInstallRejection('2026-07-23T12:16:31Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=request_plugin_install call_id=c1 duration_ms=0 success=true output=installed'), null, 'a successful install is not a rejection');

  // Issue #1955 echo protection. Codex replays the stdout of every command it
  // runs, so a target repository that prints or greps this very log line (as the
  // #2102 case study itself does) must not be read as a live rejection.
  const echoedInsideProtocolEvent = JSON.stringify({ type: 'item.completed', item: { id: 'cmd', type: 'command_execution', command: 'grep -n recommended_plugins log.txt', aggregated_output: REJECTION_TOOL_RESULT, exit_code: 0, status: 'completed' } });
  const echoedInsideOtelOutput = `2026-07-23T14:00:00.000000Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=shell call_id=call_echo duration_ms=12 success=true output=${REJECTION_TOOL_RESULT}`;
  const echoedRouterLine = `2026-07-23T14:00:00.000000Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=shell call_id=call_echo2 duration_ms=12 success=true output=${REJECTION_ROUTER_ERROR}`;
  assert.equal(matchCodexPluginInstallRejection(echoedInsideOtelOutput), null, 'an echoed OTEL dump of the rejection is not a rejection');
  assert.equal(matchCodexPluginInstallRejection(echoedRouterLine), null, 'an echoed router error is not a rejection');

  const state = parseCodexExecJsonOutput([REJECTION_TOOL_RESULT, REJECTION_ROUTER_ERROR, '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"m","type":"agent_message","text":"I cannot install the plugin."}}', '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}'].join('\n'), undefined, 'gpt-5.6-sol');
  assert.equal(state.pluginInstallRejections.length, 2, 'both the tool result and the router error are recorded');
  assert.deepEqual(
    state.pluginInstallRejections.map(entry => entry.source),
    ['tool_result', 'router'],
    'each rejection records where it was observed'
  );
  assert.deepEqual(parseCodexExecJsonOutput([echoedInsideProtocolEvent, echoedInsideOtelOutput, echoedRouterLine].join('\n'), undefined, 'gpt-5.6-sol').pluginInstallRejections, [], 'echoed content never produces a rejection');

  const blocked = getCodexPluginProvisioningHealth(state, { capabilityPreflight: { required: false, plugins: [] } });
  assert.equal(blocked.healthy, false, 'a run blocked on an impossible runtime install is not a success');
  assert.deepEqual(blocked.requestedPlugins, ['superpowers@openai-curated-remote']);
  assert.match(blocked.message, /request_plugin_install/u);
  assert.match(blocked.message, /codex exec/u);
  assert(
    blocked.reasons.some(reason => /capability preflight/iu.test(reason)),
    'the diagnostic points at the preflight that should have provisioned the plugin'
  );
  assert(
    blocked.guidance.some(line => line.includes('--require-codex-plugin superpowers@openai-curated')),
    'the diagnostic offers the normalized, installable selector'
  );

  // A run that produced real file changes is not failed retroactively: the
  // model may probe `request_plugin_install` and then work without it.
  const withWork = { ...state, fileChanges: [{ id: 'f1', status: 'completed', changes: [{ path: 'src/engine.ts', kind: 'update' }] }] };
  const advisory = getCodexPluginProvisioningHealth(withWork, { capabilityPreflight: { required: true, plugins: ['superpowers@openai-curated'] } });
  assert.equal(advisory.healthy, true, 'a productive run stays successful');
  assert.equal(advisory.detected, true, 'the rejection is still reported as a diagnostic');
  assert.equal(getCodexPluginProvisioningHealth({}, {}).detected, false, 'no rejection, no diagnostic');
}

{
  // The whole path, as `solve --tool codex` runs it: exit 0 with a completed
  // turn, no file changes, and a rejected runtime plugin install is a failure
  // that names the preflight.
  const fixture = await makeCodexFixture({ label: 'exec-diagnostic', projectFiles: { 'AGENTS.md': ROOT_AGENTS_MD } });
  const logs = [];
  const fakeDollar = () => () => ({
    async *stream() {
      yield { type: 'stdout', data: Buffer.from(['{"type":"thread.started","thread_id":"issue-2102-diagnostic"}', '{"type":"turn.started"}', REJECTION_TOOL_RESULT, REJECTION_ROUTER_ERROR, '{"type":"item.completed","item":{"id":"m","type":"agent_message","text":"Blocked: the mandatory Superpowers plugin cannot be installed."}}', '{"type":"turn.completed","usage":{"input_tokens":21305,"output_tokens":122}}'].join('\n')) };
      yield { type: 'exit', code: 0 };
    },
  });

  const execution = await executeCodexCommand({
    tempDir: fixture.projectDir,
    branchName: 'issue-2102-regression',
    prompt: 'Implement the engine slice.',
    systemPrompt: '',
    argv: { model: 'gpt-5.6-sol', verbose: false },
    log: async (message, options) => logs.push({ message, options }),
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    codexPath: 'codex',
    $: fakeDollar,
    owner: null,
    repo: null,
    prNumber: null,
    capabilityPreflight: { required: false, plugins: [], codexHome: null, codexBaseEnv: CODEX_BASE_ENV },
    calculatePricing: async () => null,
  });

  assert.equal(execution.success, false, 'a run that could not obtain its mandatory plugin is not reported as success');
  assert.equal(execution.pluginProvisioning?.detected, true);
  assert(
    logs.some(entry => entry.message.includes('Codex could not obtain a required plugin at runtime')),
    `the failure is named; got: ${JSON.stringify(logs.map(entry => entry.message).slice(-12))}`
  );
  await rm(fixture.root, { recursive: true, force: true });
}

await rm(projectRoot, { recursive: true, force: true });

console.log('✅ issue #2102: repository AGENTS.md requirements reach the Codex capability preflight');
