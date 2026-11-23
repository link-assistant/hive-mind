/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyIncidentBatch, planIncidentBatch } from '../src/hive-manager/index.mjs';

const manager = process.env.HIVE_MANAGER_UNDER_TEST ?? fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
const id = n => `41320000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const at = hour => `2026-11-21T${String(hour).padStart(2, '0')}:00:00Z`;
const repository = 'example/project';
const issueUrl = n => `https://github.com/${repository}/issues/${n}`;
const nativeMarker = (n, attempt) => `<!-- hive-manager-task: ${id(n)}/${attempt} -->`;

function task(n, exitCode, hour) {
  return { uuid: id(n), status: 'executed', exitCode, startTime: at(0), endTime: at(hour), options: { isolated: 'docker' } };
}

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-manager-4132-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (file, value, mode = 0o600) => writeFileSync(join(cwd, file), typeof value === 'string' ? value : JSON.stringify(value), { mode });
  const read = file => readFileSync(join(cwd, file), 'utf8');
  const state = join(cwd, 'state');
  mkdirSync(state);
  const receipts = () =>
    Object.fromEntries(
      readdirSync(state)
        .filter(name => name.endsWith('.json'))
        .map(name => [name, read(`state/${name}`)])
    );
  const run = (args, env = {}) =>
    spawnSync('bash', [manager, 'tasks', 'report-batch', ...args], {
      cwd,
      env: { ...process.env, PATH: `${cwd}:${process.env.PATH}`, HIVE_MIND_STATE_DIR: state, ...env },
      encoding: 'utf8',
      timeout: 15_000,
    });
  const json = (args, status = 0, env) => {
    const result = run(args, env);
    assert.equal(result.status, status, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };

  // The fake implements read endpoints and records every attempted mutation.
  write(
    'gh',
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const read = (name, fallback) => fs.existsSync(name) ? JSON.parse(fs.readFileSync(name, 'utf8')) : fallback;
const emit = value => console.log(JSON.stringify(value));
if (args[0] === 'auth') process.exit(1);
fs.appendFileSync('github-requests', args.slice(0, 6).join(' ') + '\\n');
if (args[0] === 'api') {
  const endpoint = args[5];
  if (endpoint === 'repos/example/project') emit({full_name: 'Example/Project', visibility: read('visibility', 'private')});
  else if (endpoint === 'search/issues') {
    if (process.env.SEARCH_UNAVAILABLE) process.exit(1);
    const items = read('search', []);
    emit([{ items, total_count: items.length, incomplete_results: false }]);
  }
  else if (endpoint === 'repos/example/project/issues') emit(read('recent', []));
  else if (endpoint.startsWith('repos/link-assistant/hive-mind/releases/tags/')) emit({ published_at: read('releases', {})[endpoint.split('/').at(-1)] });
  else {
    const path = endpoint.split('/');
    const number = Number(path[4]);
    if (path[5]?.startsWith('comments?')) emit([read('comments-' + number, [])]);
    else emit(read('issue-' + number, { number, state: 'open', comments: 0 }));
  }
} else if (args[0] === 'issue') {
  const posts = read('posts', []);
  const body = args[args.indexOf('--body') + 1];
  const number = args[1] === 'comment' ? Number(args[2]) : 100 + posts.length;
  const url = 'https://github.com/example/project/issues/' + number + (args[1] === 'comment' ? '#issuecomment-123' : '');
  posts.push({ action: args[1], body, url });
  fs.writeFileSync('posts', JSON.stringify(posts));
  const isComment = args[1] === 'comment';
  const evidenceFile = isComment ? 'comments-' + number : 'recent';
  fs.writeFileSync(evidenceFile, JSON.stringify([...read(evidenceFile, []), { number, html_url: url, body }]));
  if ((process.env.LOSE_COMMENT_RESPONSE && isComment) || (process.env.LOSE_CREATE_RESPONSE && !isComment)) process.exit(1);
  console.log(url);
} else process.exit(1);
`,
    0o700
  );
  return { cwd, write, read, receipts, run, json };
}

const planArgs = (output, ...extra) => ['plan', '--records', 'records.json', '--selection', 'selection.json', '--output', output, ...extra];
const policyArgs = ['--policy', 'policy.json', '--legacy-ledger', 'legacy.json'];

test('save a private window preview and reconcile exact recurring attempts, legacy success and closed routes', { timeout: 30_000 }, async t => {
  const { cwd, write, read, json, run } = fixture(t);
  const privateCommand = 'fixture-raw-command contains user@example.test';
  const first = `{"command":"${privateCommand}"}\n`.repeat(20);
  const records = [{ ...task(1, 1, 2), command: privateCommand, logPath: 'execution.log', attempt: { number: 2, logOffset: Buffer.byteLength(first) }, attemptHistory: [{ ...task(1, 1, 1), number: 1 }] }, { ...task(2, 0, 6), attempt: { number: 2 }, attemptHistory: [{ ...task(2, 1, 3), number: 1 }] }, { ...task(3, 137, 4), oomKilled: true }, task(4, 1, 5), task(5, 1, 0)];
  write('execution.log', `${first}Retry 1 in 5s (session preserved)\n`);
  write('records.json', { executions: records });
  write('selection.json', { window: { from: at(1), to: at(5) }, installedVersion: '2.48.0' });
  const privatePreview = json(planArgs('private.json'));
  assert.equal(privatePreview.digest, null);
  assert.equal(privatePreview.entries, 4);
  assert.equal(statSync(join(cwd, 'private.json')).mode & 0o777, 0o600);
  assert.throws(() => read('github-requests'), { code: 'ENOENT' });
  assert.match(run(['apply', '--plan', 'private.json', '--approve', 'anything']).stderr, /requires the saved publication plan/);
  assert.match(run(planArgs('private.json')).stderr, /EEXIST/);

  write('policy.json', {
    destination: repository,
    visibility: 'private',
    allow: ['create-issue', 'comment', 'regression-issue'],
    includeLogEvidence: true,
    routes: [{ backend: 'docker', kind: 'Memory exhaustion', exitCode: 137, issue: 20 }],
  });
  write('legacy.json', { reported: { [`EXAMPLE/PROJECT ${id(2)}#1`]: { url: issueUrl(22) }, [`other/repo ${id(1)}#2`]: { url: issueUrl(23) } } });
  const legacyBefore = read('legacy.json');
  write('search', [{ number: 17, body: nativeMarker(1, 1), comments: 1 }]);
  write('comments-17', [{ body: `<!-- auto-fix-key: ${id(1)}#20 -->`, html_url: `${issueUrl(17)}#issuecomment-55` }]);
  write('issue-20', { number: 20, state: 'closed', closed_at: at(7) });
  write('releases', { 'v2.48.0': at(6), 'v2.49.0': at(8) });
  const summary = json(planArgs('reviewed.json', ...policyArgs));
  const plan = JSON.parse(read('reviewed.json'));
  assert.match(summary.digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    plan.entries.map(({ id, attempt }) => [id, attempt]),
    [
      [id(1), 1],
      [id(1), 2],
      [id(2), 1],
      [id(3), 1],
    ]
  );
  assert.equal(plan.entries[0].found.source, 'hive-manager-marker');
  assert.equal(plan.entries[0].evidence.repeatedCommands[0], 20);
  assert.match(plan.entries[0].report.body, /Repeated command counts 20/);
  assert.equal(plan.entries[1].action, 'create-issue');
  assert.match(plan.entries[1].report.body, /Retries 1/);
  assert.doesNotMatch(plan.entries[1].report.body, /Repeated command counts 20/);
  assert.doesNotMatch(read('reviewed.json'), /fixture-raw-command|user@example|execution\.log/);
  assert.equal(plan.entries[2].laterSucceeded, true);
  assert.equal(plan.entries[2].found.url, issueUrl(22));
  assert.equal(plan.entries[3].action, null);
  assert.equal(plan.entries[3].closed.state, 'closed-after-installed-release');
  assert.equal(plan.entries[3].closed.installedVersion, '2.48.0');
  assert.equal(read('legacy.json'), legacyBefore);
  assert.throws(() => read('posts'), { code: 'ENOENT' });

  const { digest, entries } = await planIncidentBatch([{ ...task(3, 137, 4), oomKilled: true }], { selection: { attempts: [{ uuid: id(3), attempt: 1 }] } });
  assert.equal(entries[0].id, id(3));
  assert.equal(digest, null);
  await assert.rejects(() => applyIncidentBatch(plan, { approve: plan.digest }), /current legacy ledger/);
  const currentLedger = JSON.parse(legacyBefore);
  currentLedger.reported[`${repository} ${id(1)}#2`] = { url: issueUrl(25) };
  write('current-legacy.json', currentLedger);
  const applied = json(['apply', '--plan', 'reviewed.json', '--approve', summary.digest, '--legacy-ledger', 'current-legacy.json']);
  assert.equal(applied.outcomes[1].url, issueUrl(25));
  assert.throws(() => read('posts'), { code: 'ENOENT' });

  write('selection.json', { window: { from: at(1), to: at(5) }, limit: 1 });
  assert.match(run(planArgs('overflow.json')).stderr, /exceeds the batch limit/);
  assert.throws(() => read('overflow.json'), { code: 'ENOENT' });
});

