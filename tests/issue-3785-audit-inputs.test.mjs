/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'hive-3785-audit-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await writeFile(path.join(home, '.codex', 'config.toml'), '[features]\nremote_plugin = false\nplugins = false\napps = false\n');
  return home;
}

test('malformed global JSON stops repair without exposing input or changing other state', async t => {
  const home = await fixture(t);
  const settings = path.join(home, '.claude', 'settings.json');
  const input = '{"private-audit-sentinel":';
  await writeFile(settings, input);
  const skill = path.join(home, '.claude', 'skills', 'unapproved', 'SKILL.md');
  await mkdir(path.dirname(skill), { recursive: true });
  await writeFile(skill, 'keep until safe repair');
  await assert.rejects(runAgentConfigAudit({ homeDir: home }), error => /unsafe|invalid|unparseable/i.test(error.message) && !error.message.includes('sentinel'));
  assert.equal(await readFile(settings, 'utf8'), input);
  assert.equal(await readFile(skill, 'utf8'), 'keep until safe repair');
});

for (const kind of ['symlink', 'hardlink']) {
  test(`${kind} from settings into credentials is rejected before repair`, async t => {
    const home = await fixture(t);
    const auth = path.join(home, '.claude', '.credentials.json');
    const input = '{"enabledPlugins":{"unapproved":true},"syntheticCredential":"preserve"}\n';
    await writeFile(auth, input);
    const identity = await stat(auth);
    await (kind === 'symlink' ? symlink : link)(auth, path.join(home, '.claude', 'settings.json'));
    const error = await runAgentConfigAudit({ homeDir: home }).then(
      () => null,
      failure => failure
    );
    assert.ok((await readFile(auth, 'utf8')) === input, 'protected credential bytes must remain unchanged');
    assert.ok((await stat(auth)).ino === identity.ino, 'protected credential inode must remain unchanged');
    assert.match(error?.message || '', /unsafe|link/i);
  });
}

test('a linked plugin ancestor cannot redirect cleanup into conversation storage', async t => {
  const home = await fixture(t);
  const history = path.join(home, '.claude', 'projects');
  const transcript = path.join(history, 'cache', 'project', 'session.jsonl');
  await mkdir(path.dirname(transcript), { recursive: true });
  await writeFile(transcript, 'synthetic conversation');
  await symlink(history, path.join(home, '.claude', 'plugins'));
  const error = await runAgentConfigAudit({ homeDir: home }).then(
    () => null,
    failure => failure
  );
  assert.ok(
    await stat(transcript).then(
      () => true,
      () => false
    ),
    'protected conversation must survive cleanup'
  );
  assert.ok((await readFile(transcript, 'utf8')) === 'synthetic conversation', 'protected conversation bytes must remain unchanged');
  assert.match(error?.message || '', /unsafe|link/i);
});

test('unreadable audit surfaces stop repair rather than becoming an empty catalog', async t => {
  const home = await fixture(t);
  const fs = (await import('node:fs')).default;
  const fsImpl = { ...fs, promises: { ...fs.promises } };
  let denied = false;
  fsImpl.promises.lstat = async (target, options) => {
    if (target === path.join(home, '.claude', 'plugins')) {
      denied = true;
      throw Object.assign(new Error('private-audit-sentinel'), { code: 'EACCES' });
    }
    return fs.promises.lstat(target, options);
  };
  await assert.rejects(runAgentConfigAudit({ homeDir: home, fsImpl }), error => /unsafe|unreadable/i.test(error.message) && !error.message.includes('sentinel'));
  assert.equal(denied, true);
});

test('unreadable Codex configuration stops every repair', async t => {
  const home = await fixture(t);
  const config = path.join(home, '.codex', 'config.toml');
  const skill = path.join(home, '.codex', 'skills', 'unapproved', 'SKILL.md');
  await mkdir(path.dirname(skill), { recursive: true });
  await writeFile(skill, 'preserve until configuration can be inspected');
  const fs = (await import('node:fs')).default;
  const denied = () => Object.assign(new Error('private-audit-sentinel'), { code: 'EACCES' });
  const fsImpl = {
    ...fs,
    promises: {
      ...fs.promises,
      open: (target, ...options) => {
        if (target === config) throw denied();
        return fs.promises.open(target, ...options);
      },
    },
    readFileSync: (target, ...options) => {
      if (target === config) throw denied();
      return fs.readFileSync(target, ...options);
    },
  };
  await assert.rejects(runAgentConfigAudit({ homeDir: home, fsImpl }), error => /unsafe|unreadable/i.test(error.message) && !error.message.includes('sentinel'));
  assert.equal(await readFile(skill, 'utf8'), 'preserve until configuration can be inspected');
});

