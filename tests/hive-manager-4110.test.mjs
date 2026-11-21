/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const manager = process.env.HIVE_MANAGER_UNDER_TEST ?? fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
const gib = 1024 ** 3;
const id = n => `41100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const target = n => `https://github.com/example/project/issues/${n}`;
const recover = ['tasks', 'recover-failed'];

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-manager-4110-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'state'));
  const write = (file, contents) => writeFileSync(join(cwd, file), typeof contents === 'string' ? contents : JSON.stringify(contents));
  const executable = (name, body) => writeFileSync(join(cwd, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o700 });
  const run = (argv, env = {}) =>
    spawnSync('bash', [manager, ...argv], {
      cwd,
      env: { ...process.env, PATH: `${cwd}:${process.env.PATH}`, DOCKER_HOST: '', DOCKER_CONTEXT: '', HIVE_MIND_STATE_DIR: join(cwd, 'state'), ...env },
      encoding: 'utf8',
      timeout: 10_000,
    });
  const preview = (args, env) => {
    const result = run(args, env);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { write, executable, run, preview, read: file => readFileSync(join(cwd, file), 'utf8') };
}

function task(n, patch = {}) {
  return {
    uuid: id(n),
    command: `solve ${target(n)}`,
    status: 'executed',
    exitCode: 137,
    oomKilled: true,
    startTime: `2026-11-${String(n).padStart(2, '0')}T00:00:00Z`,
    options: { isolated: 'docker', isolationMode: 'detached', rootSession: `task-${n}`, sessionName: `task-${n}` },
    ...patch,
  };
}

function recoveryFixture(t) {
  const env = fixture(t);
  env.executable(
    '$',
    `case "$1" in
  --list) if [[ -s invoked && -f completed ]]; then cat completed; else cat records; fi ;;
  --resume) printf '%s\\n' "$@" > invoked ;;
  *) exit 1 ;;
esac`
  );
  env.executable(
    'docker',
    `case "$1" in
  ps) cat active ;;
  context) echo "${'${DOCKER_ENDPOINT:-unix:///var/run/docker.sock}'}" ;;
  info) cat storage ;;
  container) cat "inspect-${'${!#}'}" ;;
  *) exit 1 ;;
esac`
  );
  env.executable(
    'df',
    `[[ $1 == -Pk ]]
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n'
available="${'${AVAILABLE_BLOCKS:-16777216}'}"
if [[ "$2" == /containerd && -n "${'${CONTAINERD_BLOCKS:-}'}" ]]; then available="$CONTAINERD_BLOCKS"; fi
if [[ -n "${'${SPACE_CHANGES:-}'}" ]]; then
  if [[ -f disk-checked ]]; then available=0; fi
  touch disk-checked
fi
printf 'fixture 20971520 4096 %s 33%% /\\n' "$available"`
  );
  env.write('active', '');
  env.write('storage', { DockerRootDir: '/docker' });
  const setRecords = (...executions) => {
    env.write('records', { executions });
    for (const { uuid, options, exitCode } of executions) {
      const { sessionName, rootSession } = options;
      env.write(`inspect-${sessionName}`, { id: 'a'.repeat(64), name: `/${sessionName}`, state: 'exited', exitCode, size: gib, labels: { 'start-command.uuid': uuid, 'start-command.root-session': rootSession } });
    }
  };
  return { ...env, setRecords };
}