test('resume a partially applied plan and preserve each confirmed receipt', { timeout: 30_000 }, t => {
  const { write, read, receipts, json, run } = fixture(t);
  write('records.json', [task(1, 1, 1), task(2, 143, 2), task(3, 127, 3)]);
  write('selection.json', {
    attempts: [
      { uuid: id(1), attempt: 1 },
      { uuid: id(2), attempt: 1, hostSignature: 'host-reset' },
      { uuid: id(3), attempt: 1, installedVersion: '2.49.0' },
    ],
  });
  write('policy.json', {
    destination: repository,
    visibility: 'private',
    allow: ['create-issue', 'comment', 'regression-issue'],
    routes: [
      { backend: 'docker', kind: 'Signal-range exit code', exitCode: 143, issue: 10, signature: 'host-reset' },
      { backend: 'docker', kind: 'Command unavailable (exit 127)', exitCode: 127, issue: 11 },
    ],
  });
  write('issue-11', { number: 11, state: 'closed', closed_at: at(4), comments: 0 });
  write('releases', { 'v2.49.0': at(5) });
  const { digest } = json(planArgs('reviewed.json', '--policy', 'policy.json'));
  const reviewed = JSON.parse(read('reviewed.json'));
  assert.match(reviewed.entries[1].report.body, /Reviewed host journal correlation `host-reset`/);
  assert.match(reviewed.entries[2].report.body, /Possible regression of https:\/\/github.com\/example\/project\/issues\/11/);
  const args = ['apply', '--plan', 'reviewed.json', '--approve', digest];

  assert.match(run([...args.slice(0, -1), `sha256:${'0'.repeat(64)}`]).stderr, /approved digest/);
  const altered = JSON.parse(read('reviewed.json'));
  altered.entries[0].report.body += 'changed';
  write('tampered.json', altered);
  assert.match(run(['apply', '--plan', 'tampered.json', '--approve', digest]).stderr, /approved digest/);
  write('visibility', JSON.stringify('public'));
  assert.match(json(args, 1).outcomes[0].reason, /visibility differs/);
  assert.throws(() => read('posts'), { code: 'ENOENT' });
  assert.deepEqual(receipts(), {});
  write('visibility', JSON.stringify('private'));

  const partial = json(args, 1, { LOSE_COMMENT_RESPONSE: 'yes' });
  assert.deepEqual(
    partial.outcomes.map(value => value.state),
    ['published', 'blocked', 'remaining']
  );
  assert.match(partial.outcomes[1].reason, /could not be confirmed/);
  assert.equal(JSON.parse(read('posts')).length, 2);
  const first = Object.entries(receipts()).find(([, contents]) => JSON.parse(contents).url === issueUrl(100));
  assert.ok(first);

  write('issue-11', { number: 11, state: 'closed', closed_at: at(6), comments: 0 });
  const changedRoute = json(args, 1);
  assert.deepEqual(
    changedRoute.outcomes.map(value => value.state),
    ['already-reported', 'already-reported', 'blocked']
  );
  assert.match(changedRoute.outcomes[2].reason, /release review changed/);
  assert.equal(JSON.parse(read('posts')).length, 2);
  write('issue-11', { number: 11, state: 'closed', closed_at: at(4), comments: 0 });
  const resumed = json(args);
  assert.deepEqual(
    resumed.outcomes.map(value => value.state),
    ['already-reported', 'already-reported', 'published']
  );
  assert.equal(resumed.outcomes[1].url, `${issueUrl(10)}#issuecomment-123`);
  const posts = JSON.parse(read('posts'));
  assert.deepEqual(
    posts.map(value => value.action),
    ['create', 'comment', 'create']
  );
  assert.deepEqual(
    posts.map(value => value.body.split('\n')[0]),
    [nativeMarker(1, 1), nativeMarker(2, 1), nativeMarker(3, 1)]
  );
  assert.equal(receipts()[first[0]], first[1]);
  assert.equal(Object.keys(receipts()).length, 3);
  assert.ok(json(args, 0, { SEARCH_UNAVAILABLE: 'yes' }).outcomes.every(value => value.source === 'batch-receipt'));

  write('selection.json', { attempts: [{ uuid: id(2), attempt: 1 }] });
  write('policy.json', { destination: repository, visibility: 'private', allow: ['create-issue'] });
  const crossRun = json(planArgs('later.json', '--policy', 'policy.json'), 0, { SEARCH_UNAVAILABLE: 'yes' });
  const later = JSON.parse(read('later.json'));
  assert.equal(later.entries[0].found.url, `${issueUrl(10)}#issuecomment-123`);
  assert.equal(json(['apply', '--plan', 'later.json', '--approve', crossRun.digest]).outcomes[0].state, 'already-reported');
  assert.deepEqual(JSON.parse(read('posts')), posts);
});

test('recover a newly created issue before indexing and hold an unresolved write', { timeout: 30_000 }, t => {
  const { write, read, json } = fixture(t);
  write('records.json', [task(1, 1, 1)]);
  write('selection.json', { attempts: [{ uuid: id(1), attempt: 1 }] });
  write('policy.json', { destination: repository, visibility: 'private', allow: ['create-issue'] });
  const { digest } = json(planArgs('reviewed.json', '--policy', 'policy.json'));
  const args = ['apply', '--plan', 'reviewed.json', '--approve', digest];
  assert.equal(json(args, 1, { LOSE_CREATE_RESPONSE: 'yes' }).outcomes[0].state, 'blocked');

  const recent = read('recent');
  write('recent', []);
  assert.match(json(args, 1).outcomes[0].reason, /previous GitHub write is unconfirmed/);
  assert.equal(JSON.parse(read('posts')).length, 1);
  write('recent', recent);
  const result = json(args, 0, { SEARCH_UNAVAILABLE: 'yes' });
  assert.equal(result.outcomes[0].url, issueUrl(100));
  assert.equal(JSON.parse(read('posts')).length, 1);
});
