import { constants, createReadStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { resolveCiRunUrl } from '../src/ci-run-url.lib.mjs';
import { draftSessionReceiptPath, parseDraftSessionReceipt } from '../src/formal-ai-draft-session.lib.mjs';
import { formatWorkflowAnnotation } from './formal-ai-draft.lib.mjs';
import { FINAL_OUTCOME_ANNOTATION, OUTCOME_ANNOTATION, OUTCOME_FILE, parseDraftOutcome } from './formal-ai-draft-outcome.lib.mjs';
import { ghApi } from './github-actions.lib.mjs';

const sessionLogs = /^solve-[\w.-]+\.log$|^formal-ai-draft-failure\.log$/u;

async function listSessionLogs(logDir) {
  const entries = await readdir(logDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && sessionLogs.test(entry.name))
    .map(entry => entry.name)
    .sort();
}

/** Read the start for runtime identity and the tail for verdict and log publication. */
export async function readDraftSessionLog(logDir) {
  const names = (await listSessionLogs(logDir).catch(() => [])).filter(name => name.startsWith('solve-'));
  const name = names.at(-1);
  if (!name) return { log: '', session: null };
  try {
    const file = await open(join(logDir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) return { log: '', session: null };
      const { size } = stat;
      const headSize = Math.min(size, 64 * 1024);
      const tailStart = Math.max(headSize, size - 2 * 1024 * 1024);
      const head = Buffer.alloc(headSize);
      const tail = Buffer.alloc(size - tailStart);
      const first = await file.read(head, 0, head.length, 0);
      const last = await file.read(tail, 0, tail.length, tailStart);
      const log = head.subarray(0, first.bytesRead).toString('utf8') + (tailStart > headSize ? '\n' : '') + tail.subarray(0, last.bytesRead).toString('utf8');
      const session = parseDraftSessionReceipt(await readSmallRecord(draftSessionReceiptPath(join(logDir, name))));
      return { log, session };
    } finally {
      await file.close();
    }
  } catch {
    return { log: '', session: null };
  }
}

/** GITHUB_JOB is the YAML key. Match the runner in this exact run attempt for the numeric job URL. */
export async function draftRunLinks(env = process.env, api = ghApi) {
  const run = resolveCiRunUrl(env);
  const { GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: id, GITHUB_RUN_ATTEMPT: attempt, RUNNER_NAME: runner } = env;
  if (!run || !runner || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^\d+$/.test(id ?? '') || !/^\d+$/.test(attempt ?? '')) return { run, job: null };

  const endpoint = `repos/${repository}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`;
  const pages = await api(endpoint, { paginate: true }).catch(() => []);
  const matching = pages.flatMap(page => page.jobs ?? []).filter(job => job.runner_name === runner && job.status === 'in_progress' && Number.isSafeInteger(job.id));
  return { run, job: matching.length === 1 ? `${run}/job/${matching[0].id}` : null };
}

export async function binaryDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function saveDraftOutcome(directory, outcome) {
  const file = join(directory, OUTCOME_FILE);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(outcome, null, 2)}\n`, { flag: 'wx' });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

async function readSmallRecord(path) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 32 * 1024) return null;
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await file.read(buffer);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

export async function loadDraftOutcome(directory) {
  return parseDraftOutcome(await readSmallRecord(join(directory, OUTCOME_FILE)));
}

/** Publish the machine-readable record as a check annotation and a reusable output. */
export function publishDraftOutcome(outcome, setOutput, { final = false } = {}) {
  const json = JSON.stringify(outcome);
  console.log(formatWorkflowAnnotation('notice', final ? FINAL_OUTCOME_ANNOTATION : OUTCOME_ANNOTATION, json));
  setOutput(`draft_outcome=${json}\n`);
}

/** Keep full logs in the artifact, through the same publication sanitizer as solve. */
export async function stageDraftEvidence({ logDir, destination, outcome }) {
  await mkdir(destination, { recursive: true });
  await saveDraftOutcome(destination, outcome);
  const { sanitizeLogFileToFileBounded } = await import('../src/log-sanitize-worker.lib.mjs');
  let sessionLogs = 0;
  for (const name of await listSessionLogs(logDir).catch(() => [])) {
    const destPath = join(destination, name);
    try {
      await sanitizeLogFileToFileBounded({ sourcePath: join(logDir, name), destPath });
      if (name.startsWith('solve-')) sessionLogs++;
    } catch {
      await rm(destPath, { force: true });
      console.log(formatWorkflowAnnotation('warning', 'Formal AI draft evidence', `Could not sanitize ${name}; the outcome record was retained`));
    }
  }
  return sessionLogs;
}
