#!/usr/bin/env node
/**
 * Issue #3530: "we should get the entire log even after auto-resume/restart".
 *
 * Telegram now shows only the latest session id of a task. A fresh recovery is a
 * new start-command execution with its own log, so `/log <latest id>` must join
 * the logs of every attempt (oldest first), found through the session store's
 * append-only audit log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildSessionLogChains, readSessionLogChain, sessionRecordIds, writeCombinedSessionLog } from '../src/session-log-chain.lib.mjs';
import { registerLogCommand, resolveChainLogParts } from '../src/telegram-log-command.lib.mjs';
import { buildSessionIdentityArgs } from '../src/isolation-runner.lib.mjs';

const ROOT = 'a84a2357-3530-4c1a-9b0d-2f9a7c3b9b51';
const RECOVERY = 'bcb396a0-3530-4c1a-9b0d-2f9a7c3b9b52';
const UNRELATED = 'be86e099-3530-4c1a-9b0d-2f9a7c3b9b53';
const URL = 'https://github.com/example/public-repo/issues/1';

const track = (sessionName, sessionInfo) => JSON.stringify({ ts: '2026-10-19T00:00:00.000Z', type: 'track', sessionName, sessionInfo });

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-3530-log-chain-'));
  const logs = { [ROOT]: path.join(dir, `${ROOT}.log`), [RECOVERY]: path.join(dir, `${RECOVERY}.log`), [UNRELATED]: path.join(dir, `${UNRELATED}.log`) };
  await fs.writeFile(logs[ROOT], 'attempt one: working\nkilled by OOM\n');
  await fs.writeFile(logs[RECOVERY], 'attempt two: resumed\ndone\n');
  await fs.writeFile(logs[UNRELATED], 'another task\n');
  const eventsPath = path.join(dir, 'sessions-events.jsonl');
  const lines = [
    track(ROOT, { executionUuid: ROOT, url: URL, isolationBackend: 'screen' }),
    track(UNRELATED, { executionUuid: UNRELATED, url: 'https://github.com/example/other/issues/2' }),
    JSON.stringify({ ts: '2026-10-19T00:01:00.000Z', type: 'complete', sessionName: ROOT }),
    track(RECOVERY, { executionUuid: RECOVERY, url: URL, rootSessionName: ROOT, killRecoveryOfSession: ROOT, previousExecutionUuids: [ROOT], isolationBackend: 'screen' }),
    '{"type":"track","sessionName":"torn', // a crash mid-append leaves a torn last line
  ];
  await fs.writeFile(eventsPath, `${lines.join('\n')}\n`);
  return { dir, logs, eventsPath, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('a fresh launch gets the same id for session and execution (--session-id)', () => {
  assert.deepEqual(buildSessionIdentityArgs(ROOT), ['--session', ROOT, '--session-id', ROOT]);
});

test('every id of a recovery record joins the chain', () => {
  const ids = sessionRecordIds(RECOVERY, { executionUuid: RECOVERY, rootSessionName: ROOT, previousExecutionUuids: [ROOT], containerName: 'solve-x' });
  assert.deepEqual(ids, [RECOVERY, ROOT, 'solve-x']);
});

test('the chain is found from the latest and from the first id, and keeps other tasks out', async () => {
  const f = await fixture();
  try {
    for (const id of [RECOVERY, ROOT]) {
      const chain = await readSessionLogChain(id, { eventsPath: f.eventsPath });
      assert.deepEqual(chain.executions, [ROOT, RECOVERY], `lookup by ${id}`);
      assert.equal(chain.latest, RECOVERY);
      assert.equal(chain.url, URL);
      assert.ok(!chain.ids.includes(UNRELATED));
    }
    const single = await readSessionLogChain(UNRELATED, { eventsPath: f.eventsPath });
    assert.deepEqual(single.executions, [UNRELATED]);
    assert.equal(await readSessionLogChain(RECOVERY, { eventsPath: path.join(f.dir, 'missing.jsonl') }), null, 'no audit log, no chain');
  } finally {
    await f.cleanup();
  }
});

test('a recovery tracked only in memory still joins its chain', () => {
  const chains = buildSessionLogChains([
    { sessionName: ROOT, sessionInfo: { executionUuid: ROOT } },
    { sessionName: RECOVERY, sessionInfo: { executionUuid: RECOVERY, killRecoveryOfSession: ROOT } },
  ]);
  assert.deepEqual(chains.lookup(RECOVERY).executions, [ROOT, RECOVERY]);
  assert.equal(chains.lookup('nope'), null);
});

test('the combined log has every attempt, oldest first, and names a missing one', async () => {
  const f = await fixture();
  try {
    const result = await writeCombinedSessionLog({
      parts: [
        { uuid: ROOT, logPath: f.logs[ROOT] },
        { uuid: 'gone', logPath: null },
        { uuid: RECOVERY, logPath: f.logs[RECOVERY] },
      ],
      destPath: path.join(f.dir, 'all.log'),
    });
    const text = await fs.readFile(result.path, 'utf8');
    assert.ok(text.indexOf('killed by OOM') < text.indexOf('attempt two: resumed'));
    assert.match(text, /===== hive-mind: attempt 1\/3, execution a84a2357/);
    assert.match(text, /attempt 2\/3, execution gone =====\n\(no log file is known for this execution\)/);
    assert.deepEqual(result.included, [ROOT, RECOVERY]);
    assert.deepEqual(result.missing, ['gone']);
    assert.equal(result.bytes, Buffer.byteLength(text));
  } finally {
    await f.cleanup();
  }
});

test('an execution start-command no longer knows falls back to its recorded log path', async () => {
  const f = await fixture();
  try {
    const chain = { executions: [ROOT, RECOVERY], logPaths: { [ROOT]: f.logs[ROOT] } };
    const statusResult = { exists: true, uuid: RECOVERY, logPath: f.logs[RECOVERY] };
    const parts = await resolveChainLogParts({ chain, sessionId: RECOVERY, statusResult, logPath: f.logs[RECOVERY], querySessionStatus: async () => ({ exists: false }) });
    assert.deepEqual(parts, [
      { uuid: ROOT, logPath: f.logs[ROOT] },
      { uuid: RECOVERY, logPath: f.logs[RECOVERY] },
    ]);
  } finally {
    await f.cleanup();
  }
});

test('a single-attempt session keeps its own log', async () => {
  assert.equal(await resolveChainLogParts({ chain: { executions: [ROOT] }, sessionId: ROOT, statusResult: { exists: true, uuid: ROOT }, logPath: '/x.log', querySessionStatus: async () => null }), null);
  assert.equal(await resolveChainLogParts({ chain: null, sessionId: ROOT, statusResult: { exists: true, uuid: ROOT }, logPath: '/x.log', querySessionStatus: async () => null }), null);
});

function fakeBot() {
  const handlers = new Map();
  return { handlers, command: (pattern, handler) => handlers.set(String(pattern), handler) };
}

async function runLog(f, { sessionId, queried = [] }) {
  const uploads = [];
  const replies = [];
  const bot = fakeBot();
  const querySessionStatus = async uuid => {
    queried.push(uuid);
    return f.logs[uuid] ? { exists: true, uuid, status: 'executed', isolation: 'screen', logPath: f.logs[uuid] } : { exists: false };
  };
  await registerLogCommand(bot, {
    isChatAuthorized: () => true,
    querySessionStatus,
    // The task has completed: the monitor no longer tracks it in memory.
    getTrackedSessionInfo: () => null,
    detectRepositoryVisibility: async () => ({ isPublic: true, visibility: 'public' }),
    parseGitHubUrl: url => ({ valid: url.startsWith('https://github.com/example/'), owner: 'example', repo: 'public-repo' }),
    resolveLogChain: id => readSessionLogChain(id, { eventsPath: f.eventsPath }),
  });
  const ctx = {
    chat: { id: -100, type: 'supergroup' },
    from: { id: 42 },
    message: { message_id: 7, text: `/log ${sessionId}`, date: Math.floor(Date.now() / 1000) },
    telegram: { getChatMember: async () => ({ status: 'creator' }) },
    reply: async text => replies.push(text),
    replyWithDocument: async (document, options) => {
      uploads.push({ filename: document.filename, caption: options.caption, text: await fs.readFile(document.source, 'utf8') });
      return {};
    },
  };
  await bot.handlers.get('log')(ctx);
  return { uploads, replies };
}

test('/log on the latest id uploads the log of every attempt to a public-repo chat', async () => {
  const f = await fixture();
  try {
    const queried = [];
    const { uploads, replies } = await runLog(f, { sessionId: RECOVERY, queried });
    assert.deepEqual(replies, []);
    assert.equal(uploads.length, 1);
    const [upload] = uploads;
    assert.equal(upload.filename, `${RECOVERY}-all-attempts.log`);
    assert.match(upload.caption, /All 2 attempts, oldest first/);
    assert.match(upload.caption, /Public repository, delivering in chat/, 'the chain url decides visibility once the task is no longer tracked');
    assert.ok(upload.text.indexOf('killed by OOM') >= 0 && upload.text.indexOf('killed by OOM') < upload.text.indexOf('attempt two: resumed'));
    assert.ok(!upload.text.includes('another task'));
    assert.deepEqual(queried.sort(), [ROOT, RECOVERY].sort());
  } finally {
    await f.cleanup();
  }
});

test('/log on a never-recovered session uploads just its own log', async () => {
  const f = await fixture();
  try {
    const { uploads } = await runLog(f, { sessionId: UNRELATED });
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].filename, `${UNRELATED}.log`);
    assert.equal(uploads[0].text, 'another task\n');
    assert.doesNotMatch(uploads[0].caption, /attempts/);
  } finally {
    await f.cleanup();
  }
});
