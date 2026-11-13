/**
 * A draft that fails before solve starts must still leave evidence in the log
 * directory the workflow uploads (issue #4050).
 *
 * Run 43274283479 failed to pull konard/hive-mind:2.40.1, exited, and the
 * "Upload the session log" step then warned "No files were found with the
 * provided path" — the artifact that should explain a red draft was empty.
 * This reproduces the same early exit with a missing FORMAL_AI_DRAFT_BINARY,
 * which fails through the same `fail()` path without Docker or the network.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/4050
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/formal-ai-draft.mjs', import.meta.url));

test('a draft that fails before solve writes its failure into the uploaded log directory', { timeout: 30_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'formal-ai-draft-4050-'));
  try {
    const event = join(root, 'event.json');
    writeFileSync(event, JSON.stringify({ action: 'opened', issue: { number: 4050, html_url: 'https://github.com/link-assistant/hive-mind/issues/4050', labels: [], user: { login: 'someone', type: 'User' } } }));
    const logDir = join(root, 'logs');
    const missingBinary = join(root, 'missing', 'formal-ai');
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, GITHUB_EVENT_NAME: 'issues', GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'link-assistant/hive-mind', FORMAL_AI_DRAFT_LOG_DIR: logDir, FORMAL_AI_DRAFT_BINARY: missingBinary },
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /::error title=[^:]+::FORMAL_AI_DRAFT_BINARY is /);
    assert.deepEqual(readdirSync(logDir), ['formal-ai-draft-failure.log']);
    const recorded = readFileSync(join(logDir, 'formal-ai-draft-failure.log'), 'utf8');
    assert.match(recorded, /^\d{4}-\d{2}-\d{2}T\S+ FORMAL_AI_DRAFT_BINARY is .*missing\/formal-ai, which does not exist/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
