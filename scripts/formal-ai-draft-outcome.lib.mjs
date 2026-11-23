/** Shared attempt record for Hive Mind drafts and their workflow callers. */
import { isSolverBookkeepingFile } from '../src/ai-tool-scratch.lib.mjs';
import { EXIT_CODE_SOLVE_NO_CHANGES } from '../src/solve.exit-codes.lib.mjs';

export const OUTCOME_SCHEMA = 'hive-mind/formal-ai-draft-outcome/v1';
export const OUTCOME_FILE = 'formal-ai-draft-outcome.json';
export const OUTCOME_ANNOTATION = 'Formal AI draft outcome';
export const FINAL_OUTCOME_ANNOTATION = 'Formal AI draft outcome (evidence recorded)';

const PRIMARY = {
  no_requested_implementation: 'No requested implementation was produced',
  implementation_present: 'Implementation changes are present for review',
  verified_noop: 'Verified already-correct continuation',
  missing_evidence: 'Evidence required by the task is missing',
  unsupported_task: 'The solver cannot perform the requested task',
  incorrect_implementation: 'The implementation failed verification',
  compiler_failure: 'Compilation failed',
  tool_runtime_failure: 'The solver tool or runtime failed',
  infrastructure_failure: 'The workflow infrastructure failed',
  deferred_before_effects: 'Deferred before effects while required CI is pending',
  unverified_effect: 'The requested effect could not be verified',
  unknown_failure: 'The process failed without a classified task outcome',
};

const pendingStatuses = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);
const commit = value => /^[a-f0-9]{40}$/i.test(value ?? '');
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

const pendingPrerequisite = item => {
  if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/u.test(item?.path ?? '') || item.conclusion !== null) return false;
  return item.status === 'missing' || (positiveInteger(item.run) && positiveInteger(item.attempt) && pendingStatuses.has(item.status));
};

/** Formal AI #1485 receipts carry pre-effect proof and no execution credit. */
export function deferredPrerequisites(receipt) {
  if (receipt?.schema !== 'formal-ai-hive-client-outcome/v1' || receipt.state !== 'deferred-before-effects' || receipt.effects?.claimed !== false || receipt.executionCredit !== 0 || receipt.authorshipCredit !== 0) return null;
  if (!Array.isArray(receipt.prerequisites) || receipt.prerequisites.length === 0 || !receipt.prerequisites.every(pendingPrerequisite)) return null;
  return receipt.prerequisites.map(({ run, attempt, status, path }) => ({ run: run ?? null, attempt: attempt ?? null, status, path }));
}

/** File inventory for a draft PR. Null means that the diff was not observed. */
export function draftChangeEvidence(files) {
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !file)) return null;
  const relevant = files.filter(file => !isSolverBookkeepingFile(file) && !/(?:^|\/)(?:\.gitkeep|\.keep|\.hive-mind|ci-logs|session-logs|formal-ai-draft-logs)(?:\/|$)/i.test(file) && !/(?:\.log(?:\.(?:gz|zip|xz|zst))?|(?:^|\/)(?:formal-ai-draft-outcome|session-metadata|metadata)\.json)$/i.test(file));
  return relevant.length ? 'implementation_diff' : files.length ? 'diagnostics_only' : 'empty_diff';
}

