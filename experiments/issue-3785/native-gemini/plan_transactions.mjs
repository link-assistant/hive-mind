// Appended to the checked history helper; configuration remains private.
const nativePlanIntent = '.plan-transaction.json';
const nativePlanStage = /^\.plan-data-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.tmp$/u;

function nativePlanNextRevision(records, context) {
  let next = 0;
  for (const row of records) if (row.sessionId === context.scope) next = row.messageId + 1;
  if (!Number.isSafeInteger(next)) throw refuse();
  return next;
}

function validateNativePlanIntent(intent, context) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent) || Object.keys(intent).length !== 6 || intent.version !== 1 || intent.scope !== context.scope || !validNativePlanName(intent.name)) throw refuse();
  const { previous, next, staged } = intent;
  if (previous !== null && (!previous || typeof previous !== 'object' || Array.isArray(previous) || Object.keys(previous).length !== 3 || !Number.isSafeInteger(previous.revision) || previous.revision < 0 || typeof previous.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(previous.hash) || typeof previous.version !== 'string' || !/^[0-9]+(?::[0-9]+){6}$/u.test(previous.version))) throw refuse();
  if (!next || typeof next !== 'object' || Array.isArray(next) || Object.keys(next).length !== 4 || !Number.isSafeInteger(next.revision) || next.revision < 0 || typeof next.content !== 'string' || Buffer.byteLength(next.content) > LIMIT || Buffer.from(next.content).toString('utf8') !== next.content || next.hash !== digest(next.content) || typeof next.timestamp !== 'string' || next.timestamp.length > 64 || !Number.isFinite(Date.parse(next.timestamp))) throw refuse();
  if (!staged || typeof staged !== 'object' || Array.isArray(staged) || Object.keys(staged).length !== 2 || typeof staged.name !== 'string' || !nativePlanStage.test(staged.name) || typeof staged.identity !== 'string' || !/^[0-9]+:[0-9]+$/u.test(staged.identity)) throw refuse();
}

function nativePlanIntentRecords(records, context, intent) {
  const plans = nativePlanRecords(records, context);
  const saved = plans.get(intent.name);
  if (saved?.revision === intent.next.revision && saved.hash === intent.next.hash && saved.content === intent.next.content && nativePlanNextRevision(records, context) === intent.next.revision + 1) {
    const row = records.find(row => row.sessionId === context.scope && row.messageId === intent.next.revision);
    if (row.timestamp !== intent.next.timestamp) throw refuse();
    return true;
  }
  if (nativePlanNextRevision(records, context) !== intent.next.revision || (intent.previous === null ? saved !== undefined : saved?.revision !== intent.previous.revision || saved.hash !== intent.previous.hash)) throw refuse();
  return false;
}

function nativePlanPublicationState(parent, location, intent) {
  const stage = { target: `${parent.anchor}/${intent.staged.name}` };
  const target = { target: `${parent.anchor}/${location.name}` };
  const stageBytes = snapshot(stage, true);
  const targetBytes = snapshot(target, true);
  const stageInfo = checkedFile(stage, true);
  const targetInfo = checkedFile(target, true);
  if (stageInfo !== null && (identity(stageInfo) !== intent.staged.identity || stageBytes !== intent.next.content)) throw refuse();
  const published = targetInfo !== null && identity(targetInfo) === intent.staged.identity && targetBytes === intent.next.content;
  if (published ? stageInfo !== null : stageInfo === null || (intent.previous === null ? targetInfo !== null : targetInfo === null || version(targetInfo) !== intent.previous.version || digest(targetBytes) !== intent.previous.hash)) throw refuse();
  return { stage, target, published, stageVersion: stageInfo === null ? null : version(stageInfo), targetVersion: targetInfo === null ? null : version(targetInfo) };
}

function recoverNativeGeminiPlanTransaction(context, current) {
  const location = { target: `${context.parent.anchor}/${nativePlanIntent}` };
  const original = checkedFile(location, true);
  if (original === null) return;
  const generation = version(original);
  const bytes = snapshot(location);
  if (version(checkedFile(location)) !== generation) throw refuse();
  const intent = JSON.parse(bytes);
  validateNativePlanIntent(intent, context);
  const plan = nativePlanLocation(path.join(authority.selected, ...context.parent.components, intent.name));
  if (plan?.context !== context) throw refuse();
  const parent = directory(plan.directories, false);
  const checked = () => {
    current();
    if (version(checkedFile(location)) !== generation || snapshot(location) !== bytes) throw refuse();
  };
  checked();
  const before = nativePlanPublicationState(parent, plan, intent);
  const unchanged = () => {
    checked();
    for (const [file, expected] of [
      [before.stage, before.stageVersion],
      [before.target, before.targetVersion],
    ]) {
      const named = checkedFile(file, true);
      if ((named === null ? null : version(named)) !== expected) throw refuse();
    }
  };
  const records = readNativeGeminiPromptHistory(context.temporary);
  if (!nativePlanIntentRecords(records, context, intent)) {
    if (before.published) throw refuse();
    appendNativeGeminiPromptHistory(
      context.temporary,
      {
        sessionId: context.scope,
        messageId: 0,
        type: 'plan-document',
        message: JSON.stringify({ name: intent.name, content: intent.next.content, hash: intent.next.hash }),
        timestamp: intent.next.timestamp,
      },
      records => {
        unchanged();
        if (nativePlanIntentRecords(records, context, intent)) throw refuse();
      }
    );
  }
  unchanged();
  if (!before.published) {
    fs.renameSync(before.stage.target, before.target.target);
    fs.fsyncSync(parent.fd);
  }
  checked();
  const after = nativePlanPublicationState(parent, plan, intent);
  if (!after.published || !nativePlanIntentRecords(readNativeGeminiPromptHistory(context.temporary), context, intent)) throw refuse();
  checked();
  fs.unlinkSync(location.target);
  fs.fsyncSync(context.parent.fd);
  current();
}

function publishNativeGeminiPlanTransaction(location, parent, before, content, records, current) {
  const context = location.context;
  const staged = `.plan-data-${randomUUID()}.tmp`;
  const stage = { target: `${parent.anchor}/${staged}` };
  let fd;
  let stagedInfo;
  try {
    fd = fs.openSync(stage.target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    stagedInfo = fs.fstatSync(fd, { bigint: true });
    if (!safeFile(stagedInfo)) throw refuse();
    fs.fsyncSync(parent.fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  current();
  if (version(checkedFile(stage)) !== version(stagedInfo) || snapshot(stage) !== content) throw refuse();
  const info = checkedFile(before.target, true);
  if ((info === null ? null : version(info)) !== before.version) throw refuse();
  const intent = { version: 1, scope: context.scope, name: location.relative, previous: before.saved === undefined ? null : { revision: before.saved.revision, hash: before.saved.hash, version: before.version }, next: { revision: nativePlanNextRevision(records, context), content, hash: digest(content), timestamp: new Date().toISOString() }, staged: { name: staged, identity: identity(stagedInfo) } };
  const encoded = JSON.stringify(intent);
  if (Buffer.byteLength(encoded) > LIMIT) throw refuse();
  publish(context.parent, nativePlanIntent, encoded, current, false, () => {
    const named = checkedFile(stage);
    if (version(named) !== version(stagedInfo) || snapshot(stage) !== content || snapshot({ target: `${context.parent.anchor}/${nativePlanIntent}` }, true) !== null) throw refuse();
  });
  recoverNativeGeminiPlanTransaction(context, current);
}
