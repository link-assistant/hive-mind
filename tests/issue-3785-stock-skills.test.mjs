/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, link, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';
import { verifyAgentRuntimeBaseline as verifyAgentRuntime } from '../src/verify-agent-runtime.mjs';
import { createHash } from 'node:crypto';
import { CODEX_STOCK_SKILLS, validateCodexStockSkills } from '../src/codex-stock-skills.lib.mjs';

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-stock-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, '.codex', 'skills', '.system'), { recursive: true });
  await writeFile(path.join(home, '.codex', 'config.toml'), '[features]\nremote_plugin = false\n');
  const auth = path.join(home, '.codex', 'auth.json');
  await writeFile(auth, 'protected-synthetic-auth', { mode: 0o600 });
  return { home, auth, stock: path.join(home, '.codex', 'skills', '.system') };
}

for (const relative of ['operator/SKILL.md', '.operator/SKILL.md', 'imagegen/SKILL.md', '.codex-system-skills.marker']) {
  test(`unattested stock content blocks admission: ${relative}`, async t => {
    const { home, auth, stock } = await fixture(t);
    const payload = path.join(stock, relative);
    await mkdir(path.dirname(payload), { recursive: true });
    await writeFile(payload, 'unapproved-synthetic-content');
    const before = await stat(auth);
    await assert.rejects(runAgentConfigAudit({ tool: 'codex', homeDir: home, requireClean: true }), /stock|unsafe|configuration/i);
    assert.equal(await readFile(payload, 'utf8'), 'unapproved-synthetic-content');
    assert.equal(await readFile(auth, 'utf8'), 'protected-synthetic-auth');
    assert.equal((await stat(auth)).ino, before.ino);
  });
}

for (const makeLink of [symlink, link]) {
  test(`nested stock credential ${makeLink === symlink ? 'symlink' : 'hard link'} blocks admission`, async t => {
    const { home, auth, stock } = await fixture(t);
    await mkdir(path.join(stock, 'imagegen'));
    await makeLink(auth, path.join(stock, 'imagegen', 'SKILL.md'));
    await assert.rejects(runAgentConfigAudit({ tool: 'codex', homeDir: home, requireClean: true }), /stock|unsafe|configuration/i);
    assert.equal(await readFile(auth, 'utf8'), 'protected-synthetic-auth');
  });
}

test('an empty stock directory is not a pristine CLI baseline', async t => {
  const { home } = await fixture(t);
  await assert.rejects(runAgentConfigAudit({ tool: 'codex', homeDir: home, requireClean: true }), /stock|unsafe|configuration/i);
});

for (const dockerfile of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
  test(`${dockerfile} pins the CLI version used to generate the stock baseline`, async () => {
    const content = await readFile(new URL(`../${dockerfile}`, import.meta.url), 'utf8');
    const version = CODEX_STOCK_SKILLS.cliVersion.replace('codex-cli ', '');
    assert.ok(content.includes(`bun install -g @openai/codex@${version}`));
    assert.match(content, /bash \/tmp\/claude-code-install\.sh 2\.1\.310(?:\s|$)/);
  });
}

test('the bounded verifier accepts only the exact complete synthetic stock tree', async t => {
  const { stock } = await fixture(t);
  const content = 'synthetic pristine skill';
  await mkdir(path.join(stock, 'stock'));
  await writeFile(path.join(stock, 'stock', 'SKILL.md'), content);
  const manifest = { files: { 'stock/SKILL.md': createHash('sha256').update(content).digest('hex') } };
  const snapshot = await validateCodexStockSkills({ directory: stock, manifest });
  assert.equal(snapshot.size, 3);
  await writeFile(path.join(stock, 'stock', 'SKILL.md'), 'changed stock content');
  await assert.rejects(validateCodexStockSkills({ directory: stock, manifest }), /stock/);
});

