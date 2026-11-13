// @hive-mind-test-suite default,pr-essential
// Issue #4057: a Codex run in a repository with its own skills under
// `.agents/skills` and `.codex/skills` failed with "Codex exposed skill
// instructions outside the capability allowlist". Hive Mind 2.39.14 admitted a
// repository skill only when the issue named it explicitly, and never from
// `.codex/skills`. Repository skills must work out of the box, while skills
// from the host (`$HOME/.agents/skills`, `/etc/codex/skills`, symlinks leaving
// the checkout) must never reach the model and must not fail the run.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse as parseToml } from 'smol-toml';

import { CodexCapabilityPreflightError, runCodexCapabilityPreflight } from '../src/codex-capability-preflight.lib.mjs';
import { disableScopedCodexSkills } from '../src/codex-repository-config.lib.mjs';
import { parseModelVisibleSkillCatalog, validateModelVisibleSkillCatalog } from '../src/codex-skill-catalog.lib.mjs';

const skill = name => `---\nname: ${name}\ndescription: synthetic skill\n---\nbody\n`;
const write = async (file, content) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
};
const tempRoot = async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hive-4057-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};
const promptFor = entries => JSON.stringify([{ type: 'message', content: [{ type: 'input_text', text: `<skills_instructions>\n### Available skills\n${entries.map(([name, file]) => `- ${name}: synthetic (file: ${file})`).join('\n')}\n</skills_instructions>` }] }]);

// Same shape as the failing downstream checkout: ten `.agents/skills`, one
// `.codex/skills`, and `.claude/skills` symlinks Codex does not read.
const makeCheckout = async root => {
  const projectDir = path.join(root, 'gh-issue-solver-checkout');
  const skills = [];
  for (let index = 1; index <= 10; index += 1) {
    const name = `repo-agents-skill-${index}`;
    skills.push([name, await write(path.join(projectDir, '.agents', 'skills', name, 'SKILL.md'), skill(name))]);
  }
  skills.push(['repo-codex-skill', await write(path.join(projectDir, '.codex', 'skills', 'repo-codex-skill', 'SKILL.md'), skill('repo-codex-skill'))]);
  await mkdir(path.join(projectDir, '.claude', 'skills'), { recursive: true });
  await symlink(path.join('..', '..', '.agents', 'skills', 'repo-agents-skill-1'), path.join(projectDir, '.claude', 'skills', 'repo-agents-skill-1'));
  await writeFile(path.join(projectDir, 'AGENTS.md'), '# Synthetic repository\n');
  return { projectDir, skills };
};

test('every repository skill from the failing layout is admitted without an issue requirement', async t => {
  const root = await tempRoot(t);
  const codexHome = path.join(root, 'codex-home');
  await mkdir(path.join(codexHome, 'skills', '.system'), { recursive: true });
  const { projectDir, skills } = await makeCheckout(root);
  const validation = await validateModelVisibleSkillCatalog({ catalog: parseModelVisibleSkillCatalog(promptFor(skills)), codexHome, projectDir, requiredSkills: [] });
  assert.deepEqual(validation.violations, []);
  assert.deepEqual(validation.rejected, []);
  assert.equal(validation.allowed.length, 11);
  assert.ok(validation.allowed.every(entry => entry.providerId === 'repository'));
});

test('host and out-of-checkout skills are refused with their origin', async t => {
  const root = await tempRoot(t);
  const codexHome = path.join(root, 'codex-home');
  await mkdir(codexHome, { recursive: true });
  const { projectDir } = await makeCheckout(root);
  const hostSkill = await write(path.join(root, 'home', '.agents', 'skills', 'host-only', 'SKILL.md'), skill('host-only'));
  await write(path.join(root, 'outside', 'linked', 'SKILL.md'), skill('linked'));
  await symlink(path.join(root, 'outside', 'linked'), path.join(projectDir, '.agents', 'skills', 'linked'));
  const linked = path.join(projectDir, '.agents', 'skills', 'linked', 'SKILL.md');
  const validation = await validateModelVisibleSkillCatalog({
    catalog: parseModelVisibleSkillCatalog(
      promptFor([
        ['host-only', hostSkill],
        ['linked', linked],
      ])
    ),
    codexHome,
    projectDir,
  });
  assert.equal(validation.allowed.length, 0);
  assert.deepEqual(
    validation.rejected.map(entry => [entry.name, entry.origin]),
    [
      ['host-only', 'host'],
      ['linked', 'host'],
    ]
  );
  assert.equal(validation.rejected[1].path, linked, 'the rendered path is kept for the Codex config key');
  assert.match(validation.violations[0], /\(origin: host\)/u);
});

test('a repository skill linked from .agents/skills into .claude/skills is admitted; other checkout files are not', async t => {
  // Hive Mind's own handoff and Playwright skills use this layout, and Codex
  // renders the `.agents/skills` path while the file lives in `.claude/skills`.
  const root = await tempRoot(t);
  const codexHome = path.join(root, 'codex-home');
  await mkdir(codexHome, { recursive: true });
  const { projectDir } = await makeCheckout(root);
  await write(path.join(projectDir, '.claude', 'skills', 'claude-first', 'SKILL.md'), skill('claude-first'));
  await symlink(path.join('..', '..', '.claude', 'skills', 'claude-first'), path.join(projectDir, '.agents', 'skills', 'claude-first'));
  const stray = await write(path.join(projectDir, 'docs', 'stray', 'SKILL.md'), skill('stray'));
  const validation = await validateModelVisibleSkillCatalog({
    catalog: parseModelVisibleSkillCatalog(
      promptFor([
        ['claude-first', path.join(projectDir, '.agents', 'skills', 'claude-first', 'SKILL.md')],
        ['stray', stray],
      ])
    ),
    codexHome,
    projectDir,
  });
  assert.deepEqual(
    validation.allowed.map(entry => [entry.name, entry.providerId]),
    [['claude-first', 'repository']]
  );
  assert.deepEqual(
    validation.rejected.map(entry => [entry.name, entry.origin]),
    [['stray', 'checkout']]
  );
});

