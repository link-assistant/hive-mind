import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify, parseArgs } from 'node:util';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';
import { resolveBotStateDir } from './session-store.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';
import { sanitizeForPublication } from './token-sanitization.lib.mjs';

const execFileAsync = promisify(execFile);
const usage = `Usage: hive-manager tasks report [--limit NUMBER] [--group]
       hive-manager tasks report --incident UUID [--attempt NUMBER] [--destination OWNER/REPO [--publish SHA256]]
Summarize tracked tasks and recent failures without command lines or logs.
Use --group to count repeat failures by backend and exit evidence across recorded attempts.
An incident preview describes one failure. To post it as a GitHub issue, approve its digest with --publish.
`;

function timestamp(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : 'Unknown';
}

function failureKind({ exitCode, oomKilled, memoryExhausted }) {
  if (oomKilled === true || memoryExhausted === true) return 'Memory exhaustion';
  if (exitCode === 127) return 'Command unavailable (exit 127)';
  if (exitCode >= 128) return 'Signal-range exit code';
  return 'Nonzero exit code';
}

function taskBackend(task) {
  const backend = task.options?.isolated;
  return ['docker', 'screen', 'tmux', 'ssh'].includes(backend) ? backend : 'local';
}

function taskAttempts(task) {
  const number = task.attempt?.number ?? (Number(task.options?.resumeCount) || 0) + 1;
  const history = Array.isArray(task.attemptHistory) ? task.attemptHistory : [];
  const attempts = new Map(history.filter(attempt => Number.isSafeInteger(attempt?.number) && attempt.number > 0).map(attempt => [attempt.number, attempt]));
  attempts.set(number, { ...task, number, startedAt: task.attempt?.startedAt ?? task.startTime });
  return attempts;
}

