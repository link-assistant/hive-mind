import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify, parseArgs } from 'node:util';
import { collectTaskEvidence, groupTaskFailures, groupTaskFailuresBySignature, inspectTasks, inspectTaskWindow } from '../index.mjs';
import { attemptEvidence, failureKind, latestAttempt, selectTask, taskAttempts, taskBackend, timestamp, validateReportLimit, validateTaskUuid } from './lib/inspection.mjs';
import { findReport, readIssue, reconcileReport } from './lib/issue-history.mjs';
import { resolveBotStateDir } from '../../session-store.lib.mjs';
import { withStateLock } from '../../state-lock.lib.mjs';
import { sanitizeForPublication } from '../../token-sanitization.lib.mjs';

export { latestAttempt, taskAttempts } from './lib/inspection.mjs';

const execFileAsync = promisify(execFile);
const usage = `Usage: hive-manager tasks report [--limit NUMBER] [--group [--by-signature]]
       hive-manager tasks report --collect UUID [--attempt NUMBER]
       hive-manager tasks report --window UUID [--attempt NUMBER]
       hive-manager tasks report --incident UUID [--attempt NUMBER] [--host-signature NAME] [--destination OWNER/REPO [--follow-up ISSUE | --routes FILE] [--publish SHA256]]
       hive-manager tasks report --incident UUID --destination OWNER/REPO --reconcile [--attempt NUMBER] [--legacy-ledger FILE] [--follow-up ISSUE | --routes FILE] [--installed-version VERSION]
Summarize tracked tasks and recent failures without command lines or logs.
Use --group to count repeat failures by backend and exit evidence across recorded attempts.
Add --by-signature to distinguish known causes using bounded attempt logs.
Use --collect to find retry loops and suspicious exits in a bounded excerpt of one task attempt's log.
An incident preview describes one failure. Approve its digest to open an issue or comment on an existing issue.
Use --routes to select a follow-up from a JSON file keyed by the failure group.
Use --reconcile to check past reports and review closed issues without publishing.
`;

function requestedAttempt(value) {
  const attempt = value === undefined ? undefined : Number(value);
  if (attempt !== undefined && (!/^\d+$/.test(value) || !Number.isSafeInteger(attempt) || attempt < 1)) throw new Error('Use a positive attempt number.');
  return attempt;
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
  return { destination, followUp, title, body, marker, digest, id: task.uuid, attempt: attempt.number };
}

async function requireOpenIssue(destination, followUp) {
  const issue = await readIssue(destination, followUp);
  if (issue.state !== 'open') throw new Error('Follow-up requires an open GitHub issue in the destination repository.');
}

async function publishIncident({ destination, followUp, title, body, marker, id, attempt }) {
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
      const knownIssue = followUp === undefined ? undefined : await readIssue(destination, followUp);
      const duplicate = await findReport({ destination, id, attempt, followUp, knownIssue, publishTitle: title });
      if (duplicate) return duplicate.url;
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
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, limit: { type: 'string', default: '25' }, group: { type: 'boolean' }, 'by-signature': { type: 'boolean' }, window: { type: 'string' }, collect: { type: 'string' }, incident: { type: 'string' }, attempt: { type: 'string' }, 'host-signature': { type: 'string' }, destination: { type: 'string' }, 'follow-up': { type: 'string' }, routes: { type: 'string' }, publish: { type: 'string' }, reconcile: { type: 'boolean' }, 'legacy-ledger': { type: 'string' }, 'installed-version': { type: 'string' } } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if (values['by-signature'] && !values.group) throw new Error('Use --by-signature with --group.');
  const hasPublicationOptions = [values.destination, values.publish, values['follow-up'], values.routes, values['host-signature'], values.reconcile, values['legacy-ledger'], values['installed-version']].some(value => value !== undefined);
  if (values.collect !== undefined) {
    if (values.group || values.window !== undefined || values.incident !== undefined || hasPublicationOptions) throw new Error('Collect evidence for one task separately from the other report modes.');
    validateTaskUuid(values.collect);
    const tasks = await listTrackedTasks();
    const result = await collectTaskEvidence(tasks, { uuid: values.collect, attempt: requestedAttempt(values.attempt) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (values.window !== undefined) {
    if (values.group || values.incident !== undefined || hasPublicationOptions) throw new Error('Select the task window separately from grouping and incident publication.');
    const attempt = requestedAttempt(values.attempt);
    validateTaskUuid(values.window);
    const { startedAt, finishedAt } = inspectTaskWindow(await listTrackedTasks(), { uuid: values.window, attempt });
    process.stdout.write(`${startedAt}\t${finishedAt ?? 'now'}\n`);
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
    if (values.reconcile && (!destination || expectedDigest !== undefined)) throw new Error('--reconcile requires a destination and is read-only.');
    if (!values.reconcile && (values['legacy-ledger'] !== undefined || values['installed-version'] !== undefined)) throw new Error('Use --legacy-ledger and --installed-version with --reconcile.');
    const installedVersion = values['installed-version']?.replace(/^v/, '');
    if (installedVersion !== undefined && !/^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?(?:\+[a-z\d.-]+)?$/i.test(installedVersion)) throw new Error('Specify the installed Hive Mind release version.');
    validateTaskUuid(values.incident);
    const task = selectTask(await listTrackedTasks(), values.incident);
    const preview = await incidentPreview(task, attempt, destination, explicitFollowUp, values.routes, values['host-signature']);
    if (values.reconcile) {
      const { followUp, title, body } = preview;
      const version = installedVersion ?? JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version;
      const reconciliation = await reconcileReport(preview, values['legacy-ledger'], version);
      process.stdout.write(`${JSON.stringify({ destination, followUp, title, body, reconciliation }, null, 2)}\n`);
    } else if (!values.publish) {
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
  const limit = /^\d+$/.test(values.limit) ? Number(values.limit) : NaN;
  validateReportLimit(limit);
  const tasks = await listTrackedTasks();
  const result = values['by-signature'] ? await groupTaskFailuresBySignature(tasks, { limit }) : values.group ? groupTaskFailures(tasks, { limit }) : inspectTasks(tasks, { limit });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await report();
  } catch (error) {
    process.stderr.write(`hive-manager: ${error.message}\n`);
    process.exitCode = 1;
  }
}
