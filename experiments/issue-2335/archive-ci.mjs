import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const directory = new URL('../../docs/case-studies/issue-2335/data/', import.meta.url);
const runs = JSON.parse(await readFile(new URL('agent-pr-326-ci-runs.json', directory), 'utf8'));
const manifest = [];
for (const run of runs) {
  const file = `agent-ci-${run.id}.log.gz`;
  try {
    const { stdout } = await promisify(execFile)('gh', ['run', 'view', String(run.id), '--repo', 'link-assistant/agent', '--log'], { maxBuffer: 40 * 1024 * 1024 });
    await writeFile(new URL(file, directory), gzipSync(stdout, { level: 9 }));
    manifest.push({ id: run.id, name: run.name, headSha: run.head_sha, createdAt: run.created_at, conclusion: run.conclusion, url: run.html_url, file, uncompressedSha256: createHash('sha256').update(stdout).digest('hex') });
    console.log(`${run.id}: archived ${stdout.length} characters`);
  } catch (error) {
    const unavailable = `agent-ci-${run.id}-unavailable.txt`;
    await writeFile(new URL(unavailable, directory), String(error.stderr || error.message));
    manifest.push({ id: run.id, name: run.name, url: run.html_url, file: unavailable, unavailable: true });
    console.log(`${run.id}: unavailable; saved GitHub response`);
  }
}
await writeFile(new URL('agent-ci-manifest.json', directory), `${JSON.stringify(manifest, null, 2)}\n`);
