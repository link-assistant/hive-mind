import { createHash } from 'node:crypto';
import { attemptEvidence, failureKind, taskBackend, timestamp, validateTaskUuid } from './inspection.mjs';
import { maxIncidents, normalizeSelection, positiveAttempt, recordedVersion, selectIncidents } from './incident-selection.mjs';
import { routedIssue, validateHostSignature, validateIncidentRoutes } from './incident-routes.mjs';
import { batchPublicationState, postIncident, readSinglePublication } from './incident-publication.mjs';
import { findReport, githubIssueJson, indexLegacyLedger, matchLedgerReport, readIssue, reportUrl, reviewClosedRoute } from './issue-history.mjs';

const actions = ['comment', 'create-issue', 'regression-issue'];
const schema = 1;

function normalizePolicy(policy) {
  if (policy == null) return null;
  const { destination, visibility, allow, routes = [], includeLogEvidence = false } = policy;
  if (typeof destination !== 'string' || destination.length > 150 || !/^[a-z\d][a-z\d-]*\/[a-z\d_-][a-z\d_.-]*$/i.test(destination) || !['private', 'public'].includes(visibility)) {
    throw new Error('Publication policy requires a GitHub owner/repository and explicit private or public visibility.');
  }
  if (!Array.isArray(allow) || allow.length > actions.length || allow.some(action => !actions.includes(action)) || new Set(allow).size !== allow.length || typeof includeLogEvidence !== 'boolean') {
    throw new Error('Set allow to the approved publication actions and includeLogEvidence to a boolean.');
  }
  if (!Array.isArray(routes) || routes.length > maxIncidents) throw new Error(`Supply at most ${maxIncidents} incident routes.`);
  return { destination: destination.toLowerCase(), visibility, allow, routes: validateIncidentRoutes(routes), includeLogEvidence };
}

async function requireDestination({ destination, visibility }) {
  const repo = await githubIssueJson([`repos/${destination}`]);
  if (repo.full_name?.toLowerCase() !== destination || repo.visibility !== visibility) {
    throw new Error('The GitHub repository or its visibility differs from the approved publication policy.');
  }
}