function groupFailures(tasks, limit) {
  const groups = new Map();
  for (const task of tasks) {
    const backend = taskBackend(task);
    for (const attempt of taskAttempts(task).values()) {
      if (attempt.status !== 'executed' || !Number.isSafeInteger(attempt.exitCode) || attempt.exitCode <= 0) continue;
      const kind = failureKind(attempt);
      const exitCode = attempt.exitCode;
      const signature = `${backend}:${kind}:${exitCode}`;
      const group = groups.get(signature) ?? { backend, kind, exitCode, count: 0, latest: null };
      group.count++;
      const finishedAt = timestamp(attempt.endTime ?? attempt.finishedAt);
      if (!group.latest || (finishedAt !== 'Unknown' && (group.latest.finishedAt === 'Unknown' || finishedAt > group.latest.finishedAt))) {
        group.latest = { id: task.uuid, attempt: attempt.number, finishedAt };
      }
      groups.set(signature, group);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

async function incidentPreview(task, requestedAttempt, destination) {
  const number = task.attempt?.number ?? (Number(task.options?.resumeCount) || 0) + 1;
  const attempt = taskAttempts(task).get(requestedAttempt ?? number);
  if (!attempt || attempt.status !== 'executed' || !Number.isSafeInteger(attempt.number) || attempt.number < 1 || !Number.isSafeInteger(attempt.exitCode) || attempt.exitCode <= 0) throw new Error('The selected attempt has no confirmed failed exit.');
  const backend = taskBackend(task);
  const title = await sanitizeForPublication(`[hive-manager] Task failure ${task.uuid} (attempt ${attempt.number})`);
  const marker = `<!-- hive-manager-task: ${task.uuid}/${attempt.number} -->`;
  const body = await sanitizeForPublication(`${marker}
## Task failure

- Execution \`${task.uuid}\`
- Attempt ${attempt.number}
- Backend \`${backend}\`
- Exit code ${attempt.exitCode}
- ${failureKind(attempt)}
- Started ${timestamp(attempt.startedAt)}
- Finished ${timestamp(attempt.endTime ?? attempt.finishedAt)}

Generated from start-command's execution record by Hive Mind Manager.
`);
  const digest = createHash('sha256').update(JSON.stringify({ destination, title, body })).digest('hex');
  return { destination, title, body, marker, digest };
}

async function publishIncident({ destination, title, body, marker }) {
  const key = createHash('sha256').update(`${destination}\0${marker}`).digest('hex');
  const state = resolve(resolveBotStateDir(), `incident-${key}.json`);
  return withStateLock(
    `hive-manager-incident-${key}`,
    async () => {
      const previous = await readFile(state, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      const query = `repo:${destination} is:issue in:title "${title}"`;
      const result = await ghWithRateLimitRetry(async () => {
        const { stdout } = await execFileAsync('gh', ['api', '--hostname', 'github.com', '--method', 'GET', 'search/issues', '--raw-field', `q=${query}`, '--paginate', '--slurp'], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
        const pages = JSON.parse(stdout);
        if (!Array.isArray(pages) || pages.length === 0 || pages.some(page => page.incomplete_results || !Array.isArray(page.items))) throw new Error('GitHub could not confirm whether the incident already exists.');
        return pages.flatMap(page => page.items).find(issue => issue.title === title && issue.body?.includes(marker));
      });
      const prefix = `https://github.com/${destination}/issues/`;
      const isIssueUrl = url => typeof url === 'string' && url.toLowerCase().startsWith(prefix) && /^\d+$/.test(url.slice(prefix.length));
      if (isIssueUrl(result?.html_url)) return result.html_url;
      if (previous) {
        const { url } = JSON.parse(previous);
        if (isIssueUrl(url)) return url;
        throw new Error('A previous issue creation did not return a confirmed URL. Check the destination for the incident before removing its local pending record.');
      }

      const [approvedTitle, approvedBody] = await Promise.all([sanitizeForPublication(title), sanitizeForPublication(body)]);
      if (approvedTitle !== title || approvedBody !== body) throw new Error('The incident text changed during publication sanitization. Review a fresh preview.');
      await writeFile(state, '{"pending":true}\n', { mode: 0o600, flag: 'wx' });
      try {
        // github-retry-ok: retrying issue creation after an ambiguous response could duplicate the issue.
        const { stdout } = await execFileAsync('gh', ['issue', 'create', '--repo', `github.com/${destination}`, '--title', approvedTitle, '--body', approvedBody], { timeout: 30_000, maxBuffer: 4096 });
        const url = stdout.trim();
        if (!isIssueUrl(url)) throw new Error();
        await writeFile(state, `${JSON.stringify({ url })}\n`, { mode: 0o600 });
        return url;
      } catch {
        throw new Error(`Issue creation could not be confirmed. Check ${destination} before removing the pending record ${state}.`);
      }
    },
    { timeoutMs: 5000, staleMs: 60 * 60 * 1000 }
  );
}

export async function listTrackedTasks() {
  try {
    const { stdout } = await execFileAsync('$', ['--list', '--output-format', 'json'], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    const { executions } = JSON.parse(stdout);
    if (!Array.isArray(executions)) throw new Error();
    return executions;
  } catch {
    throw new Error('Could not load start-command task records. Check that $ is installed and that tasks list succeeds.');
  }
}

async function report() {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, limit: { type: 'string', default: '25' }, group: { type: 'boolean' }, incident: { type: 'string' }, attempt: { type: 'string' }, destination: { type: 'string' }, publish: { type: 'string' } } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if (values.incident !== undefined) {
    if (values.group) throw new Error('Select either --group or --incident.');
    const destination = values.destination?.toLowerCase() ?? null;
    const attempt = values.attempt === undefined ? null : Number(values.attempt);
    const expectedDigest = values.publish?.replace(/^sha256:/, '');
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(values.incident) || (attempt !== null && (!/^\d+$/.test(values.attempt) || !Number.isSafeInteger(attempt) || attempt < 1))) throw new Error('Use the complete execution UUID and an optional positive attempt number.');
    if ((destination !== null && !/^[a-z\d][a-z\d-]*\/[a-z\d_-][a-z\d_.-]*$/.test(destination)) || (expectedDigest !== undefined && (!destination || !/^[a-f\d]{64}$/.test(expectedDigest)))) throw new Error('Publishing requires a GitHub destination and the approved preview digest.');
    const task = (await listTrackedTasks()).find(entry => entry.uuid === values.incident.toLowerCase());
    if (!task) throw new Error('No tracked execution matches that UUID.');
    const preview = await incidentPreview(task, attempt, destination);
    if (!values.publish) {
      const { title, body, digest } = preview;
      process.stdout.write(`${JSON.stringify({ destination, title, body, digest: `sha256:${digest}` }, null, 2)}\n`);
    } else {
      if (preview.digest !== expectedDigest) throw new Error('The incident or destination changed since review.');
      process.stdout.write(`${await publishIncident(preview)}\n`);
    }
    return;
  }
  if (values.attempt !== undefined || values.destination !== undefined || values.publish !== undefined) throw new Error('The attempt and publication options require --incident UUID.');
  const limit = Number(values.limit);
  if (!/^\d+$/.test(values.limit) || limit < 1 || limit > 1000) throw new Error('Report limit must be between 1 and 1000.');
  const tasks = await listTrackedTasks();
  if (values.group) {
    process.stdout.write(`${JSON.stringify({ groups: groupFailures(tasks, limit) }, null, 2)}\n`);
    return;
  }

  const counts = { running: 0, paused: 0, succeeded: 0, failed: 0, unknown: 0 };
  const failures = [];
  for (const task of tasks) {
    if (task.status === 'executing') {
      counts[task.paused === true ? 'paused' : 'running']++;
    } else if (task.status === 'executed' && task.exitCode === 0) {
      counts.succeeded++;
    } else if (task.status === 'failed' || (task.status === 'executed' && Number.isInteger(task.exitCode))) {
      counts.failed++;
      if (failures.length < limit) {
        failures.push({
          id: task.uuid,
          exitCode: task.exitCode ?? null,
          finishedAt: task.endTime ?? null,
          memoryExhausted: task.memoryExhausted === true || task.oomKilled === true,
          reason: task.exitReason ?? null,
        });
      }
    } else {
      counts.unknown++;
    }
  }
  process.stdout.write(`${JSON.stringify({ counts, failures }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await report();
  } catch (error) {
    process.stderr.write(`hive-manager: ${error.message}\n`);
    process.exitCode = 1;
  }
}
