// Bounded actual native API recovery at publication-proof link boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';

const native = await import(process.env.NATIVE_MODULE);
const history = await import(process.env.HISTORY_MODULE);
const root = process.env.FIXTURE_ROOT;
const canonical = process.env.GEMINI_HISTORY_HOME;
const [phase, scenario, point] = process.argv.slice(2);
const text = '# SYNTHETIC COMPLETE PUBLICATION 東京 café 🐝\n';
const original = '# SYNTHETIC PRECEDING PLAN\n';
const checkpoint = { history: [{ role: 'user', parts: [{ text }] }] };
const storage = new native.Storage(path.join(root, 'workspace'), 'SYNTHETIC_ATOMIC_PROOF');
const service = new native.StandardFileSystemService();
await storage.initialize();
let armed = phase === 'owner' && scenario === 'registry';
if (phase === 'owner') {
  const synchronize = fs.fsyncSync;
  fs.fsyncSync = fd => {
    synchronize(fd);
    const selected = fs.readlinkSync('/proc/self/fd/' + fd);
    if (!armed || (!selected.startsWith(canonical + '/') && selected !== canonical) || !fs.statSync(selected).isDirectory()) return;
    for (const name of fs.readdirSync(selected)) {
      const match = /^\.publish-([a-f0-9-]+)\.json$/u.exec(name);
      if (!match) continue;
      const journal = path.join(selected, name);
      const record = JSON.parse(fs.readFileSync(journal, 'utf8'));
      const matches = scenario === 'registry' ? record.name === 'projects.json' : scenario === 'prompt' ? record.name === 'prompt-history.json' : scenario === 'checkpoint' ? record.name === 'checkpoint-history.json' : scenario === 'artifact' ? record.name.startsWith('artifact-') : scenario === 'blob' ? record.name.startsWith('blob-') : record.name === '.plan-transaction.json';
      const alias = path.join(selected, `.history-${match[1]}.journal.tmp`);
      if (!matches || fs.existsSync(alias) !== (point === 'proof-linked')) continue;
      assert.equal(fs.statSync(journal).nlink, point === 'proof-linked' ? 2 : 1);
      fs.writeFileSync(path.join(root, 'death.json'), JSON.stringify({ journal, alias, record, staged: path.join(selected, `.history-${match[1]}.tmp`), target: path.join(selected, record.name) }), { mode: 0o600 });
      process.kill(process.pid, 'SIGKILL');
      throw new Error('Unreachable after finite native proof owner death.');
    }
  };
}

async function exercise() {
  const temporary = storage.getProjectTempDir();
  const logger = new native.Logger('SYNTHETIC_ATOMIC_PROOF', storage);
  await logger.initialize();
  let file;
  if (scenario.startsWith('plan-')) {
    file = path.join(storage.getPlansDir(), 'synthetic-atomic-proof.md');
    if (phase === 'owner' && scenario === 'plan-replacement') await service.writeTextFile(file, original);
  }
  armed = phase === 'owner';
  if (phase === 'owner') {
    if (scenario === 'prompt') await logger.logMessage('user', text);
    else if (scenario === 'checkpoint') await logger.saveCheckpoint(checkpoint, 'synthetic-proof');
    else if (scenario === 'artifact') history.writeNativeGeminiToolOutput(temporary, text, 'SYNTHETIC_ATOMIC_PROOF');
    else if (scenario === 'blob') history.writeNativeGeminiBlob(temporary, Buffer.from(text).toString('base64'), 'text/plain', 'SYNTHETIC_ATOMIC_PROOF');
    else if (scenario.startsWith('plan-')) await service.writeTextFile(file, text);
    throw new Error('Finite native publication proof kill point was not reached.');
  }
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'death.json'), 'utf8'));
  if (scenario === 'registry') assert.equal(JSON.parse(fs.readFileSync(saved.target, 'utf8')).projects[path.join(root, 'workspace')], createHash('sha256').update(path.join(root, 'workspace')).digest('hex'));
  else if (scenario === 'prompt') assert.deepEqual(await logger.getPreviousUserMessages(), [text]);
  else if (scenario === 'checkpoint') assert.deepEqual(await logger.loadCheckpoint('synthetic-proof'), checkpoint);
  else if (scenario === 'artifact') assert.equal(history.readNativeGeminiToolOutput(saved.target), text);
  else if (scenario === 'blob') assert.deepEqual(history.readNativeGeminiBlob(saved.target), { bytes: Buffer.from(text), mimeType: 'text/plain' });
  else {
    assert.equal(await service.readTextFile(file), text);
    const project = path.dirname(path.dirname(path.dirname(file)));
    const journal = JSON.parse(fs.readFileSync(path.join(project, 'message-history/prompt-history.json'), 'utf8'));
    assert.deepEqual(
      journal.filter(row => row.type === 'plan-document').map(row => JSON.parse(row.message).content),
      scenario === 'plan-replacement' ? [original, text] : [text]
    );
  }
  for (const name of fs.readdirSync(path.dirname(saved.journal))) assert.ok(!/^\.(?:publish-|history-.*\.journal\.tmp$|plan-)/u.test(name));
  console.log(`PASS: fresh actual native ${scenario} recovers complete publication after ${point}, whole private-home disposal and proof alias recovery.`);
}

