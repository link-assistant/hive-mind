// @hive-mind-test-suite default,pr-essential
// Issue #3785 (PR #3786 feedback): every repository may declare its own
// skills, plugins and MCP servers. They must be available to the task that
// checked the repository out, never to the host or to another task, and no
// skill or plugin is enabled by default.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse as parseToml } from 'smol-toml';

import { parseModelVisibleSkillCatalog, validateModelVisibleSkillCatalog } from '../src/codex-skill-catalog.lib.mjs';
import { CODEX_SYSTEM_SKILL_NAMES, applyRepositoryCodexConfig, readRepositoryCodexConfig } from '../src/codex-repository-config.lib.mjs';
import { materializeRepositoryClaudePlugins, mergeRepositoryMcpServers, readRepositoryClaudePluginDeclarations, readRepositoryMcpServers, resolveRepositoryClaudePluginArgs } from '../src/claude-repository-config.lib.mjs';

const tempDir = async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-repo-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

const write = async (file, content) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};

const skill = name => `---\nname: ${name}\ndescription: synthetic skill\n---\nbody\n`;

const catalogFor = entries => JSON.stringify([{ type: 'additional_tools' }, { type: 'message', content: [{ type: 'input_text', text: `<skills_instructions>\n### Available skills\n${entries.map(([name, file]) => `- ${name}: synthetic (file: ${file})`).join('\n')}\n</skills_instructions>` }] }]);

test('Codex: skills owned by the checkout are allowlisted wherever Codex discovers them', async t => {
  const root = await tempDir(t);
  const projectDir = path.join(root, 'checkout');
  const codexHome = path.join(root, 'codex-home');
  await mkdir(codexHome, { recursive: true });
  const agentsSkill = path.join(projectDir, '.agents', 'skills', 'review', 'SKILL.md');
  const codexSkill = path.join(projectDir, '.codex', 'skills', 'nested', 'deploy-helper', 'SKILL.md');
  await write(agentsSkill, skill('review'));
  // The front-matter name, not the directory name, identifies a Codex skill.
  await write(codexSkill, skill('release-notes'));
  const catalog = parseModelVisibleSkillCatalog(
    catalogFor([
      ['review', agentsSkill],
      ['release-notes', codexSkill],
    ])
  );
  const result = await validateModelVisibleSkillCatalog({ catalog, codexHome, projectDir });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(
    result.allowed.map(entry => [entry.name, entry.providerId]),
    [
      ['release-notes', 'repository'],
      ['review', 'repository'],
    ]
  );
});

test('Codex: a repository skill that resolves outside the checkout is refused', async t => {
  const root = await tempDir(t);
  const projectDir = path.join(root, 'checkout');
  const hostSkill = path.join(root, 'host', 'secret', 'SKILL.md');
  await write(hostSkill, skill('secret'));
  await mkdir(path.join(projectDir, '.agents', 'skills'), { recursive: true });
  await symlink(path.dirname(hostSkill), path.join(projectDir, '.agents', 'skills', 'secret'));
  await mkdir(path.join(root, 'codex-home'), { recursive: true });
  const catalog = parseModelVisibleSkillCatalog(catalogFor([['secret', path.join(projectDir, '.agents', 'skills', 'secret', 'SKILL.md')]]));
  const result = await validateModelVisibleSkillCatalog({ catalog, codexHome: path.join(root, 'codex-home'), projectDir });
  assert.equal(result.allowed.length, 0);
  assert.match(result.violations.join('\n'), /secret.*not allowlisted/u);
});

test('Codex: a prompt with no skills block is an empty catalog, other shapes stay uncertain', () => {
  const empty = parseModelVisibleSkillCatalog(
    JSON.stringify([
      { type: 'additional_tools', tools: [] },
      { type: 'message', content: [] },
    ])
  );
  assert.deepEqual(empty, { entries: [], errors: [], roots: {} });
  assert.equal(parseModelVisibleSkillCatalog(JSON.stringify({ text: 'prompt without a skill catalog' })), null);
  assert.equal(parseModelVisibleSkillCatalog('plain text'), null);
  assert.equal(parseModelVisibleSkillCatalog(JSON.stringify([{ type: 'message', text: 'mentions skills_instructions but no block' }])), null);
});

