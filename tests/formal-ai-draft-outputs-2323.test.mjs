/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('a failed default-token solve still exposes its head for dispatched checks', { timeout: 60_000 }, () => {
  const work = mkdtempSync(join(tmpdir(), 'draft-outputs-2323-'));
  try {
    writeFileSync(join(work, 'docker'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });
    writeFileSync(
      join(work, 'gh'),
      `#!/bin/sh
if [ "$1 $2" = "pr list" ]; then
  printf '%s\\n' '[{"number":12,"headRefName":"issue-42-test","isDraft":true}]'
else
  exit 1
fi
`,
      { mode: 0o755 }
    );
    const event = join(work, 'event.json');
    const output = join(work, 'output');
    const summary = join(work, 'summary');
    writeFileSync(event, JSON.stringify({ action: 'opened', issue: { number: 42, html_url: 'https://github.com/o/r/issues/42', user: { type: 'User' }, labels: [] } }));
    let status;
    try {
      execFileSync(process.execPath, [resolve('scripts/formal-ai-draft.mjs')], { env: { ...process.env, PATH: `${work}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_NAME: 'issues', GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, AUTOMATION_LAYER: 'default', FORMAL_AI_DRAFT_LOG_DIR: join(work, 'logs'), GH_TOKEN: '' }, stdio: 'pipe' });
      status = 0;
    } catch (error) {
      status = error.status;
    }
    assert.equal(status, 7, 'the model failure remains visible');
    const outputs = readFileSync(output, 'utf8');
    assert.match(outputs, /should_run=true/);
    assert.match(outputs, /check_strategy=dispatch/);
    assert.match(outputs, /head_ref=issue-42-test/);
    assert.match(outputs, /pull_request=12/);
    assert.match(readFileSync(summary, 'utf8'), /layer default/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
