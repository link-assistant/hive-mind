import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ghWithRateLimitRetry } from '../src/github-rate-limit.lib.mjs';

const execFileAsync = promisify(execFile);
export const gh = async args => (await ghWithRateLimitRetry(() => execFileAsync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))).stdout;
export const ghJson = async args => JSON.parse(await gh(args));

/** Structured API payloads never enter a shell or command line. */
export async function ghApi(endpoint, { method = 'GET', body, paginate = false } = {}) {
  const args = ['api', endpoint, '--method', method];
  if (paginate) args.push('--paginate', '--slurp');
  let directory;
  try {
    if (body !== undefined) {
      directory = await mkdtemp(join(tmpdir(), 'hive-github-api-'));
      const file = join(directory, 'request.json');
      await writeFile(file, JSON.stringify(body));
      args.push('--input', file);
    }
    const output = await gh(args);
    return output.trim() ? JSON.parse(output) : null;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export async function ghList(endpoint) {
  const pages = await ghApi(endpoint, { paginate: true });
  return pages.flat();
}