test('a concurrent configuration edit invalidates the repair plan', async t => {
  const home = await fixture(t);
  const settings = path.join(home, '.claude', 'settings.json');
  await writeFile(settings, '{"enabledPlugins":{"unapproved":true}}');
  let edited = false;
  const replacement = '{"enabledPlugins":{"new-task":true},"model":"new-value"}';
  await assert.rejects(
    runAgentConfigAudit({
      homeDir: home,
      log: async () => {
        if (edited) return;
        edited = true;
        await writeFile(settings, replacement);
      },
    }),
    /unsafe/i
  );
  assert.equal(await readFile(settings, 'utf8'), replacement);
});

test('a concurrent file creation prevents empty-parent pruning', async t => {
  const home = await fixture(t);
  const skills = path.join(home, '.codex', 'skills');
  const extra = path.join(skills, 'unapproved', 'SKILL.md');
  await mkdir(path.dirname(extra), { recursive: true });
  await writeFile(extra, 'synthetic skill');
  const fs = (await import('node:fs')).default;
  const concurrent = path.join(skills, '.new-runtime');
  let injected = false;
  const fsImpl = {
    ...fs,
    readdirSync: (target, options) => {
      const children = fs.readdirSync(target, options);
      if (target === skills && children.length === 0 && !injected) {
        injected = true;
        fs.writeFileSync(concurrent, 'synthetic concurrent state');
      }
      return children;
    },
  };
  const result = await runAgentConfigAudit({ homeDir: home, fsImpl });
  assert.equal(injected, true);
  assert.ok(
    await stat(concurrent).then(
      () => true,
      () => false
    ),
    'a directory populated after inspection must survive pruning'
  );
  assert.equal(result.failed.length, 1, 'the obsolete pruning operation must fail');
});

test('unattested hidden stock stops repair before any extension or protected file changes', async t => {
  const home = await fixture(t);
  const stock = path.join(home, '.codex', 'skills', '.system', 'stock', 'SKILL.md');
  const extra = path.join(home, '.codex', 'skills', 'unapproved', 'SKILL.md');
  for (const file of [stock, extra]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'synthetic skill');
  }
  await assert.rejects(runAgentConfigAudit({ homeDir: home }), /unsafe|stock|configuration/);
  assert.ok(
    await stat(stock).then(
      () => true,
      () => false
    ),
    'unattested stock content must remain available for operator review'
  );
  assert.equal(
    await stat(extra).then(
      () => true,
      () => false
    ),
    true,
    'no unrelated repair is allowed before stock content can be verified'
  );
});

test('malformed TOML stops repair without exposing configuration or changing other state', async t => {
  const home = await fixture(t);
  const config = path.join(home, '.codex', 'config.toml');
  const input = '[features\nprivate_audit_sentinel = "do not log"\n';
  const skill = path.join(home, '.claude', 'skills', 'unapproved', 'SKILL.md');
  await mkdir(path.dirname(skill), { recursive: true });
  await writeFile(skill, 'preserve until configuration can be parsed');
  await writeFile(config, input);
  await assert.rejects(runAgentConfigAudit({ homeDir: home }), error => /unsafe|invalid|unparseable/i.test(error.message) && !error.message.includes('sentinel'));
  assert.equal(await readFile(config, 'utf8'), input);
  assert.equal(await readFile(skill, 'utf8'), 'preserve until configuration can be parsed');
});

test('configuration growth after the size check cannot trigger an unbounded read', async t => {
  const home = await fixture(t);
  const config = path.join(home, '.claude', 'settings.json');
  await writeFile(config, '{}');
  const fs = (await import('node:fs')).default;
  let bytesRead = 0;
  let grown = false;
  const fsImpl = {
    ...fs,
    promises: {
      ...fs.promises,
      open: async (target, ...options) => {
        const handle = await fs.promises.open(target, ...options);
        if (target !== config) return handle;
        return {
          stat: async options => {
            const info = await handle.stat(options);
            if (!grown) {
              grown = true;
              // Finite 2 MiB fixture models growth after the descriptor check.
              await writeFile(config, '{}' + ' '.repeat(2 * 1024 * 1024));
            }
            return info;
          },
          readFile: async (...args) => {
            const content = await handle.readFile(...args);
            bytesRead += Buffer.byteLength(content);
            return content;
          },
          read: async (...args) => {
            const result = await handle.read(...args);
            bytesRead += result.bytesRead;
            return result;
          },
          close: () => handle.close(),
        };
      },
    },
  };
  await assert.rejects(runAgentConfigAudit({ homeDir: home, fsImpl }), /unsafe/i);
  assert.equal(grown, true);
  assert.ok(bytesRead > 0 && bytesRead <= 1024 * 1024 + 1, 'read at most the configured limit plus one overflow byte');
});
