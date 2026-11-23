import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveBotStateDir } from '../../../session-store.lib.mjs';
import { withStateLock } from '../../../state-lock.lib.mjs';
import { reportUrl } from './issue-history.mjs';

const run = promisify(execFile);

export function incidentKey(destination, marker, followUp) {
  return createHash('sha256')
    .update(`${destination}${followUp === undefined ? '' : `#${followUp}`}\0${marker}`)
    .digest('hex');
}

export function publicationUrl(destination, followUp, url) {
  const valid = reportUrl(destination, url);
  if (!valid) return null;
  const [issue, comment] = valid.split('/').at(-1).split('#');
  return followUp === undefined ? (!comment ? valid : null) : Number(issue) === followUp && comment ? valid : null;
}

export async function postIncident({ destination, followUp, title, body }) {
  const action = followUp === undefined ? ['create', '--title', title] : ['comment', String(followUp)];
  // github-retry-ok: a timed out mutation may already exist. Reconcile its exact marker before any further write.
  const { stdout } = await run('gh', ['issue', ...action, '--repo', `github.com/${destination}`, '--body', body], { timeout: 30_000, maxBuffer: 4096 });
  const url = publicationUrl(destination, followUp, stdout.trim());
  if (!url) throw new Error('GitHub returned no confirmed incident URL.');
  return url;
}

async function readState(path) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid incident publication record.');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Could not read the local incident publication record.', { cause: error });
  }
}

export async function readSinglePublication(destination, marker, followUp) {
  const path = join(resolveBotStateDir(), `incident-${incidentKey(destination, marker, followUp)}.json`);
  const state = await readState(path);
  if (state === null || state.pending === true) return state;
  const url = publicationUrl(destination, followUp, state.url);
  if (!url) throw new Error('The single-incident receipt has no confirmed incident URL.');
  return { source: 'single-incident-receipt', url };
}

export function batchPublicationState(destination, marker) {
  const key = incidentKey(destination, marker);
  const path = join(resolveBotStateDir(), `incident-batch-${key}.json`);
  return {
    path,
    read: () => readState(path),
    lock: operation => withStateLock(`hive-manager-incident-batch-${key}`, operation, { staleMs: 60 * 60 * 1000 }),
    write: async state => {
      const temp = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify(state)}\n`, { flag: 'wx', mode: 0o600 });
        await rename(temp, path);
      } finally {
        await rm(temp, { force: true });
      }
    },
  };
}
