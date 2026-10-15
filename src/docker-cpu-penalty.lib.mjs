/**
 * Delayed CPU penalty for Docker-isolated work sessions (issue #2801).
 *
 * A task container that keeps every CPU of the machine busy for a whole
 * trigger window (15 minutes by default) is capped to a small number of CPUs
 * (2 by default) with `docker update --cpus`. The cap is lifted once the
 * container's average usage stays below a share of that cap (65% by default)
 * for a whole release window (15 minutes by default). After a lift the
 * observation starts again from scratch, so a task that saturates the machine
 * again for another full trigger window is capped again.
 *
 * The decision logic ({@link evaluateDockerCpuPenalty}) is pure and works on
 * timestamps, so it does not depend on how often the session monitor ticks.
 * The I/O ({@link runDockerCpuPenaltyPass}) samples every running container
 * with one `docker stats --no-stream` call per tick.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';

const MINUTE_MS = 60 * 1000;

export const DOCKER_CPU_PENALTY_DEFAULTS = Object.freeze({
  enabled: true,
  penaltyCpus: 2,
  // "Uses all 100% of the CPUs": an average of 95% leaves room for sampling
  // noise and for the share the host itself (dockerd, the bot) always keeps;
  // a container never averages a literal 100% over 15 minutes.
  triggerPercent: 95,
  triggerWindowMs: 15 * MINUTE_MS,
  releasePercent: 65,
  releaseWindowMs: 15 * MINUTE_MS,
  // Too few samples cannot prove a 15-minute average (for example right
  // after a bot restart, when only the last minute was observed).
  minSamples: 5,
  // A window counts as observed when its oldest sample is at most this much
  // younger than the window itself (the monitor ticks every 30 seconds).
  coverageToleranceMs: MINUTE_MS,
});

const DURATION_UNITS = Object.freeze({ ms: 1, s: 1000, m: MINUTE_MS, h: 60 * MINUTE_MS });

/** Parse `15m`, `900s`, `1h`, `90000ms`; a bare number is minutes. */
export function parseDurationMs(value, label = 'Duration') {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(text);
  if (!match) throw new Error(`${label} '${value}' is not a duration such as 15m, 900s or 1h`);
  const ms = Number(match[1]) * DURATION_UNITS[match[2] || 'm'];
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`${label} must be greater than zero`);
  return Math.round(ms);
}

function parsePercent(value, label) {
  const text = String(value ?? '').trim();
  const numeric = Number(text.endsWith('%') ? text.slice(0, -1).trim() : text);
  if (!text || !Number.isFinite(numeric) || numeric <= 0 || numeric > 100) throw new Error(`${label} '${value}' must be a percentage between 0 and 100`);
  return numeric;
}

function parseCpus(value) {
  const numeric = Number(String(value ?? '').trim());
  if (!Number.isFinite(numeric) || numeric < 0.01) throw new Error(`CPU penalty limit '${value}' must be a core count of at least 0.01`);
  return numeric;
}