test('Codex: bundled system skills are disabled per task unless required or opted in', async t => {
  const root = await tempDir(t);
  const codexHome = path.join(root, 'codex-home');
  await write(path.join(codexHome, 'config.toml'), 'model = "operator-model"\n');
  assert.ok(CODEX_SYSTEM_SKILL_NAMES.includes('skill-installer'));

  const applied = await applyRepositoryCodexConfig({ codexHome, projectDir: path.join(root, 'none'), env: {}, requiredSkills: ['imagegen'] });
  assert.deepEqual(
    applied.disabledSystemSkills,
    CODEX_SYSTEM_SKILL_NAMES.filter(name => name !== 'imagegen')
  );
  const config = parseToml(await readFile(path.join(codexHome, 'config.toml'), 'utf8'));
  assert.equal(config.model, 'operator-model');
  const disabled = config.skills.config.filter(entry => entry.enabled === false).map(entry => path.basename(path.dirname(entry.path)));
  assert.ok(disabled.includes('skill-installer'));
  assert.ok(!disabled.includes('imagegen'));

  const optedIn = path.join(root, 'opted-in');
  await write(path.join(optedIn, 'config.toml'), '');
  assert.deepEqual((await applyRepositoryCodexConfig({ codexHome: optedIn, projectDir: path.join(root, 'none'), env: { HIVE_MIND_CODEX_SYSTEM_SKILLS: '1' } })).disabledSystemSkills, []);
});

test('Codex: only an allowlisted subset of the repository config reaches the task home', async t => {
  const root = await tempDir(t);
  const projectDir = path.join(root, 'checkout');
  const codexHome = path.join(root, 'codex-home');
  await write(path.join(projectDir, '.codex', 'skills', 'x', 'SKILL.md'), skill('x'));
  await write(path.join(projectDir, '.codex', 'config.toml'), ['model_provider = "repository-provider"', 'sandbox_mode = "danger-full-access"', '[mcp_servers.docs]', 'command = "docs-mcp"', '[mcp_servers.playwright]', 'command = "repository-playwright"', '[mcp_servers.broken]', 'enabled = true', '[[skills.config]]', 'path = "skills/x/SKILL.md"', 'enabled = false', '[[skills.config]]', 'path = "../../outside/SKILL.md"', 'enabled = true', '[plugins."helper@market"]', 'enabled = true', '[plugins."off@market"]', 'enabled = false', ''].join('\n'));
  await write(path.join(codexHome, 'config.toml'), '[mcp_servers.playwright]\ncommand = "operator-playwright"\n');

  const declaration = await readRepositoryCodexConfig({ projectDir });
  assert.deepEqual(Object.keys(declaration.mcpServers).sort(), ['docs', 'playwright']);
  assert.deepEqual(declaration.plugins, ['helper@market']);
  assert.equal(declaration.skillConfigs.length, 1);
  assert.match(declaration.warnings.join('\n'), /model_provider, sandbox_mode were not applied/u);
  assert.match(declaration.warnings.join('\n'), /outside the checkout/u);

  const applied = await applyRepositoryCodexConfig({ codexHome, projectDir, env: {}, repositoryConfig: declaration });
  assert.deepEqual(applied.addedServers, ['docs']);
  assert.deepEqual(applied.shadowedServers, ['playwright']);
  const config = parseToml(await readFile(path.join(codexHome, 'config.toml'), 'utf8'));
  assert.equal(config.mcp_servers.playwright.command, 'operator-playwright');
  assert.equal(config.mcp_servers.docs.command, 'docs-mcp');
  assert.equal(config.model_provider, undefined);
  assert.equal(config.sandbox_mode, undefined);
  assert.ok(config.skills.config.some(entry => entry.path.endsWith(path.join('.codex', 'skills', 'x', 'SKILL.md')) && entry.enabled === false));
});

test('Claude: repository .mcp.json servers join the session config, operator servers win', async t => {
  const projectDir = await tempDir(t);
  await write(path.join(projectDir, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { command: 'docs-mcp' }, playwright: { command: 'repository-playwright' }, 'claude.ai Gmail': { url: 'https://example.invalid' }, invalid: {} } }));
  const { servers, warnings } = await readRepositoryMcpServers({ projectDir });
  assert.deepEqual(Object.keys(servers).sort(), ['claude.ai Gmail', 'docs', 'playwright']);
  assert.match(warnings.join('\n'), /invalid/u);
  const merged = mergeRepositoryMcpServers({ operatorServers: { playwright: { command: 'operator-playwright' } }, repositoryServers: servers, exclude: name => name.startsWith('claude.ai') });
  assert.deepEqual(merged.servers, { playwright: { command: 'operator-playwright' }, docs: { command: 'docs-mcp' } });
  assert.deepEqual(merged.added, ['docs']);
  assert.deepEqual(merged.shadowed, ['playwright']);
  assert.deepEqual((await readRepositoryMcpServers({ projectDir: await tempDir(t) })).servers, {});
});

