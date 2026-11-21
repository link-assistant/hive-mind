// Run on a Linux Docker host with Node >= 24. This creates one disposable
// container and named volume and downloads the pinned scanner for the preview.
import assert from 'node:assert/strict';
import { log } from 'node:console';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { localDocker } from '../../src/hive-manager/storage/lib/docker.mjs';
import { pinnedScanner } from '../../src/hive-manager/storage/lib/scanner.mjs';
import { diskReport } from '../../src/hive-manager/storage/report.mjs';

const docker = localDocker();
const execution = randomUUID();
const name = `hive-storage-fixture-${execution.slice(0, 8)}`;
const volume = `${name}-data`;
const target = 'https://github.com/link-assistant/hive-mind/issues/4109';
const stage = mkdtempSync(join(tmpdir(), 'hive-storage-experiment-'));
const image = process.env.HIVE_STORAGE_FIXTURE_IMAGE || 'node:24-alpine';
try {
  const id = await docker(['run', '--detach', '--name', name, '--env', 'YARN_CACHE_FOLDER=/root/.cache/yarn', '--label', `start-command.uuid=${execution}`, '--label', `start-command.session=${name}`, '--mount', `type=volume,source=${volume},target=/root/.cache/pip`, image, 'sh', '-ec', 'mkdir -p /root/.cache/yarn; dd if=/dev/urandom of=/root/.cache/yarn/old bs=1M count=2; dd if=/dev/urandom of=/root/.cache/pip/mounted bs=1M count=2; touch -t 202401010000 /root/.cache/yarn /root/.cache/yarn/old /root/.cache/pip/mounted; exec sleep 180'], { ms: 60_000 });

  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await docker(['exec', name, 'sh', '-c', 'test -f /root/.cache/pip/mounted && echo ready || true'])) === 'ready') break;
    await delay(200);
  }
  const records = { executions: [{ uuid: execution, command: `solve ${target}`, options: { isolated: 'docker', containerId: id, sessionName: name } }] };
  writeFileSync(join(stage, '$'), `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(records)}'\n`, { mode: 0o700 });
  process.env.PATH = `${stage}:${process.env.PATH}`;
  await docker(['pause', id]);
  const report = await diskReport(docker, 'hive-storage-fixture-missing-bot', 10);
  const row = report.containers.find(row => row.id === id);
  assert.equal(row?.state, 'paused', JSON.stringify(report.issues));
  assert.equal(row.execution, execution);
  assert.equal(row.target, target);
  assert.equal(row.recordMatched, true);
  if (row.writableBytes === null) assert.ok(report.issues.some(issue => issue.startsWith(`${name} writable layer`)));
  else assert.ok(row.writableBytes >= 2 * 1024 ** 2);
  log(JSON.stringify({ task: row, volume: report.volumes.find(item => item.name === volume) }));
  await docker(['unpause', id]);
  const scan = await pinnedScanner(stage, () => {});
  const candidates = await scan(['/root/.cache/pip'], docker, id);
  assert.ok(candidates.includes('/root/.cache/yarn'), JSON.stringify(candidates));
  assert.ok(!candidates.some(path => path.startsWith('/root/.cache/pip')));
  const active = await docker(['exec', id, 'sh', '-ec', `node -e 'process.title = "yarn"; require("node:fs").openSync("/root/.cache/yarn/old"); setTimeout(() => {}, 60000)' </dev/null >/dev/null 2>&1 & echo $!`]);
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await docker(['exec', id, 'cat', `/proc/${active}/comm`])) === 'yarn') break;
    await delay(200);
  }
  assert.equal(await docker(['exec', id, 'cat', `/proc/${active}/comm`]), 'yarn');
  assert.ok(!(await scan(['/root/.cache/pip'], docker, id)).includes('/root/.cache/yarn'));
  await docker(['exec', id, 'test', '-f', '/root/.cache/pip/mounted']);
  log(JSON.stringify({ candidates, activeCache: '/root/.cache/yarn', protectedMount: '/root/.cache/pip' }));
} finally {
  await docker(['unpause', name]).catch(() => {});
  await docker(['container', 'rm', '--force', name]).catch(() => {});
  await docker(['volume', 'rm', volume]).catch(() => {});
  rmSync(stage, { recursive: true, force: true });
}
