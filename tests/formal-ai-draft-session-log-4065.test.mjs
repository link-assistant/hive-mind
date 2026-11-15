/**
 * A red draft is explained from solve's own `solve-*.log`, not from whichever
 * `*.log` in the log directory is newest (issue #4065).
 *
 * Run 43730396084 (job 132863770040) logged "⚠️  Finished without changes: the
 * session produced no change …", yet was annotated "docker run exited 5
 * without a session log error": formal-ai's capture files `attempt.log` and
 * `attempt.stdout.log` sat in the same directory and, rewritten on every output
 * chunk, were always newer than `solve-*.log`.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/4065
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { draftFailureMessage, selectSessionLog } from '../scripts/formal-ai-draft.lib.mjs';

const script = fileURLToPath(new URL('../scripts/formal-ai-draft.mjs', import.meta.url));
const FINISHED = '⚠️  Finished without changes: the session produced no change: no new commit, no file change and no comment';
const REASON = 'Finished without changes: the session produced no change: no new commit, no file change and no comment';

const withDir = fn => {
  const root = mkdtempSync(join(tmpdir(), 'formal-ai-draft-4065-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('solve-*.log is chosen over a newer co-located *.log', () => {
  assert.equal(
    selectSessionLog([
      { name: 'solve-2026-11-15T15-30-00-000Z.log', mtimeMs: 1 },
      { name: 'attempt.log', mtimeMs: 3 },
      { name: 'attempt.stdout.log', mtimeMs: 2 },
    ]),
    'solve-2026-11-15T15-30-00-000Z.log'
  );
  assert.equal(
    selectSessionLog([
      { name: 'solve-a.log', mtimeMs: 1 },
      { name: 'solve-b.log', mtimeMs: 2 },
      { name: 'z.log', mtimeMs: 9 },
    ]),
    'solve-b.log',
    'the newest solve log wins among several'
  );
  assert.equal(
    selectSessionLog([
      { name: 'formal-ai-draft-failure.log', mtimeMs: 1 },
      { name: 'notes.txt', mtimeMs: 2 },
    ]),
    'formal-ai-draft-failure.log',
    'any *.log is the fallback when there is no solve log'
  );
  assert.equal(selectSessionLog([{ name: 'attempt.capture.jsonl', mtimeMs: 1 }]), null);
  assert.equal(selectSessionLog([]), null);
});

test('the issue reproduction: a newer z.log no longer hides "Finished without changes"', () =>
  withDir(dir => {
    writeFileSync(join(dir, 'solve-x.log'), `[2026-11-15T15:49:46.000Z] [INFO] ${FINISHED}\n`);
    writeFileSync(join(dir, 'z.log'), 'formal-ai capture\n[2026-11-15T15:50:01.000Z] ❌ unrelated capture error\n');
    utimesSync(join(dir, 'solve-x.log'), new Date('2026-11-15T15:49:46Z'), new Date('2026-11-15T15:49:46Z'));
    assert.equal(draftFailureMessage({ logDir: dir, status: 5 }), REASON);
  }));

test('without any session log the fallback message still names the exit status', () =>
  withDir(dir => {
    assert.equal(draftFailureMessage({ logDir: dir, status: 5 }), 'docker run exited 5 without a session log error');
    assert.equal(draftFailureMessage({ logDir: join(dir, 'missing'), status: 7 }), 'docker run exited 7 without a session log error');
  }));

test('the draft script annotates the solve log reason when a newer *.log sits next to it', { timeout: 30_000 }, () =>
  withDir(root => {
    const bin = join(root, 'bin');
    mkdirSync(bin);
    // `docker run` writes solve's log, then a caller's capture file after it, and exits 5 like solve does.
    writeFileSync(
      join(bin, 'docker'),
      `#!/bin/sh
if [ "$1" = "run" ]; then
  printf '%s\\n' '[2026-11-15T15:49:46.000Z] [INFO] ${FINISHED}' > "$FORMAL_AI_DRAFT_LOG_DIR/solve-2026-11-15T15-30-00-000Z.log"
  touch -t 202611151549.46 "$FORMAL_AI_DRAFT_LOG_DIR/solve-2026-11-15T15-30-00-000Z.log"
  printf 'runner summary\\n' > "$FORMAL_AI_DRAFT_LOG_DIR/attempt.stdout.log"
  printf 'runner summary\\n' > "$FORMAL_AI_DRAFT_LOG_DIR/attempt.log"
  exit 5
fi
exit 0
`
    );
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "[]"\n');
    chmodSync(join(bin, 'docker'), 0o755);
    chmodSync(join(bin, 'gh'), 0o755);

    const event = join(root, 'event.json');
    writeFileSync(event, JSON.stringify({ action: 'opened', issue: { number: 4065, html_url: 'https://github.com/link-assistant/hive-mind/issues/4065', labels: [], user: { login: 'someone', type: 'User' } } }));
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_EVENT_NAME: 'issues', GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'link-assistant/hive-mind', FORMAL_AI_DRAFT_LOG_DIR: join(root, 'logs'), FORMAL_AI_DRAFT_IMAGE: 'konard/hive-mind:test' },
    });
    assert.equal(result.status, 5, result.stdout + result.stderr);
    assert.match(result.stdout, /::error title=Formal AI draft failed::Finished without changes: the session produced no change/u);
    assert.doesNotMatch(result.stdout, /without a session log error/u);
  })
);
