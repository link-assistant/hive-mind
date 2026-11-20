import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify, parseArgs } from 'node:util';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';
import { readAttemptEvidence, summarizeTaskEvidence } from './hive-manager-task-evidence.lib.mjs';
import { resolveBotStateDir } from './session-store.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';
import { sanitizeForPublication } from './token-sanitization.lib.mjs';

const execFileAsync = promisify(execFile);
const usage = `Usage: hive-manager tasks report [--limit NUMBER] [--group]
       hive-manager tasks report --collect UUID [--attempt NUMBER]
       hive-manager tasks report --window UUID [--attempt NUMBER]
       hive-manager tasks report --incident UUID [--attempt NUMBER] [--host-signature NAME] [--destination OWNER/REPO [--follow-up ISSUE | --routes FILE] [--publish SHA256]]
Summarize tracked tasks and recent failures without command lines or logs.
Use --group to count repeat failures by backend and exit evidence across recorded attempts.
Use --collect to find retry loops and suspicious exits in a bounded excerpt of one task attempt's log.
An incident preview describes one failure. Approve its digest to open an issue or comment on an existing issue.
Use --routes to select a follow-up from a JSON file keyed by the failure group.
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

function latestAttempt(task) {
  return task.attempt?.number ?? (Number(task.options?.resumeCount) || 0) + 1;
}

export function taskAttempts(task) {
  const number = latestAttempt(task);
  const history = Array.isArray(task.attemptHistory) ? task.attemptHistory : [];
  const attempts = new Map(history.filter(attempt => Number.isSafeInteger(attempt?.number) && attempt.number > 0).map(attempt => [attempt.number, attempt]));
  attempts.set(number, { ...task, number, startedAt: task.attempt?.startedAt ?? task.startTime, logOffset: task.attempt?.logOffset });
  return attempts;
}

async function attemptEvidence(task, attempts, attempt) {
  const next = attempts.get(attempt.number + 1);
  const offset = (value, fallback) => (Number.isSafeInteger(value) && value >= 0 ? value : fallback);
  const start = offset(attempt.logOffset, attempt.number === 1 ? 0 : null);
  const end = offset(next?.logOffset, attempt.number === latestAttempt(task) ? Infinity : null);
  const excerpt = await readAttemptEvidence(task.logPath, start, end);
  return summarizeTaskEvidence(excerpt, attempt);
}

function requestedAttempt(value) {
  const attempt = value === undefined ? null : Number(value);
  if (attempt !== null && (!/^\d+$/.test(value) || !Number.isSafeInteger(attempt) || attempt < 1)) throw new Error('Use a positive attempt number.');
  return attempt;
}

async function selectedTask(id) {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw new Error('Use the complete execution UUID.');
  const task = (await listTrackedTasks()).find(entry => entry.uuid === id.toLowerCase());
  if (!task) throw new Error('No tracked execution matches that UUID.');
  return task;
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

async function routedIssue(file, backend, attempt, selectedSignature) {
  const routes = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(routes)) throw new Error('Incident routes must be a JSON array.');
  const seen = new Set();
  let followUp;
  let specific;
  for (const route of routes) {
    if (!route || !['docker', 'screen', 'tmux', 'ssh', 'local'].includes(route.backend) || !Number.isSafeInteger(route.exitCode) || route.exitCode < 1 || typeof route.kind !== 'string' || !Number.isSafeInteger(route.issue) || route.issue < 1 || (route.signature !== undefined && (typeof route.signature !== 'string' || !/^[a-z0-9-]+$/.test(route.signature)))) {
      throw new Error('Each route needs the backend, kind and exitCode from a failure group and a positive issue number.');
    }
    const signature = JSON.stringify([route.backend, route.kind, route.exitCode, route.signature]);
    if (seen.has(signature)) throw new Error('Specify at most one issue per failure group and signature.');
    seen.add(signature);
    if (route.backend !== backend || route.exitCode !== attempt.exitCode || route.kind !== failureKind(attempt)) continue;
    if (route.signature === undefined) followUp = route.issue;
    else if (route.signature === selectedSignature) specific = route.issue;
  }
  return specific ?? followUp;
}

async function incidentPreview(task, requestedAttempt, destination, explicitFollowUp, routes, hostSignature) {
  const attempts = taskAttempts(task);
  const attempt = attempts.get(requestedAttempt ?? latestAttempt(task));
  if (!attempt || attempt.status !== 'executed' || !Number.isSafeInteger(attempt.number) || attempt.number < 1 || !Number.isSafeInteger(attempt.exitCode) || attempt.exitCode <= 0) throw new Error('The selected attempt has no confirmed failed exit.');
  const backend = taskBackend(task);
  if (hostSignature !== undefined && (backend !== 'docker' || attempt.exitCode < 128 || !['host-reboot', 'host-reset', 'daemon-restart'].includes(hostSignature))) throw new Error('Use a journal correlation from deploy diagnose for a signal-range Docker task exit.');
  const evidence = await attemptEvidence(task, attempts, attempt);
  const followUp = routes === undefined ? explicitFollowUp : await routedIssue(routes, backend, attempt, hostSignature ?? evidence.signature);
  const title = await sanitizeForPublication(`[hive-manager] Task failure ${task.uuid} (attempt ${attempt.number})`);
  const marker = `<!-- hive-manager-task: ${task.uuid}/${attempt.number} -->`;
  const body = await sanitizeForPublication(`${marker}
