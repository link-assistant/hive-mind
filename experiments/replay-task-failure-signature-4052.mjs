import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import { collectTaskEvidence } from '../src/hive-manager/index.mjs';

const fixtures = JSON.parse(await readFile(new URL('../docs/case-studies/issue-4052/attempts.json', import.meta.url), 'utf8'));
const [uuid, logPath] = process.argv.slice(2);
const fixture = fixtures.find(attempt => attempt.uuid === uuid);
if (!fixture || !logPath) {
  process.stderr.write('Usage: node experiments/replay-task-failure-signature-4052.mjs UUID ATTEMPT_LOG\n');
  process.exitCode = 2;
} else {
  const task = { ...fixture, logPath, status: 'executed', startTime: fixture.startedAt, endTime: fixture.finishedAt };
  const { evidence } = await collectTaskEvidence([task], { uuid });
  process.stdout.write(`${JSON.stringify({ uuid, expected: fixture.signature, observed: evidence.signature ?? null, available: evidence.available })}\n`);
  process.exitCode = evidence.signature === fixture.signature ? 0 : 1;
}
