import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const locations = process.argv.slice(2);
assert.equal(locations.length, 2, 'Pass the installed start-command package directories for 0.44.0 and 0.45.0.');

const installations = locations.map(location => {
  const require = createRequire(resolve(location, 'package.json'));
  return {
    version: require('./package.json').version,
    decode: require('lino-objects-codec').decode,
    ...require('./src/lib/execution-store.js'),
  };
});
assert.deepEqual(
  installations.map(({ version }) => version),
  ['0.44.0', '0.45.0']
);

const cwd = mkdtempSync(join(tmpdir(), 'hive-start-store-'));
try {
  const uuid = '41360000-0000-4000-abcd-000000000001';
  const fixture = {
    uuid,
    status: 'executed',
    exitCode: 1,
    command: 'printf "hello world\\n"',
    startTime: '2026-11-20T08:00:00.000Z',
    endTime: '2026-11-20T08:15:00.000Z',
    options: { isolated: 'docker', isolationMode: 'detached', sessionName: 'fixture', resumeCount: 0 },
    attempt: { number: 1, exitCode: 1 },
  };

  for (const [index, writer] of installations.entries()) {
    const reader = installations[1 - index];
    const record = new writer.ExecutionRecord(fixture);
    const source = new writer.ExecutionStore({ appFolder: join(cwd, `written-${writer.version}`), useLinks: false });
    source.writeLinoRecords([record]);
    const notation = readFileSync(source.linoDbPath, 'utf8');

    // Preview decodes the Lino file directly. Use a separate folder to confirm
    // the apply path can also read it without a previously decoded copy.
    const decoded = reader.decode({ notation });
    assert.deepEqual(reader.ExecutionRecord.fromObject(decoded[0]).toObject(), record.toObject());
    const destination = new reader.ExecutionStore({ appFolder: join(cwd, `read-${reader.version}`), useLinks: false });
    writeFileSync(destination.linoDbPath, notation);
    assert.deepEqual(destination.get(uuid)?.toObject(), record.toObject());
    console.log(`start-command ${reader.version} reads the Docker execution record written by ${writer.version}`);
  }
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