test('disableScopedCodexSkills writes per-task entries idempotently and never weakens an existing one', async t => {
  const root = await tempRoot(t);
  const codexHome = path.join(root, 'codex-home');
  await write(path.join(codexHome, 'config.toml'), 'model = "gpt-5"\n\n[[skills.config]]\npath = "/host/b/SKILL.md"\nenabled = true\n');
  const skills = [
    { name: 'a', path: '/host/link/a/SKILL.md', canonical: '/host/a/SKILL.md', origin: 'host' },
    { name: 'b', path: '/host/b/SKILL.md', canonical: '/host/b/SKILL.md', origin: 'host' },
  ];
  const first = await disableScopedCodexSkills({ codexHome, skills });
  assert.deepEqual(
    first.map(entry => entry.name),
    ['a', 'b']
  );
  const config = parseToml(await readFile(path.join(codexHome, 'config.toml'), 'utf8'));
  assert.equal(config.model, 'gpt-5');
  assert.deepEqual(
    config.skills.config.map(entry => ({ ...entry })),
    [
      { path: '/host/b/SKILL.md', enabled: false },
      { path: '/host/link/a/SKILL.md', enabled: false },
      { path: '/host/a/SKILL.md', enabled: false },
    ]
  );
  assert.deepEqual(await disableScopedCodexSkills({ codexHome, skills }), [], 'nothing left to disable, so the caller fails closed');
});

// A fake Codex that honours `[[skills.config]] enabled = false` the way
// codex-cli 0.166.0 does (verified by experiments/issue-4057).
const fakeCodex = ({ candidates, honourConfig = true }) => {
  const probes = [];
  const runCommand = async ({ command, args, env }) => {
    if (command === 'gh' && args[1]?.endsWith('/comments')) return { stdout: '[]', stderr: '', code: 0 };
    if (command === 'gh') return { stdout: JSON.stringify({ title: 'Task', body: 'Routine maintenance.' }), stderr: '', code: 0 };
    if (args[0] === 'debug' && args[1] === 'prompt-input') {
      let disabled = new Set();
      if (honourConfig) {
        const config = parseToml(await readFile(path.join(env.CODEX_HOME, 'config.toml'), 'utf8').catch(() => ''));
        disabled = new Set((config.skills?.config || []).filter(entry => entry.enabled === false).map(entry => entry.path));
      }
      const visible = candidates.filter(([, file]) => !disabled.has(file));
      probes.push(visible.map(([name]) => name));
      return { stdout: promptFor(visible), stderr: '', code: 0 };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  return { probes, runCommand };
};

const runPreflight = async ({ root, projectDir, codex, logs }) => {
  const baseCodexHome = path.join(root, 'operator-codex-home');
  await write(path.join(baseCodexHome, 'config.toml'), 'model = "gpt-5"\n');
  return runCodexCapabilityPreflight({ owner: 'fixture', repo: 'issue-4057', issueNumber: 4057, projectDir, baseCodexHome, env: { PATH: process.env.PATH }, runCommand: codex.runCommand, log: async message => logs.push(String(message)) });
};

test('preflight disables a host skill for the task only and keeps every repository skill', async t => {
  const root = await tempRoot(t);
  const { projectDir, skills } = await makeCheckout(root);
  const hostSkill = await write(path.join(root, 'home', '.agents', 'skills', 'host-only', 'SKILL.md'), skill('host-only'));
  const codex = fakeCodex({ candidates: [...skills, ['host-only', hostSkill]] });
  const logs = [];
  const result = await runPreflight({ root, projectDir, codex, logs });
  t.after(() => result.dispose?.());
  assert.equal(result.skillCatalog.length, 11);
  assert.ok(!result.skillCatalog.some(entry => entry.name === 'host-only'));
  assert.equal(codex.probes.length, 2, 'the catalog is probed again after disabling');
  assert.ok(logs.some(line => /Disabled 1 skill\(s\) outside the task allowlist for this task only: host-only \(host\)/u.test(line)));
  assert.ok(logs.some(line => /Trusted skill roots: .*\.agents[\\/]skills/u.test(line)));
  const scoped = parseToml(await readFile(path.join(result.codexHome, 'config.toml'), 'utf8'));
  assert.ok(scoped.skills.config.some(entry => entry.path === hostSkill && entry.enabled === false));
  const operator = await readFile(path.join(root, 'operator-codex-home', 'config.toml'), 'utf8');
  assert.equal(operator, 'model = "gpt-5"\n', 'the operator configuration is never modified');
  assert.equal(await readFile(hostSkill, 'utf8'), skill('host-only'), 'the host skill itself is untouched');
});

test('preflight still fails closed when Codex keeps showing a refused skill', async t => {
  const root = await tempRoot(t);
  const { projectDir, skills } = await makeCheckout(root);
  const hostSkill = await write(path.join(root, 'home', '.agents', 'skills', 'host-only', 'SKILL.md'), skill('host-only'));
  const codex = fakeCodex({ candidates: [...skills, ['host-only', hostSkill]], honourConfig: false });
  const failure = await runPreflight({ root, projectDir, codex, logs: [] }).then(
    () => null,
    error => error
  );
  assert.ok(failure instanceof CodexCapabilityPreflightError);
  assert.equal(failure.details.securityBoundary, true);
  assert.match(failure.message, /host-only.*\(origin: host\)/u);
});
