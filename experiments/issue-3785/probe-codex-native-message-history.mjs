// Public native TUI history API, synthetic prompts, disposable configurations.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import console from 'node:console';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const binary = process.argv[2];
const expectPrivate = process.argv.includes('--expect-private-history');
assert.ok(binary && path.isAbsolute(binary), 'Supply the absolute native prompt-history driver.');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-native-prompts-'));
const canonical = path.join(temporary, 'canonical');
const configs = ['config-a', 'config-b'].map(name => path.join(temporary, name));
try {
  await fs.mkdir(canonical, { mode: 0o700 });
  for (const config of configs) await fs.mkdir(config, { mode: 0o700 });
  const command = async (operation, config, marker, authority = canonical) => {
    const { stdout } = await execute('prlimit', ['--data=268435456', '--stack=8388608', '--core=0', '--', binary, operation, config, ...(marker ? [marker] : [])], {
      env: { PATH: process.env.PATH, ...(authority === null ? {} : { CODEX_MESSAGE_HISTORY_HOME: authority }), TOKIO_WORKER_THREADS: '1', RUST_LOG: 'off' },
      maxBuffer: 256 * 1024,
    });
    return stdout.trim();
  };
  await command('append', configs[0], 'SYNTHETIC-PROMPT-A');
  const [firstId] = JSON.parse(await command('metadata', configs[0]));
  assert.deepEqual(JSON.parse(await command('read', configs[1])), expectPrivate ? [] : ['SYNTHETIC-PROMPT-A'], 'A native peer must discover prompts written from another private configuration.');
  await command('append', configs[1], 'SYNTHETIC-PROMPT-B');
  if (expectPrivate) {
    assert.deepEqual(JSON.parse(await command('read', configs[0])), ['SYNTHETIC-PROMPT-A']);
    assert.deepEqual(JSON.parse(await command('read', configs[1])), ['SYNTHETIC-PROMPT-B']);
    console.log('PASS: two native private configurations reproduce split TUI prompt histories.');
  } else {
    const [secondId, secondCount] = JSON.parse(await command('metadata', configs[1]));
    assert.equal(secondId, firstId, 'The logical native TUI history identifier must survive an atomic peer append.');
    assert.equal(secondCount, 2);
    assert.deepEqual(JSON.parse(await command('read', configs[0], String(firstId))), ['SYNTHETIC-PROMPT-A', 'SYNTHETIC-PROMPT-B']);
    for (const config of configs) {
      assert.deepEqual(JSON.parse(await command('read', config)), ['SYNTHETIC-PROMPT-A', 'SYNTHETIC-PROMPT-B']);
      await assert.rejects(fs.lstat(path.join(config, 'history.jsonl')), { code: 'ENOENT' });
    }
  }
  for (const config of configs) {
    await fs.rm(config, { recursive: true });
    await fs.mkdir(config, { mode: 0o700 });
  }
  for (const config of configs) assert.deepEqual(JSON.parse(await command('read', config)), expectPrivate ? [] : ['SYNTHETIC-PROMPT-A', 'SYNTHETIC-PROMPT-B'], 'Both disposed native configurations must rediscover canonical prompt history.');
  console.log(`PASS: private-configuration disposal ${expectPrivate ? 'reproduces native TUI prompt loss' : 'preserves canonical native TUI prompt history'}.`);
  if (!expectPrivate) {
    const history = path.join(canonical, 'history.jsonl');
    const lock = path.join(canonical, '.hive-message-history.lock');
    const lockBefore = await fs.stat(lock);
    const expected = ['SYNTHETIC-PROMPT-A', 'SYNTHETIC-PROMPT-B'];
    for (const round of [0, 1, 2, 3]) {
      const markers = [0, 1].map(index => `SYNTHETIC-PEER-${round}-${index}`);
      await Promise.all(configs.map((config, index) => command('append', config, markers[index])));
      expected.push(...markers);
    }
    for (const config of configs) assert.deepEqual(JSON.parse(await command('read', config, String(firstId))).sort(), [...expected].sort(), 'Concurrent native appends must retain every prompt and the original TUI identifier.');
    assert.equal(await command('reject-id', configs[0]), 'REJECTED');
    console.log('PASS: eight concurrent native appends preserve all prompts and stable TUI lookup identity; wrong identifiers refuse.');
    const holder = spawn('prlimit', ['--data=268435456', '--stack=8388608', '--core=0', '--', binary, 'hold-lock', configs[0]], {
      env: { PATH: process.env.PATH, CODEX_MESSAGE_HISTORY_HOME: canonical, TOKIO_WORKER_THREADS: '1', RUST_LOG: 'off' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const exited = new Promise(resolve => holder.once('close', resolve));
    let pending;
    try {
      await new Promise((resolve, reject) => {
        const timer = globalThis.setTimeout(() => reject(new Error('Bounded native lock owner did not become ready.')), 5000);
        holder.once('error', error => {
          globalThis.clearTimeout(timer);
          reject(error);
        });
        holder.once('close', () => {
          globalThis.clearTimeout(timer);
          reject(new Error('Native lock owner exited before readiness.'));
        });
        holder.stdout.once('data', chunk => {
          globalThis.clearTimeout(timer);
          if (chunk.toString().trim() === 'LOCKED') resolve();
          else reject(new Error('Unexpected native lock-owner diagnostic.'));
        });
      });
      let completed = false;
      pending = command('append', configs[1], 'SYNTHETIC-AFTER-OWNER-DEATH').then(result => {
        completed = true;
        return result;
      });
      // Preserve early failures for the awaited cleanup without an unhandled
      // rejection interrupting owner termination and child reaping.
      pending.catch(() => {});
      await delay(100);
      assert.equal(completed, false, 'A native peer must wait while another process owns the canonical prompt lock.');
    } finally {
      holder.kill('SIGKILL');
      await exited;
      if (pending) await pending;
    }
    expected.push('SYNTHETIC-AFTER-OWNER-DEATH');
    const ownerDeathLock = await fs.stat(lock);
    assert.deepEqual([ownerDeathLock.dev, ownerDeathLock.ino], [lockBefore.dev, lockBefore.ino]);
    console.log('PASS: a waiting native append completes after forced owner death without replacing the canonical lock.');
    await command('append-many', configs[0], '130');
    const paginated = [...expected].sort();
    for (const config of configs) {
      const recalled = JSON.parse(await command('read', config, String(firstId)));
      assert.deepEqual(recalled.slice(0, expected.length).sort(), paginated);
      assert.deepEqual(
        recalled.slice(expected.length),
        Array.from({ length: 130 }, (_, index) => `SYNTHETIC-PAGE-${index}`)
      );
    }
    console.log('PASS: native newest-first batch continuation recalls 141 rows across atomic publications.');
    const replacement = `${history}.replacement`;
    await fs.writeFile(replacement, `${JSON.stringify({ session_id: 'synthetic', ts: 1, text: 'SYNTHETIC-REPLACEMENT' })}\n`, { mode: 0o600 });
    await fs.rename(replacement, history);
    for (const config of configs) assert.deepEqual(JSON.parse(await command('read', config, String(firstId))), ['SYNTHETIC-REPLACEMENT']);
    await fs.unlink(history);
    await command('append', configs[1], 'SYNTHETIC-RECREATION');
    for (const config of configs) assert.deepEqual(JSON.parse(await command('read', config, String(firstId))), ['SYNTHETIC-RECREATION']);
    const lockAfter = await fs.stat(lock);
    assert.deepEqual([lockAfter.dev, lockAfter.ino], [lockBefore.dev, lockBefore.ino], 'Data replacement and recreation must never replace the canonical prompt lock.');
    console.log('PASS: atomic replacement and deletion/recreation remain visible to native prompt-history peers.');
    const refused = async label => {
      await assert.rejects(command('append', configs[0], 'MUST-NOT-APPEND'), error => error.code === 1, `${label} must refuse canonical prompt writes.`);
      console.log(`PASS: ${label} refuses native prompt-history writes.`);
    };
    await fs.chmod(history, 0o644);
    await refused('unsafe history permissions');
    await fs.chmod(history, 0o600);
    await fs.link(history, `${history}.alias`);
    await refused('hard-linked prompt history');
    await fs.unlink(`${history}.alias`);
    await fs.rename(history, `${history}.saved`);
    await fs.symlink(`${history}.saved`, history);
    await refused('symlinked prompt history');
    await fs.unlink(history);
    await fs.rename(`${history}.saved`, history);
    await fs.chmod(lock, 0o644);
    await refused('unsafe canonical prompt lock');
    await fs.chmod(lock, 0o600);
    await fs.chmod(canonical, 0o755);
    await refused('unsafe canonical prompt directory');
    await fs.chmod(canonical, 0o700);
    await fs.writeFile(path.join(configs[0], 'history.jsonl'), 'PRIVATE-COMPETING-HISTORY', { mode: 0o600 });
    await refused('private competing prompt history');
    await fs.unlink(path.join(configs[0], 'history.jsonl'));
    await fs.rename(canonical, `${canonical}.saved`);
    await refused('missing canonical prompt directory');
    await assert.rejects(fs.lstat(canonical), { code: 'ENOENT' });
    await fs.rename(`${canonical}.saved`, canonical);
    assert.deepEqual(JSON.parse(await command('read', configs[1])), ['SYNTHETIC-RECREATION'], 'Refused writes must leave canonical prompt history unchanged.');
    const alias = `${canonical}.alias`;
    await fs.symlink(canonical, alias);
    await assert.rejects(command('append', configs[0], 'MUST-NOT-APPEND', alias), error => error.code === 1);
    await assert.rejects(command('append', configs[0], 'MUST-NOT-APPEND', configs[0]), error => error.code === 1);
    await assert.rejects(command('append', configs[0], 'MUST-NOT-APPEND', 'relative-authority'), error => error.code === 1);
    for (const operation of ['append-disabled', 'append-capped']) await assert.rejects(command(operation, configs[0], 'MUST-NOT-APPEND'), error => error.code === 1);
    console.log('PASS: aliased/overlapping/relative authority and disabled/capped persistence refuse native prompt writes.');
    for (const config of configs) {
      await command('append', config, `SYNTHETIC-LEGACY-${path.basename(config)}`, null);
      assert.deepEqual(JSON.parse(await command('read', config, undefined, null)), [`SYNTHETIC-LEGACY-${path.basename(config)}`]);
    }
    assert.deepEqual(JSON.parse(await command('read', configs[1], undefined, null)), ['SYNTHETIC-LEGACY-config-b']);
    const rows = (await fs.readFile(history, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line).text);
    assert.deepEqual(rows, ['SYNTHETIC-RECREATION'], 'Legacy private mode must not modify selected canonical history.');
    console.log('PASS: absent selector retains both independent legacy native prompt histories.');
  }
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