function parseEnabled(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (['', 'true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  throw new Error(`CPU penalty switch '${value}' must be true or false`);
}

function isUnset(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/**
 * Validate the operator's settings and fill in the issue #2801 defaults.
 * Accepts strings (CLI / environment) or numbers.
 */
export function normalizeDockerCpuPenaltyConfig(input = {}) {
  const d = DOCKER_CPU_PENALTY_DEFAULTS;
  const pick = (key, parse) => (isUnset(input[key]) ? d[key] : parse(input[key]));
  return {
    enabled: isUnset(input.enabled) ? d.enabled : parseEnabled(input.enabled),
    penaltyCpus: pick('penaltyCpus', parseCpus),
    triggerPercent: pick('triggerPercent', value => parsePercent(value, 'CPU penalty trigger')),
    triggerWindowMs: pick('triggerWindowMs', value => (typeof value === 'number' ? parseDurationMs(`${value}ms`) : parseDurationMs(value, 'CPU penalty trigger window'))),
    releasePercent: pick('releasePercent', value => parsePercent(value, 'CPU penalty release')),
    releaseWindowMs: pick('releaseWindowMs', value => (typeof value === 'number' ? parseDurationMs(`${value}ms`) : parseDurationMs(value, 'CPU penalty release window'))),
    minSamples: pick('minSamples', value => Math.max(1, Math.floor(Number(value)) || d.minSamples)),
    coverageToleranceMs: pick('coverageToleranceMs', value => Math.max(0, Number(value) || 0)),
  };
}

function formatWindow(ms) {
  return ms % MINUTE_MS === 0 ? `${ms / MINUTE_MS} min` : `${Number((ms / 1000).toFixed(1))} s`;
}

export function formatDockerCpuPenaltyConfig(config) {
  if (!config?.enabled) return 'off';
  return `cap ${config.penaltyCpus} CPUs after ${formatWindow(config.triggerWindowMs)} at >=${config.triggerPercent}% of all CPUs; lift after ${formatWindow(config.releaseWindowMs)} below ${config.releasePercent}% of the cap`;
}

/** Parse `docker stats --format '{{.Name}}\t{{.CPUPerc}}'`; 100% is one core. */
export function parseDockerStatsCpuOutput(text) {
  const cores = new Map();
  for (const line of String(text || '').split('\n')) {
    const [name, percent] = line.trim().split(/\t+|\s{2,}/);
    if (!name || !percent) continue;
    const numeric = Number(percent.replace('%', '').trim());
    if (Number.isFinite(numeric) && numeric >= 0) cores.set(name, numeric / 100);
  }
  return cores;
}

function createState(now) {
  return { phase: 'observing', phaseStartedAt: now, samples: [], penaltyCount: 0, penalizedMs: 0, penalizedAt: null, limitCpus: null, lastAverageCores: null, lastError: null };
}

function windowAverage(samples, now, windowMs, config) {
  const since = now - windowMs;
  const inWindow = samples.filter(sample => sample.at >= since && sample.at <= now);
  if (inWindow.length < config.minSamples) return { average: null, reason: 'insufficient-samples', count: inWindow.length };
  if (now - inWindow[0].at < windowMs - config.coverageToleranceMs) return { average: null, reason: 'window-not-covered', count: inWindow.length };
  const average = inWindow.reduce((sum, sample) => sum + sample.cores, 0) / inWindow.length;
  return { average, reason: null, count: inWindow.length };
}

/**
 * One step of the penalty state machine for one container.
 *
 * @param {object|null} previous - Persisted state (`sessionInfo.cpuPenalty`)
 * @param {object} input
 * @param {number} input.now - Epoch ms of the sample
 * @param {number|null} input.cores - Observed usage in cores (100% = 1 core), or null when unavailable
 * @param {number} input.capacityCpus - CPUs the container may use when not penalized (host CPUs or its own lower limit)
 * @param {number} input.restoreCpus - `--cpus` value that lifts the penalty
 * @param {object} input.config - {@link normalizeDockerCpuPenaltyConfig} result
 * @returns {{state: object, action: null|{type: 'apply'|'lift', cpus: number}, reason: string, averageCores: number|null, thresholdCores: number|null}}
 */
export function evaluateDockerCpuPenalty(previous, { now, cores, capacityCpus, restoreCpus, config }) {
  const state = previous ? { ...previous, samples: [...(previous.samples || [])] } : createState(now);
  if (Number.isFinite(cores)) state.samples.push({ at: now, cores });
  const keepSince = now - Math.max(config.triggerWindowMs, config.releaseWindowMs) - config.coverageToleranceMs;
  state.samples = state.samples.filter(sample => sample.at >= keepSince);
  const result = (reason, extra = {}) => ({ state, action: null, reason, averageCores: null, thresholdCores: null, ...extra });

  if (state.phase === 'penalized') {
    const thresholdCores = (config.releasePercent / 100) * state.limitCpus;
    if (now - state.phaseStartedAt < config.releaseWindowMs) return result('penalty-minimum-not-reached', { thresholdCores });
    const { average, reason } = windowAverage(state.samples, now, config.releaseWindowMs, config);
    state.lastAverageCores = average;
    if (average === null) return result(reason, { thresholdCores });
    if (average >= thresholdCores) return result('still-busy', { averageCores: average, thresholdCores });
    return { state, action: { type: 'lift', cpus: restoreCpus }, reason: 'below-release-threshold', averageCores: average, thresholdCores };
  }

  if (!Number.isFinite(capacityCpus) || config.penaltyCpus >= capacityCpus) return result('penalty-not-below-capacity');
  const thresholdCores = (config.triggerPercent / 100) * capacityCpus;
  if (now - state.phaseStartedAt < config.triggerWindowMs) return result('observation-window-not-reached', { thresholdCores });
  const { average, reason } = windowAverage(state.samples, now, config.triggerWindowMs, config);
  state.lastAverageCores = average;
  if (average === null) return result(reason, { thresholdCores });
  if (average < thresholdCores) return result('below-trigger-threshold', { averageCores: average, thresholdCores });
  return { state, action: { type: 'apply', cpus: config.penaltyCpus }, reason: 'all-cpus-busy', averageCores: average, thresholdCores };
}

/** Record that Docker accepted the action decided by {@link evaluateDockerCpuPenalty}. */
export function commitDockerCpuPenaltyAction(state, action, now) {
  const next = { ...state, samples: [], phaseStartedAt: now, lastError: null };
  if (action.type === 'apply') {
    next.phase = 'penalized';
    next.penalizedAt = now;
    next.limitCpus = action.cpus;
    next.penaltyCount = (state.penaltyCount || 0) + 1;
  } else {
    next.phase = 'observing';
    next.penalizedMs = (state.penalizedMs || 0) + Math.max(0, now - (state.penalizedAt ?? now));
    next.penalizedAt = null;
    next.limitCpus = null;
  }
  return next;
}

function formatCpus(value) {
  return Number(Number(value).toFixed(6)).toString();
}

function runDocker(args, { spawnImpl = spawn, timeoutMs = 30000 } = {}) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawnImpl('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      finish({ success: false, stdout: '', error: error?.message || String(error) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill?.('SIGKILL');
      finish({ success: false, stdout, error: `docker ${args[0]} timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    child.stdout?.on('data', chunk => (stdout += chunk.toString()));
    child.stderr?.on('data', chunk => (stderr += chunk.toString()));
    child.on('error', error => finish({ success: false, stdout, error: error.message }));
    child.on('close', code => finish({ success: code === 0, stdout, error: code === 0 ? null : stderr.trim() || `docker exited with code ${code}` }));
  });
}

/** Usage of every running container, in cores, from one `docker stats` call. */
export async function sampleDockerContainersCpu(options = {}) {
  // Naming the containers would fail the whole call as soon as one of them has
  // exited ("No such container"), so every running container is sampled.
  const result = await runDocker(['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}'], options);
  if (!result.success) throw new Error(result.error || 'docker stats failed');
  return parseDockerStatsCpuOutput(result.stdout);
}

let hostCpusCache = null;
const HOST_CPUS_CACHE_MS = 5 * MINUTE_MS;

/** CPUs of the machine running the Docker daemon; re-read every 5 minutes because a VM can be resized. */
export async function getDockerHostCpus({ now = Date.now(), osImpl = os, ...options } = {}) {
  if (hostCpusCache && now - hostCpusCache.at < HOST_CPUS_CACHE_MS) return hostCpusCache.cpus;
  const result = await runDocker(['info', '--format', '{{.NCPU}}'], options);
  const daemonCpus = Number(result.stdout.trim());
  const cpus = result.success && Number.isFinite(daemonCpus) && daemonCpus > 0 ? daemonCpus : typeof osImpl.availableParallelism === 'function' ? osImpl.availableParallelism() : osImpl.cpus().length;
  hostCpusCache = { at: now, cpus };
  return cpus;
}

export function resetDockerCpuPenaltyCachesForTests() {
  hostCpusCache = null;
}

/**
 * Change a container's CPU cap. A cap is lifted by raising it to the host's
 * CPU count: `docker update --cpus 0` exits 0 but keeps the old cap, and
 * `--cpu-quota -1` leaves the old `NanoCpus` in HostConfig, which
 * start-command copies into a resumed container (experiments/issue-2801-*).
 */
export async function updateDockerContainerCpus(containerName, cpus, options = {}) {
  return runDocker(['update', '--cpus', formatCpus(cpus), containerName], options);
}

/** Current `--cpus` cap of a container in cores, or null when it has none / cannot be read. */
export async function inspectDockerContainerCpus(containerName, options = {}) {
  const result = await runDocker(['inspect', '--format', '{{.HostConfig.NanoCpus}}', containerName], options);
  const nanoCpus = Number(result.stdout.trim());
  return result.success && Number.isFinite(nanoCpus) && nanoCpus > 0 ? nanoCpus / 1e9 : null;
}

function isEligibleSession(sessionInfo) {
  return sessionInfo?.isolationBackend === 'docker' && Boolean(sessionInfo.sessionId) && !sessionInfo.completionNotifiedAt && !sessionInfo.containerResourceLimitExceeded;
}

/**
 * Sample every tracked Docker session once and apply or lift penalties.
 *
 * @param {Array<{sessionName: string, sessionInfo: object}>} sessions
 * @param {object} options
 * @param {object} options.config - {@link normalizeDockerCpuPenaltyConfig} result
 * @returns {Promise<Array<{sessionName: string, action: object|null, reason: string, error?: string}>>}
 */
export async function runDockerCpuPenaltyPass(sessions, options = {}) {
  const { config, verbose = false, now = Date.now(), persist = () => {}, logEvent = () => {} } = options;
  const eligible = (sessions || []).filter(entry => isEligibleSession(entry.sessionInfo));
  if (!config?.enabled || eligible.length === 0) return [];
  const sampleCpu = options.sampleCpu || sampleDockerContainersCpu;
  const hostCpusProvider = options.hostCpus || (() => getDockerHostCpus({ now }));
  const updateCpus = options.updateCpus || updateDockerContainerCpus;
  const inspectCpus = options.inspectCpus || inspectDockerContainerCpus;

  let usage;
  try {
    usage = await sampleCpu();
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] docker-cpu-penalty: could not sample container CPU usage: ${error?.message || error}`);
    return [];
  }
  const hostCpus = await hostCpusProvider();
  const outcomes = [];
  for (const { sessionName, sessionInfo } of eligible) {
    const containerName = sessionInfo.sessionId;
    const cores = usage.get(containerName);
    const baseCpus = Number.isFinite(sessionInfo.containerResourceLimits?.cpuCores) ? sessionInfo.containerResourceLimits.cpuCores : null;
    const capacityCpus = baseCpus === null ? hostCpus : Math.min(baseCpus, hostCpus);
    const restoreCpus = capacityCpus;
    let previous = sessionInfo.cpuPenalty || null;
    if (!previous) {
      // A container restarted in place, or resumed by start-command from a
      // snapshot, keeps the cap it had: carry on as penalized so it is lifted.
      const currentCpus = await inspectCpus(containerName);
      previous = createState(now);
      if (Number.isFinite(currentCpus) && currentCpus < capacityCpus - 0.001) {
        Object.assign(previous, { phase: 'penalized', penalizedAt: now, limitCpus: currentCpus, penaltyCount: 1 });
        if (verbose) console.log(`[VERBOSE] docker-cpu-penalty: ${sessionName} already runs with a ${formatCpus(currentCpus)}-CPU cap; watching it as penalized`);
      }
      sessionInfo.cpuPenalty = previous;
      persist(sessionName, sessionInfo);
    }
    const decision = evaluateDockerCpuPenalty(previous, { now, cores: Number.isFinite(cores) ? cores : null, capacityCpus, restoreCpus, config });
    sessionInfo.cpuPenalty = decision.state;
    if (verbose) {
      const observed = Number.isFinite(cores) ? `${formatCpus(cores.toFixed(3))} cores` : 'no sample';
      const average = decision.averageCores === null ? 'n/a' : formatCpus(decision.averageCores.toFixed(3));
      const threshold = decision.thresholdCores === null ? 'n/a' : formatCpus(decision.thresholdCores.toFixed(3));
      console.log(`[VERBOSE] docker-cpu-penalty: ${sessionName} phase=${decision.state.phase} observed=${observed} average=${average} threshold=${threshold} capacity=${formatCpus(capacityCpus)} -> ${decision.action ? `${decision.action.type} --cpus ${formatCpus(decision.action.cpus)}` : decision.reason}`);
    }
    if (!decision.action) {
      outcomes.push({ sessionName, action: null, reason: decision.reason });
      continue;
    }
    const update = await updateCpus(containerName, decision.action.cpus);
    if (!update?.success) {
      const error = update?.error || 'unknown Docker error';
      if (sessionInfo.cpuPenalty.lastError !== error) console.error(`[docker-cpu-penalty] Could not ${decision.action.type === 'apply' ? 'apply' : 'lift'} the CPU penalty of session ${sessionName}: ${error}`);
      sessionInfo.cpuPenalty = { ...sessionInfo.cpuPenalty, lastError: error };
      persist(sessionName, sessionInfo);
      outcomes.push({ sessionName, action: decision.action, reason: decision.reason, error });
      continue;
    }
    sessionInfo.cpuPenalty = commitDockerCpuPenaltyAction(decision.state, decision.action, now);
    persist(sessionName, sessionInfo);
    const averageText = formatCpus(decision.averageCores.toFixed(2));
    if (decision.action.type === 'apply') {
      console.warn(`[docker-cpu-penalty] Session ${sessionName} averaged ${averageText} of ${formatCpus(capacityCpus)} CPUs for ${formatWindow(config.triggerWindowMs)}; capped to ${formatCpus(decision.action.cpus)} CPUs`);
    } else {
      console.log(`[docker-cpu-penalty] Session ${sessionName} averaged ${averageText} CPUs for ${formatWindow(config.releaseWindowMs)} under its ${formatCpus(decision.state.limitCpus)}-CPU cap; cap lifted to ${formatCpus(decision.action.cpus)} CPUs`);
    }
    logEvent(decision.action.type === 'apply' ? 'cpu_penalty_applied' : 'cpu_penalty_lifted', { sessionName, containerName, cpus: decision.action.cpus, averageCores: decision.averageCores, thresholdCores: decision.thresholdCores, capacityCpus });
    outcomes.push({ sessionName, action: decision.action, reason: decision.reason });
  }
  return outcomes;
}

/** Completion-message section; empty when the task was never penalized. */
export function formatDockerCpuPenaltySection(sessionInfo, { now = Date.now() } = {}) {
  const state = sessionInfo?.cpuPenalty;
  if (!state?.penaltyCount) return '';
  const penalizedMs = (state.penalizedMs || 0) + (state.phase === 'penalized' && Number.isFinite(state.penalizedAt) ? Math.max(0, now - state.penalizedAt) : 0);
  const minutes = Math.round(penalizedMs / MINUTE_MS);
  const times = state.penaltyCount === 1 ? 'once' : `${state.penaltyCount} times`;
  return [`🐢 *CPU penalty*`, `The container used all CPUs for too long and was capped ${times} (${minutes} min in total).`].join('\n');
}