test('stock verification rejects an oversized file before opening it', async t => {
  const { stock } = await fixture(t);
  const payload = path.join(stock, 'oversized');
  await writeFile(payload, Buffer.alloc(1024 * 1024 + 1));
  let opens = 0;
  const fsImpl = {
    promises: {
      ...fs.promises,
      open: async () => {
        opens++;
        throw new Error('must not open');
      },
    },
  };
  await assert.rejects(validateCodexStockSkills({ directory: stock, fsImpl, manifest: { files: { oversized: 'unused' } } }), /stock/);
  assert.equal(opens, 0);
});

test('concurrent stock edits reject verification without exposing content', async t => {
  const { stock } = await fixture(t);
  const payload = path.join(stock, 'file');
  const content = 'original synthetic stock';
  await writeFile(payload, content);
  const fsImpl = {
    promises: {
      ...fs.promises,
      open: async (...args) => {
        const handle = await fs.promises.open(...args);
        const original = handle.read.bind(handle);
        handle.read = async (...readArgs) => {
          const result = await original(...readArgs);
          await writeFile(payload, 'private_stock_sentinel');
          return result;
        };
        return handle;
      },
    },
  };
  const manifest = { files: { file: createHash('sha256').update(content).digest('hex') } };
  await assert.rejects(validateCodexStockSkills({ directory: stock, fsImpl, manifest }), error => /stock/.test(error.message) && !error.message.includes('sentinel'));
});

test('PR image builds install this branch as a package in both images', async () => {
  const build = await readFile(new URL('../scripts/docker-pr-build.sh', import.meta.url), 'utf8');
  assert.equal((build.match(/--build-arg HIVE_MIND_INSTALL_SOURCE=true/g) || []).length, 2, 'both actual image builds must select the branch package');
  for (const dockerfile of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
    const content = await readFile(new URL(`../${dockerfile}`, import.meta.url), 'utf8');
    assert.ok(content.includes('ARG HIVE_MIND_INSTALL_SOURCE=false'));
    assert.ok(content.includes('bash /tmp/hive-mind-source/scripts/install-image-package.sh'));
  }
});

test('both packaged images require a network-disabled stock-runtime gate', async () => {
  for (const dockerfile of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
    const content = await readFile(new URL(`../${dockerfile}`, import.meta.url), 'utf8');
    assert.ok(/RUN --network=none node .*verify-agent-runtime\.mjs/u.test(content), `${dockerfile} must run the installed verifier without networking`);
  }
});

for (const missing of [false, true]) {
  test(`packaged runtime rejects a native CLI that ${missing ? 'does not materialize stock' : 'materializes unapproved stock'}`, { timeout: 10000 }, async t => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-native-gate-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    await mkdir(path.join(home, '.codex'));
    await mkdir(path.join(home, '.claude'));
    await writeFile(path.join(home, '.claude/settings.json'), JSON.stringify({ syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } }));
    await writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\n');
    const claude = path.join(home, 'claude');
    const codex = path.join(home, 'codex.mjs');
    await writeFile(claude, '#!/bin/sh\nprintf "%s\\n" "2.1.310 (Claude Code)"\n', { mode: 0o700 });
    const code = `#!${process.execPath}
import fs from 'node:fs';
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-cli 0.164.0'); process.exit(0); }
readline.createInterface({input: process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'skills/list') {
    if (!${missing}) { fs.mkdirSync(process.env.CODEX_HOME + '/skills/.system', { recursive: true }); fs.writeFileSync(process.env.CODEX_HOME + '/skills/.system/extra', 'synthetic'); }
    console.log(JSON.stringify({ id: message.id, result: { data: [{}] } }));
  } else if (message.id) console.log(JSON.stringify({ id: message.id, result: {} }));
});
`;
    await writeFile(codex, code, { mode: 0o700 });
    await assert.rejects(verifyAgentRuntime({ homeDir: home, codexCommand: codex, claudeCommand: claude }), /stock|runtime/i);
  });
}
