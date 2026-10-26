/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-admission-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await writeFile(path.join(home, '.codex', 'config.toml'), '[features]\nremote_plugin = false\n');
  return home;
}

async function add(home, relative, content = 'synthetic extension') {
  const target = path.join(home, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

test('disabled repair cannot admit known global contamination', async t => {
  const home = await fixture(t);
  const skill = await add(home, '.claude/skills/unapproved/SKILL.md');
  await assert.rejects(runAgentConfigAudit({ homeDir: home, autoRepair: false, requireClean: true }), /configuration.*not clean/i);
  assert.equal(await readFile(skill, 'utf8'), 'synthetic extension');
});

test('unrepaired global commands reject admission even when repair is enabled', async t => {
  const home = await fixture(t);
  await add(home, '.claude/commands/unapproved.md');
  await assert.rejects(runAgentConfigAudit({ homeDir: home, requireClean: true }), /configuration.*not clean/i);
});

test('a failed removal rejects admission instead of logging and continuing', async t => {
  const home = await fixture(t);
  const skill = await add(home, '.claude/skills/unapproved/SKILL.md');
  const fsImpl = {
    ...fs,
    rmSync: () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    },
  };
  await assert.rejects(runAgentConfigAudit({ homeDir: home, fsImpl, requireClean: true }), /configuration.*not clean/i);
  assert.equal(await readFile(skill, 'utf8'), 'synthetic extension');
});

test('successful repair must be followed by another audit before admission', async t => {
  const home = await fixture(t);
  await add(home, '.claude/skills/unapproved/SKILL.md');
  let injected = false;
  const log = async message => {
    if (injected || !message.includes('Auto-repaired')) return;
    injected = true;
    await add(home, '.claude/commands/appeared-during-repair.md');
  };
  await assert.rejects(runAgentConfigAudit({ homeDir: home, log, requireClean: true }), /configuration.*not clean/i);
  assert.equal(injected, true);
});

test('a clean re-audit admits safe repair and preserves protected state', async t => {
  const home = await fixture(t);
  await add(home, '.claude/skills/unapproved/SKILL.md');
  const auth = await add(home, '.codex/auth.json', '{"syntheticCredential":"preserve"}');
  const history = await add(home, '.codex/sessions/rollout.jsonl', 'synthetic conversation');
  const authIdentity = await fs.promises.stat(auth);
  const result = await runAgentConfigAudit({ homeDir: home, requireClean: true });
  assert.equal(result.failed.length, 0);
  assert.equal(result.repaired.length, 1);
  assert.ok((await readFile(auth, 'utf8')) === '{"syntheticCredential":"preserve"}', 'protected credential bytes must survive');
  assert.ok((await fs.promises.stat(auth)).ino === authIdentity.ino, 'protected credential identity must survive');
  assert.ok((await readFile(history, 'utf8')) === 'synthetic conversation', 'protected conversation bytes must survive');
});

test('read-only audit keeps reporting findings without enforcing admission', async t => {
  const home = await fixture(t);
  await add(home, '.claude/commands/unapproved.md');
  const result = await runAgentConfigAudit({ homeDir: home, autoRepair: false });
  assert.equal(result.findings.length, 1);
});

test('a clean initial audit is revalidated after yielding to verbose logging', async t => {
  const home = await fixture(t);
  let injected = false;
  await assert.rejects(
    runAgentConfigAudit({
      homeDir: home,
      requireClean: true,
      verbose: true,
      log: async () => {
        if (injected) return;
        injected = true;
        await add(home, '.claude/commands/appeared-after-audit.md');
      },
    }),
    /configuration.*not clean/i
  );
  assert.equal(injected, true);
});