## Task failure

- Execution \`${task.uuid}\`
- Attempt ${attempt.number}
- Backend \`${backend}\`
- Exit code ${attempt.exitCode}
- ${failureKind(attempt)}${evidence.signature ? `\n- Log signature \`${evidence.signature}\`` : ''}${hostSignature ? `\n- Reviewed host journal correlation \`${hostSignature}\`` : ''}
- Started ${timestamp(attempt.startedAt)}
- Finished ${timestamp(attempt.endTime ?? attempt.finishedAt)}

Generated from start-command's execution record by Hive Mind Manager.
`);
  const digest = createHash('sha256').update(JSON.stringify({ destination, followUp, title, body })).digest('hex');
  return { destination, followUp, title, body, marker, digest };
}

async function githubIssueJson(args) {
  return ghWithRateLimitRetry(async () => {
    const { stdout } = await execFileAsync('gh', ['api', '--hostname', 'github.com', '--method', 'GET', ...args], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(stdout);
  });
}

async function requireOpenIssue(destination, followUp) {
  const issue = await githubIssueJson([`repos/${destination}/issues/${followUp}`]);
  if (issue.number !== followUp || issue.state !== 'open' || issue.pull_request) throw new Error('Follow-up requires an open GitHub issue in the destination repository.');
}

async function publishIncident({ destination, followUp, title, body, marker }) {
  const key = createHash('sha256')
    .update(`${destination}${followUp === undefined ? '' : `#${followUp}`}\0${marker}`)
    .digest('hex');
  const state = resolve(resolveBotStateDir(), `incident-${key}.json`);
  return withStateLock(
    `hive-manager-incident-${key}`,
    async () => {
      const previous = await readFile(state, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      });
      const prefix = `https://github.com/${destination}/issues/`;
      const isIssueUrl = url => {
        if (typeof url !== 'string' || !url.toLowerCase().startsWith(prefix)) return false;
        const suffix = url.slice(prefix.length);
        return followUp === undefined ? /^\d+$/.test(suffix) : suffix.startsWith(`${followUp}#issuecomment-`) && /^\d+$/.test(suffix.split('#issuecomment-')[1]);
      };
      let result;
      if (followUp === undefined) {
        const query = `repo:${destination} is:issue in:title "${title}"`;
        const pages = await githubIssueJson(['search/issues', '--raw-field', `q=${query}`, '--paginate', '--slurp']);
        if (!Array.isArray(pages) || pages.length === 0 || pages.some(page => page.incomplete_results || !Array.isArray(page.items))) throw new Error('GitHub could not confirm whether the incident already exists.');
        result = pages.flatMap(page => page.items).find(issue => issue.title === title && issue.body?.includes(marker));
      } else {
        const pages = await githubIssueJson([`repos/${destination}/issues/${followUp}/comments?per_page=100`, '--paginate', '--slurp']);
        if (!Array.isArray(pages) || pages.length === 0 || pages.some(page => !Array.isArray(page))) throw new Error('GitHub could not confirm whether the follow-up already exists.');
        result = pages.flat().find(comment => comment.body?.includes(marker));
      }
      if (isIssueUrl(result?.html_url)) return result.html_url;
      if (previous) {
        const { url } = JSON.parse(previous);
        if (isIssueUrl(url)) return url;
        throw new Error('A previous publication did not return a confirmed URL. Check the destination for the incident before removing its local pending record.');
      }

      const [approvedTitle, approvedBody] = await Promise.all([sanitizeForPublication(title), sanitizeForPublication(body)]);
      if (approvedTitle !== title || approvedBody !== body) throw new Error('The incident text changed during publication sanitization. Review a fresh preview.');
      if (followUp !== undefined) await requireOpenIssue(destination, followUp);
      await writeFile(state, '{"pending":true}\n', { mode: 0o600, flag: 'wx' });
      try {
        const action = followUp === undefined ? ['create', '--title', approvedTitle] : ['comment', String(followUp)];
        // github-retry-ok: retrying a write after an ambiguous response could duplicate the incident.
        const { stdout } = await execFileAsync('gh', ['issue', ...action, '--repo', `github.com/${destination}`, '--body', approvedBody], { timeout: 30_000, maxBuffer: 4096 });
        const url = stdout.trim();
        if (!isIssueUrl(url)) throw new Error();
        await writeFile(state, `${JSON.stringify({ url })}\n`, { mode: 0o600 });
        return url;
      } catch {
        throw new Error(`Incident publication could not be confirmed. Check ${destination} before removing the pending record ${state}.`);
      }
    },
    { timeoutMs: 5000, staleMs: 60 * 60 * 1000 }
  );
}