function marker(entry) {
  return `<!-- hive-manager-task: ${entry.id}/${entry.attempt} -->`;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

// Text in commands, bot messages and tool output is discarded at the evidence boundary.
function logSummary(evidence) {
  if (!evidence?.available) return '- Log evidence unavailable';
  const repetitions = values => (Array.isArray(values) ? values.slice(0, 3).map(count).join(', ') || '0' : '0');
  return [`- Log evidence from a ${evidence.bounded ? 'bounded tail' : 'recorded attempt excerpt'}`, `- Solver turns observed ${count(evidence.turns)}`, `- Retries ${count(evidence.retries)} and reconnects ${count(evidence.reconnects)}`, `- Repeated command counts ${repetitions(evidence.repeatedCommands)}`, `- Repeated tool call counts ${repetitions(evidence.repeatedToolCalls)}`, `- Repeated message counts ${repetitions(evidence.repeatedMessages)}`].join('\n');
}

async function renderReport(entry, policy) {
  const { sanitizeForPublication } = await import('../../../token-sanitization.lib.mjs');
  const { id, attempt, backend, exitCode, startedAt, finishedAt, installedVersion, hostSignature, laterSucceeded, evidence, action, route } = entry;
  const signature = typeof evidence?.signature === 'string' && /^[a-z0-9-]{1,50}$/.test(evidence.signature) ? evidence.signature : undefined;
  const classification = failureKind({ exitCode, oomKilled: entry.memoryExhausted === true });
  const reportMarker = marker(entry);
  const lines = [reportMarker, '## Task failure', '', `- Execution \`${id}\``, `- Attempt ${attempt}`, `- Backend \`${backend}\``, `- Exit code ${exitCode}`, `- ${classification}`, `- Started ${timestamp(startedAt)}`, `- Finished ${timestamp(finishedAt)}`];
  if (signature) lines.push(`- Failure signature \`${signature}\``);
  if (hostSignature) lines.push(`- Reviewed host journal correlation \`${hostSignature}\``);
  if (installedVersion) lines.push(`- Recorded Hive Mind version \`${recordedVersion(installedVersion)}\``);
  if (laterSucceeded === true) lines.push('- A later attempt of this execution succeeded');
  if (policy?.includeLogEvidence) lines.push('', logSummary(evidence));
  if (action === 'regression-issue') lines.push('', `Possible regression of https://github.com/${policy.destination}/issues/${route}.`);
  const title = await sanitizeForPublication(`[hive-manager] ${action === 'regression-issue' ? 'Possible regression' : 'Task failure'} ${id} (attempt ${attempt})`);
  const body = await sanitizeForPublication(`${lines.join('\n')}\n`);
  if (!body.startsWith(`${reportMarker}\n`)) throw new Error('The execution attempt marker changed during incident sanitization.');
  return { title, body };
}

function postedReceipt(state, destination) {
  if (!state || state.pending === true) return null;
  const url = reportUrl(destination, state.url);
  if (!url) throw new Error('The local batch receipt has no confirmed incident URL.');
  return { source: 'batch-receipt', url };
}

async function reconcile(entry, policy, index, state) {
  const { destination } = policy;
  const { id, attempt, route } = entry;
  const local = postedReceipt(state, destination);
  if (local) return { found: local, action: null };
  const ledger = matchLedgerReport(index, destination, `${id}#${attempt}`);
  if (ledger) return { found: ledger, action: null };

  const followUp = state?.pending ? (state.followUp ?? undefined) : route;
  const singleCreate = await readSinglePublication(destination, marker(entry));
  if (singleCreate && !singleCreate.pending) return { found: singleCreate, action: null };
  const single = followUp === undefined ? singleCreate : await readSinglePublication(destination, marker(entry), followUp);
  if (single && !single.pending) return { found: single, action: null };
  if (state?.pending && (timestamp(state.since) === 'Unknown' || (followUp !== undefined && !positiveAttempt(followUp)))) {
    throw new Error('The local pending record cannot be safely reconciled.');
  }
  const knownIssue = followUp === undefined ? undefined : await readIssue(destination, followUp);
  const recentSince = state?.pending && followUp === undefined ? state.since : undefined;
  const found = await findReport({ destination, id, attempt, followUp, knownIssue, exactOnly: true, recentSince });
  if (found) return { found, action: null };
  if (state?.pending || single?.pending || singleCreate?.pending) return { pending: true, action: null };

  const closed = knownIssue?.state === 'closed' ? await reviewClosedRoute(destination, knownIssue, entry.installedVersion) : null;
  const action = closed ? (closed.state === 'possible-regression' ? 'regression-issue' : null) : knownIssue ? 'comment' : 'create-issue';
  return { action: policy.allow.includes(action) ? action : null, closed };
}

function planDigest(plan) {
  return `sha256:${createHash('sha256').update(JSON.stringify(plan)).digest('hex')}`;
}

export async function planIncidentBatch(tasks, options) {
  const selection = normalizeSelection(options?.selection);
  const candidates = selectIncidents(tasks, selection);
  const policy = normalizePolicy(options?.policy);
  const usesLegacyLedger = options?.legacyLedger !== undefined;
  const index = usesLegacyLedger ? indexLegacyLedger(options.legacyLedger) : null;
  if (usesLegacyLedger && !policy) throw new Error('Select a publication policy to reconcile a destination against its legacy ledger.');
  if (policy) await requireDestination(policy);

  const entries = [];
  for (const { id, task, attempts, attempt, installedVersion, hostSignature } of candidates) {
    const backend = taskBackend(task);
    const evidence = await attemptEvidence(task, attempts, attempt, 512 * 1024);
    const entry = {
      id,
      attempt: attempt.number,
      backend,
      exitCode: attempt.exitCode,
      memoryExhausted: attempt.oomKilled === true || attempt.memoryExhausted === true,
      startedAt: timestamp(attempt.startedAt),
      finishedAt: timestamp(attempt.endTime ?? attempt.finishedAt),
      installedVersion,
      hostSignature,
      laterSucceeded: [...attempts.values()].some(next => next.number > attempt.number && next.status === 'executed' && next.exitCode === 0),
      evidence,
    };
    if (policy) {
      entry.route = routedIssue(policy.routes, backend, attempt, hostSignature ?? evidence.signature);
      const state = await batchPublicationState(policy.destination, marker(entry)).read();
      Object.assign(entry, await reconcile(entry, policy, index, state));
    }
    entry.report = await renderReport(entry, policy);
    entries.push(entry);
  }
  const plan = { schema, selection, policy, usesLegacyLedger, entries };
  return { ...plan, digest: policy ? planDigest(plan) : null };
}

function validateEntry(entry) {
  validateTaskUuid(entry?.id);
  if (entry.id !== entry.id.toLowerCase() || !positiveAttempt(entry.attempt) || !positiveAttempt(entry.exitCode) || !['docker', 'screen', 'tmux', 'ssh', 'local'].includes(entry.backend) || (entry.route !== undefined && !positiveAttempt(entry.route))) {
    throw new Error('The saved plan contains an invalid incident entry.');
  }
  validateHostSignature(entry.hostSignature, entry.backend, entry.exitCode);
}

async function applyEntry(entry, policy, index) {
  const { destination } = policy;
  const store = batchPublicationState(destination, marker(entry));
  return store.lock(async () => {
    const state = await store.read();
    const { action, closed, found, pending } = await reconcile(entry, policy, index, state);
    if (found) {
      if (!postedReceipt(state, destination) && found.url && ['hive-manager-marker', 'legacy-marker', 'single-incident-receipt'].includes(found.source)) await store.write({ url: found.url });
      return { state: found.fixedUpstream ? 'known-fix-recorded' : 'already-reported', ...found };
    }
    if (pending) {
      const record = state?.pending ? store.path : 'the single-incident state file';
      throw new Error(`A previous GitHub write is unconfirmed. Verify the exact attempt marker at the destination before resolving the pending record at ${record}.`);
    }
    if (action !== entry.action || JSON.stringify(closed) !== JSON.stringify(entry.closed)) {
      throw new Error('The incident route or release review changed. Save and review a fresh plan before publishing.');
    }
    if (!action) return { state: 'held' };
    await requireDestination(policy);
    const report = await renderReport(entry, policy);
    if (report.title !== entry.report?.title || report.body !== entry.report?.body) throw new Error('The incident text changed during publication sanitization. Review a fresh plan.');
    const followUp = action === 'comment' ? entry.route : undefined;
    // Record the intent before the mutation. Allow minor clock skew in recovery's recent-issue query.
    await store.write({ pending: true, followUp: followUp ?? null, since: new Date(Date.now() - 60_000).toISOString() });
    let url;
    try {
      url = await postIncident({ destination, followUp, ...report });
      await store.write({ url });
    } catch {
      throw new Error('GitHub publication could not be confirmed. Reapply the approved plan to reconcile its exact marker.');
    }
    return { state: 'published', url };
  });
}

export async function applyIncidentBatch(savedPlan, options) {
  const { digest, ...plan } = savedPlan ?? {};
  if (plan.schema !== schema || !plan.policy || !digest || options?.approve !== digest || planDigest(plan) !== digest) {
    throw new Error('Apply requires the saved publication plan and its approved digest.');
  }
  const policy = normalizePolicy(plan.policy);
  const selection = normalizeSelection(plan.selection);
  if (!Array.isArray(plan.entries) || plan.entries.length > selection.limit) throw new Error('The saved plan exceeds its incident batch limit.');
  if (plan.usesLegacyLedger && options.legacyLedger === undefined) throw new Error('Supply the current legacy ledger for this publication plan.');
  const index = options.legacyLedger === undefined ? null : indexLegacyLedger(options.legacyLedger);
  const seen = new Set();
  for (const entry of plan.entries) {
    validateEntry(entry);
    if (seen.has(marker(entry)) || (entry.action !== null && !policy.allow.includes(entry.action))) throw new Error('The saved plan contains overlapping entries or an unapproved action.');
    seen.add(marker(entry));
  }

  const outcomes = [];
  for (const entry of plan.entries) {
    const selection = { id: entry.id, attempt: entry.attempt };
    if (!entry.action && !entry.pending) {
      outcomes.push({ ...selection, state: entry.found ? (entry.found.fixedUpstream ? 'known-fix-recorded' : 'already-reported') : 'held', ...entry.found });
      continue;
    }
    try {
      outcomes.push({ ...selection, ...(await applyEntry(entry, policy, index)) });
    } catch (error) {
      // Preserve earlier receipts. Stop at the first unresolved action and describe the remainder.
      outcomes.push({ ...selection, state: 'blocked', reason: error.message });
      for (const { id, attempt } of plan.entries.slice(outcomes.length)) outcomes.push({ id, attempt, state: 'remaining' });
      break;
    }
  }
  return { destination: policy.destination, outcomes };
}