test('review and resume a known Telegram alias and a policy-approved later OOM attempt', { timeout: 20_000 }, t => {
  const { write, run, read, preview, setRecords } = recoveryFixture(t);
  const later = task(2, { options: { ...task(2).options, sessionName: 'task-2-resume-1', resumeCount: 1 }, attempt: { number: 2 } });
  const alias = task(3, { exitCode: 127, oomKilled: false, logPath: 'execution.log', command: `/codex '${target(3)}' --tool claude --resume stale-id --prompt "it's a $fixture"` });
  setRecords(task(1), later, alias, task(4, { exitCode: 127, command: `/unknown ${target(4)}` }));
  write('execution.log', 'Session ID: first-session\nSession ID: latest-session\n');
  const candidates = preview(recover).candidates;
  assert.deepEqual(
    candidates.map(({ id }) => id),
    [id(1)]
  );
  assert.deepEqual(candidates[0].snapshot, { state: 'ready', writableLayerBytes: gib, requiredBytes: 12 * gib, availableBytes: 16 * gib });
  const select = (n, attempt) => [...recover, '--execution', id(n), '--attempt', String(attempt)];
  assert.deepEqual(preview(select(2, 2)).candidates, []);
  assert.deepEqual(preview([...select(2, 1), '--max-resumes', '2']).candidates, []);
  assert.match(run([...select(2, 2), '--max-resumes', '11']).stderr, /limit between 1 and 10/);
  assert.deepEqual(preview(select(4, 1)).candidates, []);
  const aliasReview = preview(select(3, 1));
  assert.equal(aliasReview.candidates[0].recovery, 'telegram-alias');
  assert.doesNotMatch(JSON.stringify(aliasReview), /latest-session|prompt|fixture|github.com/);
  assert.throws(() => read('invoked'), { code: 'ENOENT' });

  const aliasApply = preview([...select(3, 1), '--apply']);
  assert.equal(aliasApply.outcomes[0].state, 'resumed');
  assert.deepEqual(read('invoked').trim().split('\n'), ['--resume', id(3), '--output-format', 'json', '--', `'solve' '${target(3)}' '--prompt' 'it'\\''s a $fixture' '--tool' 'codex' '--resume' 'latest-session'`]);

  // Reset the mock launch log before allowing the fixture to finish the next launch.
  write('invoked', '');
  const reviewed = [...select(2, 2), '--max-resumes', '2'];
  assert.equal(preview(reviewed).candidates[0].nextAttempt, 3);
  write('completed', { executions: [{ ...later, status: 'executing', attempt: { number: 4 }, attemptHistory: [{ number: 3, status: 'executed', exitCode: 0 }] }] });
  const result = run([...reviewed, '--apply', '--wait', '1']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).outcomes[0].completion, { attempt: 3, exitCode: 0, finishedAt: null });
  assert.deepEqual(read('invoked').trim().split('\n'), ['--resume', id(2), '--output-format', 'json']);
});

test('recheck writable-layer space and defer active or bot-tracked families and newer successes', { timeout: 20_000 }, t => {
  const { write, read, run, preview, setRecords } = recoveryFixture(t);
  const records = [task(1), task(2), task(3), task(4), task(5, { exitCode: 0, command: `solve ${target(3)}` }), task(6, { paused: true, command: 'unknown command', options: { ...task(6).options, rootSession: 'task-4' } })];
  setRecords(...records);
  write('state/sessions.json', { sessions: { 'task-2': { executionUuid: id(2), url: target(2) } } });
  assert.deepEqual(
    preview(recover).candidates.map(({ id }) => id),
    [id(1)]
  );
  write('storage', { DockerRootDir: '/docker', DriverStatus: [['driver-type', 'io.containerd.snapshotter.v1']] });
  const containerd = { START_CONTAINERD_ROOT: '/containerd' };
  const policy = [...recover, '--execution', id(1), '--attempt', '1'];
  assert.equal(preview(policy, { ...containerd, CONTAINERD_BLOCKS: '1' }).candidates[0].snapshot.state, 'insufficient-space');
  assert.equal(preview(policy, { DOCKER_ENDPOINT: 'ssh://example' }).candidates[0].snapshot.state, 'free-space-unknown');
  write('storage', { DockerRootDir: '/docker' });
  const result = run([...policy, '--apply'], { SPACE_CHANGES: '1' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).candidates[0].snapshot.state, 'ready');
  assert.equal(JSON.parse(result.stdout).outcomes[0].reason, 'insufficient-space');
  assert.throws(() => read('invoked'), { code: 'ENOENT' });
  write('active', `task-1-resume-1\ttask-1\t${id(1)}\n`);
  assert.deepEqual(preview(policy).candidates, []);
  write('active', '');
  write('inspect-task-1', { id: 'a'.repeat(64), name: '/task-1', state: 'exited', exitCode: 137, size: null });
  assert.equal(preview(policy).candidates[0].snapshot.state, 'writable-layer-unknown');
  setRecords(task(7, { exitCode: 127, command: `/codex ${target(7)} --prompt test; touch unexpected` }));
  assert.equal(preview([...recover, '--execution', id(7), '--attempt', '1']).candidates[0].blocked, 'unrecognized-alias-arguments');
});