if (phase.startsWith('live-')) {
  const synchronize = fs.fsyncSync;
  let injected;
  fs.fsyncSync = fd => {
    synchronize(fd);
    const selected = fs.readlinkSync('/proc/self/fd/' + fd);
    if (injected || !selected.startsWith(canonical + '/') || !/\.journal\.tmp$/u.test(selected)) return;
    const bytes = fs.readFileSync(selected);
    const info = fs.statSync(selected);
    const protectedFile = path.join(root, 'protected-proof');
    const staged = selected.replace(/\.journal\.tmp$/u, '.tmp');
    const stagedBytes = fs.readFileSync(staged);
    const stagedInfo = fs.statSync(staged);
    if (phase === 'live-inode') {
      fs.renameSync(selected, protectedFile);
      fs.writeFileSync(selected, bytes, { mode: 0o600 });
    } else {
      const changed = JSON.parse(bytes);
      changed.digest = '0'.repeat(64);
      fs.writeFileSync(selected, JSON.stringify(changed));
    }
    injected = { selected, bytes, info, protectedFile, staged, stagedBytes, stagedInfo };
  };
  assert.throws(() => storage.getProjectTempDir(), /Gemini canonical conversation history is unavailable or unsafe[.]/u);
  assert.ok(injected);
  assert.equal(fs.existsSync(path.join(canonical, 'projects.json')), false);
  assert.equal(
    fs.readdirSync(canonical).some(name => name.startsWith('.publish-')),
    false
  );
  assert.equal(fs.statSync(injected.staged).ino, injected.stagedInfo.ino);
  assert.deepEqual(fs.readFileSync(injected.staged), injected.stagedBytes);
  if (phase === 'live-inode') {
    assert.equal(fs.statSync(injected.protectedFile).ino, injected.info.ino);
    assert.deepEqual(fs.readFileSync(injected.protectedFile), injected.bytes);
    assert.notEqual(fs.statSync(injected.selected).ino, injected.info.ino);
    assert.deepEqual(fs.readFileSync(injected.selected), injected.bytes);
  } else {
    assert.equal(fs.statSync(injected.selected).ino, injected.info.ino);
    assert.equal(JSON.parse(fs.readFileSync(injected.selected, 'utf8')).digest, '0'.repeat(64));
  }
  assert.throws(() => history.assertNativeGeminiHistoryCurrent(), /Gemini canonical conversation history is unavailable or unsafe[.]/u);
  console.log('PASS: actual native writer refuses live proof ' + phase + ' substitution before publishing canonical data or a visible proof.');
} else if (phase === 'unsafe') {
  await assert.rejects(exercise(), /Gemini canonical conversation history is unavailable or unsafe[.]/u);
  assert.throws(() => history.assertNativeGeminiHistoryCurrent(), /Gemini canonical conversation history is unavailable or unsafe[.]/u);
  console.log('PASS: unsafe native proof/alias/data refuses before mutation and remains refused.');
} else await exercise();
