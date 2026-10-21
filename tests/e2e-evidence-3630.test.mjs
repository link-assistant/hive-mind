/**
 * Issue #3630: an attempt's evidence records every command with its exit
 * status, marks missing, truncated and interrupted data instead of dropping
 * it, and a published fixture carries no secret or personal data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildEvidenceManifest, deliveryRecord, keepTail, redactArgv, redactForFixture, startCommandRecord, writeEvidenceManifest } from '../scripts/e2e-evidence.lib.mjs';

const clock = () => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 9, 21, 0, 0, tick++));
};

test('a command record keeps exit status, bytes and truncation', () => {
  const records = [];
  const recorder = startCommandRecord(records, { command: 'act', argv: ['pull_request', '--token=abc', '-s', 'GITHUB_TOKEN'], logName: 'act.log', now: clock() });
  assert.equal(records[0].interrupted, true, 'a started command is interrupted until it finishes');
  recorder.output(10, 10);
  recorder.output(10, 15);
  recorder.finish({ code: 1, signal: null });
  assert.deepEqual(records[0], { command: 'act', argv: ['pull_request', '--token=[REDACTED]', '-s', 'GITHUB_TOKEN'], logName: 'act.log', startedAt: '2026-10-21T00:00:00.000Z', finishedAt: '2026-10-21T00:00:01.000Z', exitCode: 1, signal: null, bytes: 20, keptBytes: 15, truncated: true, interrupted: false });
});

test('the in-memory tail is bounded', () => {
  assert.equal(keepTail('abc', 'def', 4), 'cdef');
  assert.equal(keepTail('', 'ab', 4), 'ab');
  assert.deepEqual(redactArgv(['--api-key', 'x', '--password=hunter22', '--model', 'formal-ai', '--tokenizer']), ['--api-key', '[REDACTED]', '--password=[REDACTED]', '--model', 'formal-ai', '--tokenizer']);
});

test('the manifest marks missing, truncated and interrupted evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'e2e-evidence-'));
  writeFileSync(join(directory, 'result.json'), '{}');
  writeFileSync(join(directory, 'solve.log'), 'session');
  const commands = [
    { logName: 'solve.log', truncated: false, interrupted: true, bytes: 7, keptBytes: 0 },
    { logName: 'act.log', truncated: true, interrupted: false, bytes: 40, keptBytes: 32 },
  ];
  const manifest = writeEvidenceManifest(directory, { commands });
  assert.deepEqual(
    manifest.files.map(file => [file.path, file.bytes]),
    [
      ['result.json', 2],
      ['solve.log', 7],
    ]
  );
  assert.equal(manifest.files[0].sha256, '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  assert.deepEqual(manifest.missing, ['custody.json', 'commands.json', 'identity.json', 'delivery.json', 'workflow.log']);
  assert.deepEqual(manifest.truncated, [{ logName: 'act.log', bytes: 40, keptBytes: 32 }]);
  assert.deepEqual(manifest.interrupted, ['solve.log']);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')), manifest);
  // The manifest never lists itself, so rebuilding it is stable.
  assert.deepEqual(buildEvidenceManifest(directory, { commands }), manifest);
});

test('the delivery record keeps what the oracles saw', () => {
  const record = deliveryRecord({ issueUrl: 'https://github.com/o/r/issues/1', pullRequest: { number: 2, url: 'u', state: 'OPEN', isDraft: false, title: 't', body: 'b', headRefName: 'issue-1-x', headRefOid: 'f'.repeat(40), baseRefName: 'e2e/x', extra: 'dropped' }, files: ['main.rs'], checks: [{ name: 'run', conclusion: 'success' }], comments: ['c'], execution: { mode: 'act', workflowLog: 'not kept here' } });
  assert.equal(record.pullRequest.extra, undefined);
  assert.deepEqual(record.execution, { mode: 'act', fallbackReason: null });
  assert.deepEqual(deliveryRecord({}), { v: 1, issueUrl: null, pullRequest: null, files: [], changes: [], checks: [], comments: [], execution: null });
  // The answer's patch is kept for a replay; a session log's is not, and a huge patch is marked truncated.
  const changes = deliveryRecord({
    changes: [
      { filename: 'main.rs', status: 'added', patch: '@@ -0,0 +1 @@\n+fn main() {}' },
      { filename: 'dev/log/issues/1/pulls/2/sessions/s/solve.log', status: 'added', patch: '+secret session' },
      { filename: 'big.txt', status: 'added', patch: 'x'.repeat(70 * 1024) },
    ],
  }).changes;
  assert.deepEqual(changes[0], { filename: 'main.rs', status: 'added', patch: '@@ -0,0 +1 @@\n+fn main() {}', truncated: false });
  assert.equal(changes[1].patch, null);
  assert.equal(changes[2].truncated, true);
  assert.equal(changes[2].patch.length, 64 * 1024);
});

test('fixtures carry no secret, token, private key or personal data', () => {
  const secret = 'Zx9-private-model-key-value';
  const text = [`OPENAI_API_KEY=${secret}`, 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'url https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', 'author Jane Doe <jane.doe@company.io>', 'bot 41898282+github-actions[bot]@users.noreply.github.com', 'cwd /home/jane/project and /home/box/logs and /home/runner/work', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'].join('\n');
  const { text: redacted, redactions } = redactForFixture(text, { env: { OPENAI_API_KEY: secret, FORMAL_AI_INSTALL_GRANT: 'workspace', PATH: '/usr/bin' } });
  for (const leaked of [secret, 'ghp_', 'ghs_', 'eyJhbGci', 'MIIabc', 'jane.doe', '/home/jane', 'sk-ant-api03']) assert.ok(!redacted.includes(leaked), `${leaked} leaked:\n${redacted}`);
  assert.match(redacted, /41898282\+github-actions\[bot\]@users\.noreply\.github\.com/, 'automation addresses are kept');
  assert.match(redacted, /\/home\/box\/logs/);
  assert.match(redacted, /\/home\/runner\/work/);
  assert.match(redacted, /Authorization: Bearer \[REDACTED\]/);
  assert.match(redacted, /person@example\.com/);
  assert.ok(redactions >= 8);
  assert.deepEqual(redactForFixture('nothing here', { env: {} }), { text: 'nothing here', redactions: 0 });
  // An SSH remote is a host, not a person (run 39505806192's pull request event).
  assert.deepEqual(redactForFixture('"ssh_url":"git@github.com:o/r.git"', { env: {} }).redactions, 0);
});
