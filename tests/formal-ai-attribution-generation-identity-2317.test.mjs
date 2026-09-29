#!/usr/bin/env node

/**
 * Regression test for issue #2317: the Formal AI attribution guard rejected a
 * 100% `formalai/formal-ai` Agent CLI session because of the CLI's provider
 * registry logs.
 *
 * Scala run (`--tool agent`), log line 578:
 *   🛑 Formal AI attribution disabled: the Agent CLI stream reports opencode, a hosted opencode model
 * tripped by `{"service":"provider","providerID":"opencode","message":"found"}`,
 * logged at startup while the CLI resolves its compaction cascade. Only
 * generation records (assistant messages, step_start/step_finish parts with a
 * message id) name the model that answered.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2317
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectModelIdentities, createFormalAiAttributionSession } from '../src/formal-ai-attribution.lib.mjs';
import { createJsonStreamScanner } from '../src/json-stream.lib.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCALA_LOG = path.join(repoRoot, 'docs/case-studies/issue-2320/logs/scala-agent.log');

let passed = 0;
let failed = 0;
const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  PASS: ${description}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL: ${description}`);
    console.log(`      ${error.stack || error.message}`);
    failed++;
  }
};

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-2317-'));
process.on('exit', () => fs.rmSync(workspace, { recursive: true, force: true }));

const startSession = async name => {
  const repo = path.join(workspace, name);
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: repo });
  const messages = [];
  const session = createFormalAiAttributionSession({ repositoryPath: repo, issueNumber: 1, version: '0.351.0', model: 'formalai/formal-ai', tool: 'agent', sanitize: async text => text, log: async message => messages.push(String(message)) });
  const prepared = await session.prepare();
  assert.equal(prepared.enabled, true, 'the session arms');
  await session.noteSessionId('ses_f1c9630faffeRzbgI8aK3RET4u');
  return { session, messages };
};

/** The Agent CLI stream records of the solve log: `[ts] [INFO] ` stripped, pretty JSON joined. */
const replayScalaLog = async (session, lineLimit = Infinity) => {
  const lines = fs.readFileSync(SCALA_LOG, 'utf8').split('\n').slice(0, lineLimit);
  const scanner = createJsonStreamScanner();
  let records = 0;
  for (const line of lines) {
    const match = line.match(/^\[[^\]]+\] \[INFO\] (.*)$/);
    if (!match) continue;
    for (const event of scanner.write(`${match[1]}\n`)) {
      if (event.type !== 'json') continue;
      records++;
      await session.recordStreamEvent(event.value);
    }
  }
  return records;
};

console.log('Issue #2317: only a generation names the model that answered\n');

await test('replaying the first 700 lines of the Scala log keeps attribution enabled', async () => {
  const { session, messages } = await startSession('first-700');
  const records = await replayScalaLog(session, 700);
  assert.ok(records > 20, `the replay fed stream records (${records})`);
  assert.equal(session.enabled, true, session.rejection || 'attribution stays enabled');
  assert.equal(session.rejection, null);
  assert.equal(
    messages.some(message => message.includes('attribution disabled')),
    false
  );
});

await test('the whole Scala session - every generation formalai/formal-ai - keeps attribution enabled', async () => {
  const { session } = await startSession('whole-log');
  await replayScalaLog(session);
  assert.equal(session.enabled, true, session.rejection || 'attribution stays enabled');
});

await test('provider-registry logs and records without a message id are not identities', () => {
  assert.deepEqual(collectModelIdentities({ type: 'log', service: 'provider', providerID: 'opencode', message: 'found' }), []);
  assert.deepEqual(collectModelIdentities({ type: 'log', service: 'provider', modelID: 'big-pickle', providerID: 'opencode', message: 'resolved short model name (single match)' }), []);
  assert.deepEqual(collectModelIdentities({ type: 'model_resolved', providerID: 'formalai', modelID: 'formal-ai' }), []);
  assert.deepEqual(collectModelIdentities({ type: 'step_finish', part: { type: 'step-finish', model: { providerID: 'opencode' } } }), [], 'a step part without a message id');
  assert.deepEqual(collectModelIdentities({ type: 'message.updated', properties: { info: { id: 'msg_1', role: 'user', providerID: 'opencode' } } }), [], 'a user message');
});

await test('a generation naming a hosted provider still disables attribution', async () => {
  const { session, messages } = await startSession('hosted-generation');
  await session.recordStreamEvent({ type: 'log', service: 'provider', providerID: 'opencode', message: 'found' });
  assert.equal(session.enabled, true);
  await session.recordStreamEvent({ type: 'step_finish', sessionID: 's', part: { id: 'prt_1', messageID: 'msg_1', type: 'step-finish', model: { providerID: 'opencode', requestedModelID: 'formal-ai', respondedModelID: 'big-pickle' } } });
  assert.equal(session.enabled, false, 'a compaction answered by opencode is not Formal AI work');
  assert.match(session.rejection, /opencode/);
  assert.equal(
    messages.some(message => message.includes('Formal AI attribution disabled') && message.includes('opencode')),
    true
  );
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