test('Claude: a .mcp.json symlink that leaves the checkout is ignored', async t => {
  const root = await tempDir(t);
  const projectDir = path.join(root, 'checkout');
  await write(path.join(root, 'host.json'), JSON.stringify({ mcpServers: { host: { command: 'host-only' } } }));
  await mkdir(projectDir);
  await symlink(path.join(root, 'host.json'), path.join(projectDir, '.mcp.json'));
  const { servers, warnings } = await readRepositoryMcpServers({ projectDir });
  assert.deepEqual(servers, {});
  assert.match(warnings.join('\n'), /outside the checkout/u);
});

test('Claude: repository plugins resolve to per-session --plugin-dir arguments', async t => {
  const projectDir = await tempDir(t);
  await write(
    path.join(projectDir, '.claude', 'settings.json'),
    JSON.stringify({
      enabledPlugins: { 'local@repo-market': true, 'remote@repo-market': true, 'subdir@repo-market': true, 'disabled@repo-market': false, 'unknown@other-market': true },
      extraKnownMarketplaces: { 'repo-market': { source: { source: 'directory', path: './market' } } },
    })
  );
  await write(
    path.join(projectDir, 'market', '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'repo-market',
      plugins: [
        { name: 'local', source: './plugins/local' },
        { name: 'remote', source: { source: 'github', repo: 'example/remote-plugin', ref: 'v1' } },
        { name: 'subdir', source: { source: 'git-subdir', url: 'https://example.invalid/mono.git', path: 'plugins/subdir', sha: 'a'.repeat(40) } },
      ],
    })
  );
  await write(path.join(projectDir, 'market', 'plugins', 'local', '.claude-plugin', 'plugin.json'), '{"name":"local"}');

  const declarations = await readRepositoryClaudePluginDeclarations({ projectDir });
  assert.deepEqual(
    declarations.plugins.map(plugin => plugin.id),
    ['local@repo-market', 'remote@repo-market', 'subdir@repo-market', 'unknown@other-market']
  );

  const clones = [];
  const clone = async ({ url, ref, sha, destination }) => {
    clones.push({ url, ref, sha });
    await mkdir(path.join(destination, 'plugins', 'subdir'), { recursive: true });
  };
  const workDir = await tempDir(t);
  const result = await materializeRepositoryClaudePlugins({ projectDir, workDir, declarations, clone });
  assert.deepEqual(result.loaded, ['local@repo-market', 'remote@repo-market', 'subdir@repo-market']);
  assert.equal(result.pluginDirs[0], path.join(projectDir, 'market', 'plugins', 'local'));
  assert.ok(result.pluginDirs.slice(1).every(directory => directory.startsWith(workDir)));
  assert.ok(result.pluginDirs[2].endsWith(path.join('plugins', 'subdir')));
  assert.deepEqual(clones, [
    { url: 'https://github.com/example/remote-plugin.git', ref: 'v1', sha: undefined },
    { url: 'https://example.invalid/mono.git', ref: undefined, sha: 'a'.repeat(40) },
  ]);
  assert.match(result.warnings.join('\n'), /unknown@other-market was not loaded/u);

  const { args, cleanup } = await resolveRepositoryClaudePluginArgs({ projectDir, clone });
  assert.deepEqual(args.slice(0, 2), ['--plugin-dir', path.join(projectDir, 'market', 'plugins', 'local')]);
  await cleanup();
});

test('Claude: a checkout without declarations adds no plugins and creates no directories', async t => {
  const projectDir = await tempDir(t);
  const result = await resolveRepositoryClaudePluginArgs({ projectDir, clone: async () => assert.fail('nothing to clone') });
  assert.deepEqual(result.args, []);
});

test('Claude: a directory marketplace cannot point outside the checkout', async t => {
  const root = await tempDir(t);
  const projectDir = path.join(root, 'checkout');
  await write(path.join(root, 'outside', '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'p', source: './' }] }));
  await write(path.join(projectDir, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'p@m': true }, extraKnownMarketplaces: { m: { source: { source: 'directory', path: '../outside' } } } }));
  const result = await materializeRepositoryClaudePlugins({ projectDir, workDir: await tempDir(t) });
  assert.deepEqual(result.pluginDirs, []);
  assert.match(result.warnings.join('\n'), /outside the checkout/u);
});