/** Read the known solver verdicts and publication signals from older images. */
export function observeLegacyDraftLog(text = '') {
  let terminalState = null;
  let noChange = false;
  let failure = null;
  let solveVersion = null;
  let backendVersion = null;
  let formalAiWrapperVersion = null;
  let toolVersion = null;
  let httpStatus = null;
  const failedDestinations = new Set();
  let publication = 'not_observed';

  for (const line of text.split('\n')) {
    const message = line.replace(/^\[[^\]]*\] \[[A-Z]+\] /, '').trim();
    const version = /^(?:🚀 solve v|📦 Formal AI wrapper version: |📦 agent CLI version: )([\w.+-]{1,60})$/u.exec(message)?.[1];
    if (version) {
      if (message.startsWith('🚀')) solveVersion = version;
      else if (message.startsWith('📦 Formal AI')) formalAiWrapperVersion = version;
      else toolVersion = version;
    }
    backendVersion = /^🧠 Formal AI: (?:reusing [^;]+; )?serving backend (?:changed to )?([\w.+-]{1,60})(?: at |$)/u.exec(message)?.[1] ?? backendVersion;
    if (/^⚠️\s+Finished without changes(?::|$)/u.test(message)) {
      noChange = true;
      terminalState = /\(terminal state: ([a-z][a-z_]{1,60})\)/u.exec(message)?.[1] ?? terminalState;
    }
    if (/^(?:✅ Solution draft log (?:uploaded|attached)|📎 Solution draft log has been attached)/u.test(message)) publication = 'published';
    const gistFailure = /^(?:X |❌ |⚠️\s*)?(?:Failed to create gist|Gist upload failed)[: ]/i.test(message);
    const repositoryFailure = /^(?:❌ (?:Error: )?)?(?:Error uploading as shared repository|Failed to fetch authenticated GitHub username)[: ]/i.test(message);
    const uploaderFailure = /^(?:❌ |⚠️\s*)?(?:gh-upload-log failed|(?:Could not|Failed to) (?:upload|attach) (?:the |solution draft )?log)\b/i.test(message);
    if (gistFailure || repositoryFailure || uploaderFailure || (failedDestinations.size > 0 && /^gh: .*HTTP \d{3}\b/i.test(message))) {
      if (gistFailure) failedDestinations.add('gist');
      if (repositoryFailure) failedDestinations.add('repository');
      if (uploaderFailure && failedDestinations.size === 0) failedDestinations.add('external');
      httpStatus ??= Number(/\bHTTP (\d{3})\b/.exec(message)?.[1]) || null;
      continue;
    }

    if (/^(?:error\[E\d+\]:|error: could not compile\b|(?:error: )?compilation failed\b)/i.test(message)) failure = 'compiler_failure';
    if (!failure && /^(?:❌\s*)?(?:Agent reported error|AI session failed|Formal AI failed to start|Docker daemon unavailable)\b/i.test(message)) failure = 'tool_runtime_failure';
  }

  if (failedDestinations.size) publication = publication === 'published' ? 'recovered' : 'failed';
  return {
    terminalState,
    noChange,
    failure,
    solveVersion,
    backendVersion,
    formalAiWrapperVersion,
    toolVersion,
    optional: { status: publication, httpStatus, failedDestinations: [...failedDestinations] },
  };
}

const verified = verification => commit(verification?.source) && verification.source === verification.testedSource && Array.isArray(verification.checks) && verification.checks.length > 0 && verification.checks.every(check => typeof check?.id === 'string' && check.id && check.conclusion === 'success');

