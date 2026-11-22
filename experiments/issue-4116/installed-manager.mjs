import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const cwd = resolve(process.argv[2]);
const consumer = `
  import assert from 'node:assert/strict';
  import { HiveManagerError, inspectTasks, previewTaskRecordRepair } from '@link-assistant/hive-mind/hive-manager';

  assert.deepEqual(process.argv.slice(1), ['--help']);
  assert.ok(import.meta.resolve('@link-assistant/hive-mind').endsWith('/src/hive.mjs'));
  assert.ok(import.meta.resolve('@link-assistant/hive-mind/package.json').endsWith('/package.json'));
  assert.equal(inspectTasks([]).counts.running, 0);
  await assert.rejects(previewTaskRecordRepair({ uuids: ['invalid'] }), { name: 'HiveManagerError', code: 'INVALID_INPUT' });
  assert.throws(() => inspectTasks([], { limit: -1 }), HiveManagerError);
  process.stdout.write('manager package import passed\\n');
`;

// Node's permission model denies writes and subprocess creation during import.
const imported = spawnSync(process.execPath, ['--permission', '--allow-fs-read=*', '--input-type=module', '--eval', consumer, '--', '--help'], { cwd, encoding: 'utf8', timeout: 10000 });
assert.ifError(imported.error);
assert.equal(imported.status, 0, imported.stderr);
assert.equal(imported.stderr, '');
assert.equal(imported.stdout, 'manager package import passed\n');

const cli = spawnSync('./node_modules/.bin/hive-manager', ['--help'], { cwd, encoding: 'utf8', timeout: 10000 });
assert.ifError(cli.error);
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /Usage: hive-manager/);
process.stdout.write(imported.stdout);
