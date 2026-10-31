// Finite owner-death controls of the actual native plan filesystem service.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { Storage, StandardFileSystemService } = await import(process.env.NATIVE_MODULE);
const root = process.env.FIXTURE_ROOT;
const [phase, scenario, point] = process.argv.slice(2);
const storage = new Storage(path.join(root, 'workspace'), 'SYNTHETIC_PLAN_PUBLICATION');
const service = new StandardFileSystemService();
if (phase === 'unsafe') {
  const refusal = /Gemini canonical conversation history is unavailable or unsafe[.]/u;
  await assert.rejects(async () => {
    await storage.initialize();
    storage.getPlansDir();
  }, refusal);
  const file = JSON.parse(fs.readFileSync(path.join(root, 'death.json'), 'utf8')).file;
  await assert.rejects(service.readTextFile(file), refusal);
  await assert.rejects(service.writeTextFile(file, 'SYNTHETIC FORBIDDEN'), refusal);
  console.log('PASS: fresh actual native plan publication refuses unsafe evidence and stays refused without protected or audit changes.');
  process.exit(0);
}
await storage.initialize();
const plans = storage.getPlansDir();
const file = path.join(plans, 'synthetic-plan.md');
const original = '# SYNTHETIC ORIGINAL PLAN 東京\n';
const replacement = original + '- Preserve the complete interrupted generation café 🐝.\n';
const journal = () => [...fs.readdirSync(path.join(root, 'canonical/projects'))].map(project => path.join(root, 'canonical/projects', project, 'message-history/prompt-history.json')).find(file => fs.existsSync(file));
const entries = () => JSON.parse(fs.readFileSync(journal(), 'utf8')).filter(row => row.type === 'plan-document');

if (phase === 'live') {
  await service.writeTextFile(file, original);
  const audit = fs.readFileSync(journal());
  const synchronize = fs.fsyncSync;
  let injected;
  fs.fsyncSync = fd => {
    synchronize(fd);
    const selected = fs.readlinkSync('/proc/self/fd/' + fd);
    if (injected || !path.basename(selected).startsWith('.plan-data-')) return;
    const bytes = fs.readFileSync(selected);
    const inode = fs.statSync(selected).ino;
    const protectedFile = path.join(root, 'protected-stage');
    fs.renameSync(selected, protectedFile);
    fs.writeFileSync(selected, bytes, { mode: 0o600 });
    injected = { selected, bytes, inode, protectedFile, substituted: fs.statSync(selected).ino };
  };
  await assert.rejects(service.writeTextFile(file, replacement), /Gemini canonical conversation history is unavailable or unsafe[.]/u, 'Live native plan staging replacement must refuse before journal publication.');
  assert.ok(injected);
  assert.equal(fs.statSync(injected.protectedFile).ino, injected.inode);
  assert.deepEqual(fs.readFileSync(injected.protectedFile), injected.bytes);
  assert.equal(fs.statSync(injected.selected).ino, injected.substituted);
  assert.deepEqual(fs.readFileSync(injected.selected), injected.bytes);
  assert.deepEqual(fs.readFileSync(journal()), audit);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  console.log('PASS: actual native plan writer refuses live staging substitution before publishing a new audit generation, preserving original and substituted data.');
  process.exit(0);
}

if (phase === 'owner') {
  if (scenario === 'replacement') await service.writeTextFile(file, original);
  const synchronize = fs.fsyncSync;
  fs.fsyncSync = fd => {
    synchronize(fd);
    const selected = fs.readlinkSync('/proc/self/fd/' + fd);
    if (!fs.statSync(selected).isDirectory()) return;
    const recorded = journal();
    const matching = (point === 'after-journal' && recorded && path.dirname(recorded) === selected && entries().some(row => JSON.parse(row.message).content === replacement)) || (point === 'after-publish' && selected === plans && fs.existsSync(file) && fs.readFileSync(file, 'utf8') === replacement) || (point === 'after-intent' && selected === plans && fs.existsSync(path.join(plans, '.plan-transaction.json')));
    if (!matching) return;
    fs.writeFileSync(path.join(root, 'death.json'), JSON.stringify({ file, point }), { mode: 0o600 });
    process.kill(process.pid, 'SIGKILL');
    throw new Error('Unreachable after bounded native plan publication owner death.');
  };
  await service.writeTextFile(file, replacement);
  throw new Error('The selected finite native plan publication crash point was not reached.');
}

assert.equal(await service.readTextFile(file), replacement, 'Fresh native plan reads must recover the complete interrupted journal/file publication.');
assert.deepEqual(
  entries().map(row => JSON.parse(row.message).content),
  scenario === 'replacement' ? [original, replacement] : [replacement]
);
assert.equal(
  fs.readdirSync(plans).some(name => name.startsWith('.plan-')),
  false
);
console.log('PASS: fresh actual native plan read recovers ' + scenario + ' at ' + point + ' after owner death and whole private-home disposal, retaining every complete journal generation.');