test('reconcile exact legacy keys and classify closed routes without issuing a publish digest', { timeout: 20_000 }, t => {
  const { write, executable, read, run, preview } = fixture(t);
  write('records', { executions: [task(1, { attempt: { number: 2 }, attemptHistory: [{ number: 1, status: 'executed', exitCode: 127 }] })] });
  write('results', [{ incomplete_results: false, total_count: 0, items: [] }]);
  write('comments', [[]]);
  const closedAt = '2026-11-20T00:00:00Z';
  write('issue', { number: 8, state: 'closed', closed_at: closedAt });
  write('release', { published_at: '2026-11-19T00:00:00Z' });
  executable('$', '[[ "$*" == "--list --output-format json" ]]; cat records');
  // github-retry-ok: the executable below simulates GitHub and records any attempted write.
  executable(
    'gh',
    `case "$1 $2" in
  'api --hostname')
    case "$6" in
      search/issues) cat results ;;
      repos/example/project/issues/*/comments*) cat comments ;;
      repos/example/project/issues/8) cat issue ;;
      repos/link-assistant/hive-mind/releases/tags/v2.45.0)
        if [[ -n "${'${RELEASE_MISSING:-}'}" ]]; then echo 'gh: Not Found (HTTP 404)' >&2; exit 1; fi
        cat release ;;
      *) exit 1 ;;
    esac ;;
  'issue create'|'issue comment') touch wrote-to-github; exit 1 ;;
  *) exit 1 ;;
esac`
  );
  const base = ['tasks', 'report', '--incident', id(1), '--attempt', '2', '--destination', 'example/project'];
  write('routes', [{ backend: 'docker', kind: 'Memory exhaustion', exitCode: 137, issue: 8 }]);
  const related = [...base, '--routes', 'routes', '--installed-version', '2.45.0', '--reconcile'];
  const legacyUrl = 'https://github.com/example/project/issues/7';
  const ledger = [...related, '--legacy-ledger', 'ledger'];
  write('ledger', { reported: { [`OTHER/PROJECT ${id(1)}#2`]: { url: legacyUrl }, [`${id(1)}#2`]: { url: 'https://github.com/other/project/issues/7' } } });
  const missingFix = preview(ledger);
  assert.equal(missingFix.reconciliation.state, 'closed-after-installed-release');
  assert.equal(missingFix.reconciliation.relatedIssue.state, 'closed');
  assert.equal(missingFix.digest, undefined);

  write('release', { published_at: '2026-11-21T00:00:00Z' });
  assert.equal(preview(related).reconciliation.state, 'possible-regression');
  assert.equal(preview(related, { RELEASE_MISSING: 'yes' }).reconciliation.state, 'closed-issue-needs-version-review');
  write('ledger', { reported: { [`Example/Project ${id(1)}#2`]: { url: legacyUrl, fixedUpstream: true } } });
  assert.deepEqual(preview(ledger).reconciliation, {
    state: 'known-fix-recorded',
    attemptKey: `${id(1)}#2`,
    relatedIssue: { url: 'https://github.com/example/project/issues/8', state: 'closed' },
    source: 'legacy-ledger',
    url: legacyUrl,
    fixedUpstream: true,
  });
  write('ledger', { reported: { [`${id(1)}#2`]: { url: legacyUrl } } });
  assert.equal(preview(ledger).reconciliation.url, legacyUrl);

  const routedUrl = 'https://github.com/example/project/issues/8#issuecomment-9';
  write('comments', [[{ body: `<!-- hive-manager-task: ${id(1)}/2 -->`, html_url: routedUrl }]]);
  assert.equal(preview(related).reconciliation.url, routedUrl);
  write('comments', [[]]);
  write('results', [{ items: [{ number: 7, comments: 1, body: `<!-- auto-fix-key: ${id(1)}#20 -->` }] }]);
  assert.equal(preview([...base, '--reconcile']).reconciliation.state, 'unreported');
  const commentUrl = `${legacyUrl}#issuecomment-111`;
  write('comments', [[{ html_url: commentUrl, body: `<!-- auto-fix-key: ${id(1)}#2 -->` }]]);
  const historical = preview([...base, '--reconcile']).reconciliation;
  assert.equal(historical.source, 'legacy-marker');
  assert.equal(historical.url, commentUrl);
  const { digest } = preview(base);
  const duplicate = run([...base, '--publish', digest]);
  assert.equal(duplicate.status, 0, duplicate.stderr);
  assert.equal(duplicate.stdout.trim(), commentUrl);
  assert.match(run([...related, '--publish', digest]).stderr, /read-only/);
  assert.match(run([...base, '--follow-up', '8']).stderr, /requires an open GitHub issue/);
  assert.throws(() => read('wrote-to-github'), { code: 'ENOENT' });
});
