// Bounded synthetic tests of actual native Storage and filesystem methods.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const { Storage, StandardFileSystemService, PolicyEngine, PolicyDecision, ApprovalMode } = await import(process.env.NATIVE_MODULE);
const { readNativeGeminiPlan, nativeGeminiPlanPolicyPattern } = await import(process.env.NATIVE_HELPER);
const root = process.env.FIXTURE_ROOT;
const scenario = process.env.NATIVE_SCENARIO;
const phase = process.argv[2];
const workspace = path.join(root, 'workspace');
const storage = new Storage(workspace, 'SYNTHETIC_PLAN_SESSION');
await storage.initialize();
storage.setCustomPlansDir('private-custom-plans');
const plans = storage.getPlansDir();
const file = path.join(plans, 'synthetic-plan.md');
const service = new StandardFileSystemService();
const first = '# SYNTHETIC PLAN 東京\n\n- Original café.\n';
const second = first + '- Second generation 🐝.\n';
const refusal = /Gemini canonical conversation history is unavailable or unsafe[.]/u;
const hash = content => createHash('sha256').update(content).digest('hex');
const journal = path.join(root, 'canonical/projects', hash(workspace), 'message-history/prompt-history.json');
const records = () => JSON.parse(fs.readFileSync(journal, 'utf8'));
const planRecords = () => records().filter(entry => entry.type === 'plan-document');
async function wait(file) {
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(file)) {
    assert.ok(Date.now() < deadline, 'Finite native plan barrier exceeded.');
    await setTimeout(10);
  }
}
async function write(target, content) {
  await service.writeTextFile(target, content);
  assert.equal(await service.readTextFile(target), content);
}
if (scenario === 'private') {
  assert.equal(plans, path.join(workspace, 'private-custom-plans'));
  fs.mkdirSync(plans);
  await write(file, first);
  assert.equal(readNativeGeminiPlan(file), undefined);
  assert.equal(fs.readdirSync(path.join(root, 'canonical')).length, 0);
  console.log('PASS: unselected native custom plan configuration and filesystem behavior remain private.');
  process.exit(0);
}
assert.ok(plans.startsWith(path.join(root, 'canonical/projects') + path.sep));
assert.ok(!fs.existsSync(path.join(workspace, 'private-custom-plans')));
if (phase.startsWith('writer-')) {
  fs.writeFileSync(path.join(root, phase + '.ready'), 'ready');
  await wait(path.join(root, 'go'));
  for (let index = 0; index < 3; index++) {
    if (scenario === 'same-file') await service.writeTextFile(file, first + phase + index);
    else await write(path.join(plans, phase + '-' + index + '.md'), first + phase + index);
  }
  console.log('PASS: actual native plan ' + phase + ' acknowledges three independent documents.');
  process.exit(0);
}
if (phase === 'verify') {
  assert.equal(planRecords().length, 6);
  if (scenario === 'same-file') {
    assert.equal(await service.readTextFile(file), JSON.parse(planRecords().at(-1).message).content);
    assert.equal(new Set(planRecords().map(row => JSON.parse(row.message).content)).size, 6);
    console.log('PASS: fresh native filesystem retains all six serialized generations of the concurrently written plan.');
    process.exit(0);
  }
  for (let writer = 0; writer < 2; writer++) for (let index = 0; index < 3; index++) assert.equal(await service.readTextFile(path.join(plans, `writer-${writer}-${index}.md`)), first + 'writer-' + writer + index);
  console.log('PASS: fresh native filesystem retains all six concurrent plan documents and acknowledged audit generations.');
  process.exit(0);
}
if (phase === 'peer-writer') {
  await write(file, second);
  fs.writeFileSync(path.join(root, 'peer.done'), 'done');
  console.log('PASS: independent native plan peer acknowledges its complete replacement generation.');
  process.exit(0);
}
if (phase === 'reopen') {
  assert.equal(await service.readTextFile(file), first);
  assert.equal(planRecords().length, 1);
  console.log('PASS: fresh native Storage and filesystem recover the full plan after whole private-home disposal.');
  process.exit(0);
}
await write(file, first);
assert.equal(fs.statSync(file).mode & 0o777, 0o600);
assert.equal(fs.statSync(plans).mode & 0o777, 0o700);
if (scenario === 'generations') {
  await write(file, second);
  assert.deepEqual(
    planRecords().map(row => JSON.parse(row.message).content),
    [first, second]
  );
} else if (scenario === 'peer') {
  fs.writeFileSync(path.join(root, 'owner.ready'), 'ready');
  await wait(path.join(root, 'peer.done'));
  assert.equal(await service.readTextFile(file), second);
  assert.equal(planRecords().length, 2);
} else if (scenario === 'separation') {
  const other = new Storage(workspace, 'SYNTHETIC_OTHER_SESSION');
  await other.initialize();
  const otherFile = path.join(other.getPlansDir(), 'synthetic-plan.md');
  assert.notEqual(otherFile, file);
  await write(otherFile, second);
  const project = path.join(root, 'other-workspace');
  fs.mkdirSync(project, { mode: 0o700 });
  const foreign = new Storage(project, 'SYNTHETIC_PLAN_SESSION');
  await foreign.initialize();
  const foreignFile = path.join(foreign.getPlansDir(), 'synthetic-plan.md');
  assert.notEqual(foreignFile, file);
  await write(foreignFile, second);
  assert.equal(await service.readTextFile(file), first);
} else if (scenario === 'missing-unacknowledged') {
  await assert.rejects(service.readTextFile(path.join(plans, 'new-plan.md')), { code: 'ENOENT' });
  await write(path.join(plans, 'new-plan.md'), second);
} else if (scenario === 'policy') {
  const engine = new PolicyEngine({
    approvalMode: ApprovalMode.PLAN,
    rules: [
      { toolName: 'write_file', decision: PolicyDecision.ALLOW, priority: 1.07, modes: [ApprovalMode.PLAN], argsPattern: nativeGeminiPlanPolicyPattern(plans) },
      { toolName: 'write_file', decision: PolicyDecision.DENY, priority: 1.065, modes: [ApprovalMode.PLAN] },
    ],
  });
  const check = name => engine.check({ name: 'write_file', args: { file_path: name, content: 'SYNTHETIC' } });
  assert.equal((await check(file)).decision, PolicyDecision.ALLOW);
  for (const name of [path.join(workspace, 'source.md'), path.join(plans, '../outside.md'), path.join(plans, 'source.js'), file + '/suffix', path.join(plans, 'sibling/../../outside.md')]) assert.equal((await check(name)).decision, PolicyDecision.DENY);
  engine.addRule({ toolName: 'write_file', decision: PolicyDecision.DENY, priority: 2 });
  assert.equal((await check(file)).decision, PolicyDecision.DENY);
} else if (scenario.startsWith('unsafe-')) {
  const attack = scenario.slice(7);
  const protectedFile = path.join(root, 'protected.md');
  fs.writeFileSync(protectedFile, 'SYNTHETIC PROTECTED\n', { mode: 0o600 });
  const protectedBefore = [fs.statSync(protectedFile).ino, fs.readFileSync(protectedFile, 'utf8')];
  if (attack === 'symlink') {
    fs.unlinkSync(file);
    fs.symlinkSync(protectedFile, file);
  } else if (attack === 'hardlink') {
    fs.unlinkSync(file);
    fs.linkSync(protectedFile, file);
  } else if (attack === 'unsafe-mode') fs.chmodSync(file, 0o644);
  else if (attack === 'missing') fs.unlinkSync(file);
  else if (attack === 'content') fs.writeFileSync(file, second);
  else if (attack === 'invalid-utf8') fs.writeFileSync(file, Buffer.from([0xff]));
  else if (attack === 'oversized') fs.truncateSync(file, 33554433);
  else if (attack === 'parent-replacement') {
    fs.renameSync(plans, plans + '.retained');
    fs.mkdirSync(plans, { mode: 0o700 });
  } else if (attack === 'root-replacement') {
    fs.renameSync(process.env.GEMINI_HISTORY_HOME, process.env.GEMINI_HISTORY_HOME + '.retained');
    fs.mkdirSync(process.env.GEMINI_HISTORY_HOME, { mode: 0o700 });
  } else if (attack === 'changed-selector') process.env.GEMINI_HISTORY_HOME += '-foreign';
  else if (attack === 'journal-schema') {
    const rows = records();
    const plan = JSON.parse(rows.at(-1).message);
    plan.name = '../escape.md';
    rows.at(-1).message = JSON.stringify(plan);
    fs.writeFileSync(journal, JSON.stringify(rows));
  } else if (attack === 'unknown') {
    fs.writeFileSync(path.join(plans, 'unknown.md'), first, { mode: 0o600 });
  } else if (attack === 'filename') {
    await assert.rejects(service.writeTextFile(path.join(plans, 'source.js'), first), refusal);
  } else if (attack === 'reserved') {
    await assert.rejects(service.writeTextFile(path.join(plans, '.publish-synthetic.md'), first), refusal);
  } else throw new Error('Unknown bounded plan scenario.');
  const target = attack === 'unknown' ? path.join(plans, 'unknown.md') : file;
  const auditRoot = path.join(root, attack === 'root-replacement' ? 'canonical.retained' : 'canonical');
  const audit = fs.readFileSync(path.join(auditRoot, 'projects', hash(workspace), 'message-history/prompt-history.json'));
  await assert.rejects(service.readTextFile(target), refusal);
  await assert.rejects(service.writeTextFile(target, 'SYNTHETIC FORBIDDEN'), refusal);
  assert.deepEqual(fs.readFileSync(path.join(auditRoot, 'projects', hash(workspace), 'message-history/prompt-history.json')), audit);
  assert.deepEqual([fs.statSync(protectedFile).ino, fs.readFileSync(protectedFile, 'utf8')], protectedBefore);
  console.log('PASS: actual native plan read/write refuses ' + attack + ' and stays refused without protected or audit changes.');
  process.exit(0);
}
console.log('PASS: actual native plan ' + scenario + ' preserves complete plans, authority and audit.');