/** Derive the primary classification before applying any publication receipt. */
export function makeDraftOutcome({ target, attemptKind = 'first_attempt', process: processResult, runtime = {}, links = {}, infrastructure = {}, change = null, verification, taskFailure, deferral, session, log } = {}) {
  const legacy = observeLegacyDraftLog(log);
  const prerequisites = deferredPrerequisites(deferral);
  const beforeEffects = prerequisites && processResult?.started === false && processResult.exitCode == null && processResult.signal == null && change === null && !session && !log;
  const terminalState = session?.terminalState ?? legacy.terminalState;
  const reliableDiff = change === 'implementation_diff';
  const noDiff = change === 'diagnostics_only' || change === 'empty_diff';
  const noChange = noDiff || ((session?.noChanges || legacy.noChange || processResult?.exitCode === EXIT_CODE_SOLVE_NO_CHANGES) && !reliableDiff);
  let code;
  if (beforeEffects) code = 'deferred_before_effects';
  else if (infrastructure.status === 'failed') code = 'infrastructure_failure';
  else if (taskFailure === 'missing_evidence' || terminalState === 'missing_evidence' || terminalState === 'blocked_missing_evidence') code = 'missing_evidence';
  else if (taskFailure === 'unsupported_task' || terminalState === 'unsupported' || terminalState === 'unsupported_task') code = 'unsupported_task';
  else if (taskFailure === 'compiler_failure' || legacy.failure === 'compiler_failure') code = 'compiler_failure';
  else if (verification?.failed === true || taskFailure === 'incorrect_implementation') code = 'incorrect_implementation';
  else if (taskFailure === 'tool_runtime_failure' || legacy.failure === 'tool_runtime_failure') code = 'tool_runtime_failure';
  else if (attemptKind === 'continuation' && noDiff && verified(verification) && [0, EXIT_CODE_SOLVE_NO_CHANGES].includes(processResult?.exitCode)) code = 'verified_noop';
  else if (noChange || terminalState === 'planned_not_executed') code = 'no_requested_implementation';
  else if (reliableDiff && processResult?.exitCode === 0) code = 'implementation_present';
  else if (processResult?.exitCode === 0) code = 'unverified_effect';
  else code = 'unknown_failure';

  let acceptance = 'rejected';
  if (code === 'deferred_before_effects') acceptance = 'deferred';
  if (code === 'verified_noop' || (code === 'implementation_present' && verified(verification))) acceptance = 'accepted';
  else if (code === 'implementation_present' || code === 'unverified_effect') acceptance = 'unverified';

  const stage = beforeEffects ? 'admission' : (infrastructure.stage ?? (['compiler_failure', 'incorrect_implementation', 'verified_noop'].includes(code) ? 'verification' : 'execution'));
  return {
    schema: OUTCOME_SCHEMA,
    primary: { code, stage, message: PRIMARY[code] },
    task: {
      target: target ?? null,
      requestedEffect: 'repository_change',
      acceptance,
      attemptKind,
      change,
      usefulChange: code === 'implementation_present',
      ...(acceptance === 'accepted' ? { verification: { source: verification.source, checks: verification.checks.map(check => ({ id: check.id, conclusion: check.conclusion })) } } : {}),
    },
    solver: { terminalState, source: session ? 'session-receipt' : log ? 'legacy-log' : 'unobserved' },
    process: { started: false, exitCode: null, signal: null, ...processResult },
    runtime: { tool: 'agent', model: 'formal-ai', image: null, solveVersion: legacy.solveVersion, backendVersion: legacy.backendVersion, formalAiWrapperVersion: legacy.formalAiWrapperVersion, toolVersion: legacy.toolVersion, ...runtime },
    infrastructure: { status: 'available', ...infrastructure, ...(beforeEffects ? { status: 'deferred', prerequisites, effectsClaimed: false } : {}) },
    evidence: { optional: legacy.optional, actions: { status: 'unconfirmed', url: null } },
    links: { run: null, job: null, ...links },
  };
}

export function withActionsEvidence(outcome, { status, url, sessionLogs = null }) {
  const retained = status === 'success' && /^https:\/\/[^\s]+\/artifacts\/\d+$/u.test(url ?? '');
  return {
    ...outcome,
    evidence: { ...outcome.evidence, actions: { status: retained ? 'retained' : status === 'failure' ? 'failed' : 'unavailable', url: retained ? url : null, sessionLogs: retained ? sessionLogs : null } },
  };
}

export function parseDraftOutcome(text) {
  try {
    const value = JSON.parse(text);
    return value?.schema === OUTCOME_SCHEMA && Object.hasOwn(PRIMARY, value.primary?.code) && ['admission', 'setup', 'execution', 'verification'].includes(value.primary?.stage) && ['accepted', 'rejected', 'deferred', 'unverified'].includes(value.task?.acceptance) && value.process && value.solver && value.runtime && value.infrastructure && value.evidence && value.links ? value : null;
  } catch {
    return null;
  }
}