// Recursively lists every entry with its size so writes, creations and
// deletions in a directory tree are all detected.
const snapshotTree = async root => {
  const { readdir, lstat } = await import('node:fs/promises');
  const entries = [];
  const walk = async directory => {
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name);
      const info = await lstat(file);
      entries.push(`${path.relative(root, file)}:${info.isDirectory() ? 'dir' : info.size}`);
      if (info.isDirectory()) await walk(file);
    }
  };
  await walk(root);
  return entries;
};

test('two tasks with different repository declarations never touch the host or each other', async t => {
  const root = await tempDir(t);
  const host = path.join(root, 'host');
  await write(path.join(host, '.claude', 'settings.json'), '{"enabledPlugins":{}}');
  await write(path.join(host, '.claude.json'), '{"mcpServers":{}}');
  await write(path.join(host, '.codex', 'config.toml'), '[mcp_servers.playwright]\ncommand = "operator-playwright"\n');
  await write(path.join(host, '.codex', 'auth.json'), 'synthetic-host-auth');
  const saved = Object.fromEntries(['HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { HOME: host, CODEX_HOME: path.join(host, '.codex'), CLAUDE_CONFIG_DIR: path.join(host, '.claude'), XDG_CONFIG_HOME: path.join(host, '.config'), XDG_DATA_HOME: path.join(host, '.local', 'share') });
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const hostBefore = await snapshotTree(host);

  const tasks = {};
  for (const name of ['alpha', 'beta']) {
    const projectDir = path.join(root, `${name}-checkout`);
    const codexHome = path.join(root, `${name}-codex-home`);
    await write(path.join(codexHome, 'config.toml'), '[mcp_servers.playwright]\ncommand = "operator-playwright"\n');
    await write(path.join(projectDir, '.agents', 'skills', `${name}-skill`, 'SKILL.md'), skill(`${name}-skill`));
    await write(path.join(projectDir, '.codex', 'config.toml'), `[mcp_servers.${name}-docs]\ncommand = "${name}-mcp"\n`);
    await write(path.join(projectDir, '.mcp.json'), JSON.stringify({ mcpServers: { [`${name}-claude-docs`]: { command: `${name}-claude-mcp` } } }));
    await write(path.join(projectDir, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { [`${name}@${name}-market`]: true }, extraKnownMarketplaces: { [`${name}-market`]: { source: { source: 'directory', path: './market' } } } }));
    await write(path.join(projectDir, 'market', '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: `${name}-market`, plugins: [{ name, source: `./plugins/${name}` }] }));
    await write(path.join(projectDir, 'market', 'plugins', name, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
    await applyRepositoryCodexConfig({ codexHome, projectDir, env: {}, repositoryConfig: await readRepositoryCodexConfig({ projectDir }) });
    const claude = await resolveRepositoryClaudePluginArgs({ projectDir, clone: async () => assert.fail('no remote plugins declared') });
    t.after(claude.cleanup);
    tasks[name] = { codexHome, claude, mcp: (await readRepositoryMcpServers({ projectDir })).servers };
  }

  for (const [name, other] of [
    ['alpha', 'beta'],
    ['beta', 'alpha'],
  ]) {
    const config = parseToml(await readFile(path.join(tasks[name].codexHome, 'config.toml'), 'utf8'));
    assert.equal(config.mcp_servers[`${name}-docs`].command, `${name}-mcp`);
    assert.equal(config.mcp_servers[`${other}-docs`], undefined, `${other}'s MCP server must not reach ${name}`);
    assert.equal(config.mcp_servers.playwright.command, 'operator-playwright');
    assert.deepEqual(Object.keys(tasks[name].mcp), [`${name}-claude-docs`]);
    assert.deepEqual(tasks[name].claude.loaded, [`${name}@${name}-market`]);
    assert.ok(tasks[name].claude.args.every(argument => !argument.includes(other)));
  }
  assert.deepEqual(await snapshotTree(host), hostBefore, 'repository capabilities must never be written to host configuration');
  assert.equal(await readFile(path.join(host, '.codex', 'auth.json'), 'utf8'), 'synthetic-host-auth');
});