export async function listTrackedTasks(timeout = 120_000) {
  try {
    const { stdout } = await execFileAsync('$', ['--list', '--output-format', 'json'], { timeout, maxBuffer: 32 * 1024 * 1024 });
    const { executions } = JSON.parse(stdout);
    if (!Array.isArray(executions)) throw new Error();
    return executions;
  } catch {
    throw new Error('Could not load start-command task records. Check that $ is installed and that tasks list succeeds.');
  }
}

async function report() {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, limit: { type: 'string', default: '25' }, group: { type: 'boolean' }, window: { type: 'string' }, collect: { type: 'string' }, incident: { type: 'string' }, attempt: { type: 'string' }, 'host-signature': { type: 'string' }, destination: { type: 'string' }, 'follow-up': { type: 'string' }, routes: { type: 'string' }, publish: { type: 'string' } } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  const hasPublicationOptions = [values.destination, values.publish, values['follow-up'], values.routes, values['host-signature']].some(value => value !== undefined);
  if (values.collect !== undefined) {
    if (values.group || values.window !== undefined || values.incident !== undefined || hasPublicationOptions) throw new Error('Collect evidence for one task separately from the other report modes.');
    const task = await selectedTask(values.collect);
    const attempts = taskAttempts(task);
    const attempt = attempts.get(requestedAttempt(values.attempt) ?? latestAttempt(task));
    if (!attempt) throw new Error('No recorded attempt has the selected number.');
    const evidence = await attemptEvidence(task, attempts, attempt);
    process.stdout.write(`${JSON.stringify({ id: task.uuid, attempt: attempt.number, status: attempt.status, exitCode: attempt.exitCode ?? null, startedAt: timestamp(attempt.startedAt), finishedAt: timestamp(attempt.endTime ?? attempt.finishedAt), evidence }, null, 2)}\n`);
    return;
  }
  if (values.window !== undefined) {
    if (values.group || values.incident !== undefined || hasPublicationOptions) throw new Error('Select the task window separately from grouping and incident publication.');
    const attempt = requestedAttempt(values.attempt);
    const task = await selectedTask(values.window);
    const entry = taskAttempts(task).get(attempt ?? latestAttempt(task));
    const started = timestamp(entry?.startedAt);
    const ended = timestamp(entry?.endTime ?? entry?.finishedAt);
    if (started === 'Unknown' || (ended === 'Unknown' && entry?.status !== 'executing') || (ended !== 'Unknown' && ended < started)) throw new Error('The selected attempt has no usable time window.');
    process.stdout.write(`${started}\t${ended === 'Unknown' ? 'now' : ended}\n`);
    return;
  }
  if (values.incident !== undefined) {
    if (values.group) throw new Error('Select either --group or --incident.');
    const destination = values.destination?.toLowerCase() ?? null;
    const explicitFollowUp = values['follow-up'] === undefined ? undefined : Number(values['follow-up']);
    const attempt = requestedAttempt(values.attempt);
    const expectedDigest = values.publish?.replace(/^sha256:/, '');
    if ((destination !== null && !/^[a-z\d][a-z\d-]*\/[a-z\d_-][a-z\d_.-]*$/.test(destination)) || (expectedDigest !== undefined && (!destination || !/^[a-f\d]{64}$/.test(expectedDigest)))) throw new Error('Publishing requires a GitHub destination and the approved preview digest.');
    if (explicitFollowUp !== undefined && (!destination || !/^\d+$/.test(values['follow-up']) || !Number.isSafeInteger(explicitFollowUp) || explicitFollowUp < 1)) throw new Error('Specify a GitHub destination and a positive issue number for follow-up.');
    if (values.routes !== undefined && (!destination || explicitFollowUp !== undefined)) throw new Error('Incident routes require a GitHub destination and replace --follow-up.');
    const task = await selectedTask(values.incident);
    const preview = await incidentPreview(task, attempt, destination, explicitFollowUp, values.routes, values['host-signature']);
    if (!values.publish) {
      if (preview.followUp !== undefined) await requireOpenIssue(destination, preview.followUp);
      const { followUp, title, body, digest } = preview;
      process.stdout.write(`${JSON.stringify({ destination, followUp, title, body, digest: `sha256:${digest}` }, null, 2)}\n`);
    } else {
      if (preview.digest !== expectedDigest) throw new Error('The incident or destination changed since review.');
      process.stdout.write(`${await publishIncident(preview)}\n`);
    }
    return;
  }
  if (values.attempt !== undefined || hasPublicationOptions) throw new Error('The attempt and publication options require --incident UUID.');
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
