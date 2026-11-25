/**
 * Operator commands for a hive-telegram-bot instance (issue #4143):
 *
 *   hive-telegram-bot --status [--json]          what is running, queued, waiting
 *   hive-telegram-bot --drain [--drain-reason]   stop taking new tasks
 *   hive-telegram-bot --resume-intake            take new tasks again
 *   hive-telegram-bot --wait-for-idle [--wait-timeout s]
 *
 * They only read and write the durable bot state (`hive-mind-state.lino` and
 * its link-cli mirror) in the state directory, so they need no bot token and
 * work from the host when that directory is mounted, or with `docker exec`.
 * The running instance notices a drain within one publish interval and
 * acknowledges it; `--wait-for-idle` then waits for running tasks to finish.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4143
 */

import { createBotStateStore } from './bot-state-store.lib.mjs';
import { DEFAULT_STATE_HEARTBEAT_MS, DEFAULT_STATE_PUBLISH_INTERVAL_MS } from './bot-instance-state.lib.mjs';
import { currentLockOwner, processIsAlive } from './state-lock.lib.mjs';

const RUNNING_STATUSES = new Set(['running', 'resuming', 'paused', 'started']);
const STARTING_STATUSES = new Set(['starting']);
const QUEUED_STATUSES = new Set(['queued', 'waiting']);

const ageMs = (at, now) => (at ? now - new Date(at).getTime() : Infinity);

/**
 * Summarize a bot state for people and scripts.
 * @returns {object} `{ instance: {alive, reason, ...}, intake, counts, idle, tasks }`
 */
export function describeInstanceState(state, { now = Date.now(), self = currentLockOwner(), isAlive = processIsAlive } = {}) {
  const instance = state.instance || {};
  const heartbeatMs = Number(instance.heartbeatMs) || DEFAULT_STATE_HEARTBEAT_MS;
  const heartbeatAge = ageMs(instance.heartbeatAt, now);
  let alive = true;
  let reason = 'heartbeat is fresh';
  if (!instance.startedAt) [alive, reason] = [false, 'no instance has published state yet'];
  else if (instance.stoppedAt) [alive, reason] = [false, `stopped at ${instance.stoppedAt}`];
  else if (heartbeatAge > heartbeatMs * 3) [alive, reason] = [false, `no heartbeat for ${Math.round(heartbeatAge / 1000)}s`];
  else if (instance.hostname === self.hostname && (instance.pidNamespace ?? '') === (self.pidNamespace ?? '') && instance.pid && !isAlive(Number(instance.pid))) [alive, reason] = [false, `process ${instance.pid} is gone`];
  const tasks = Object.entries(state.tasks || {}).map(([id, task]) => ({ id, ...task }));
  const counts = { running: 0, starting: 0, queued: 0, other: 0, launching: Number(instance.launching) || 0, isolated: 0 };
  for (const task of tasks) {
    if (RUNNING_STATUSES.has(task.status)) counts.running++;
    else if (STARTING_STATUSES.has(task.status)) counts.starting++;
    else if (QUEUED_STATUSES.has(task.status)) counts.queued++;
    else counts.other++;
    if (task.isolation && task.isolation !== 'none' && (RUNNING_STATUSES.has(task.status) || STARTING_STATUSES.has(task.status))) counts.isolated++;
  }
  const intake = state.intake || { state: 'accepting' };
  const drainAcknowledged = intake.state === 'draining' && Boolean(intake.acknowledgedAt) && new Date(intake.acknowledgedAt) >= new Date(intake.requestedAt || 0);
  const busy = counts.running + counts.starting + counts.launching;
  return {
    instance: { ...instance, alive, reason, heartbeatAgeSeconds: Number.isFinite(heartbeatAge) ? Math.round(heartbeatAge / 1000) : null },
    intake: { ...intake, acknowledged: drainAcknowledged },
    counts,
    busy,
    idle: busy === 0,
    drained: drainAcknowledged && busy === 0 && new Date(instance.updatedAt || 0) >= new Date(intake.acknowledgedAt || 0),
    tasks,
  };
}

const taskLine = task => {
  const what = [task.command && `/${task.commandAlias || task.command}`, task.url].filter(Boolean).join(' ');
  const where = task.isolation && task.isolation !== 'none' ? ` [${task.isolation}]` : '';
  const since = task.startedAt || task.createdAt;
  const waits = task.waitsFor?.length ? ` after ${task.waitsFor.map(target => target.label || target.url || target.itemId).join(', ')}` : '';
  return `  ${task.status.padEnd(9)} ${what || task.id}${where}${task.sessionName ? ` (${task.sessionName})` : ''}${waits}${since ? ` since ${since}` : ''}`;
};

/** Human readable status. */
export function formatStatusText(description, { paths } = {}) {
  const { instance, intake, counts } = description;
  const lines = [];
  lines.push(instance.startedAt ? `Instance: ${instance.alive ? 'alive' : 'not running'} (${instance.reason}); pid ${instance.pid} on ${instance.hostname}, started ${instance.startedAt}${instance.version ? `, version ${instance.version}` : ''}` : `Instance: ${instance.reason}`);
  if (instance.heartbeatAt) lines.push(`Last update: ${instance.updatedAt || instance.heartbeatAt} (heartbeat ${instance.heartbeatAgeSeconds}s ago)`);
  let intakeLine = `Intake: ${intake.state}`;
  if (intake.state === 'draining') intakeLine += `${intake.reason ? ` (${intake.reason})` : ''}, requested ${intake.requestedAt}${intake.requestedBy ? ` by ${intake.requestedBy}` : ''}, ${intake.acknowledged ? `acknowledged ${intake.acknowledgedAt}` : 'not acknowledged yet'}`;
  lines.push(intakeLine);
  lines.push(`Tasks: ${counts.running} running (${counts.isolated} isolated), ${counts.starting} starting, ${counts.launching} launching, ${counts.queued} queued or waiting`);
  for (const task of description.tasks) lines.push(taskLine(task));
  lines.push(description.idle ? 'Idle: no running or starting tasks' : `Busy: ${description.busy} task(s) running or starting`);
  if (paths) lines.push(`State: ${paths.lino}`);
  return lines.join('\n');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Run --status / --drain / --resume-intake / --wait-for-idle.
 * @returns {Promise<number>} process exit code
 */
export async function runInstanceStateCommand(config, { store, env = process.env, now = () => Date.now(), out = text => console.log(text), err = text => console.error(text), pollMs = Number(env.HIVE_MIND_STATE_PUBLISH_INTERVAL_MS) || DEFAULT_STATE_PUBLISH_INTERVAL_MS, sleepImpl = sleep, describe = describeInstanceState } = {}) {
  const stateStore = store ?? createBotStateStore({ env, verbose: config.verbose === true, log: text => err(`[bot-state] ${text}`) });
  const print = (description, extra = {}) => out(config.json ? JSON.stringify({ ...description, ...extra, paths: stateStore.paths }, null, 2) : formatStatusText(description, { paths: stateStore.paths }));
  const requestedBy = `${currentLockOwner().hostname}:${process.pid}`;

  if (config.drain || config.resumeIntake) {
    const result = await stateStore.update(draft => {
      const at = new Date(now()).toISOString();
      if (config.resumeIntake) {
        if (draft.intake.state === 'accepting') return false;
        draft.intake = { state: 'accepting', resumedAt: at, resumedBy: requestedBy, previousRequest: draft.intake.requestedAt };
      } else if (draft.intake.state !== 'draining') {
        draft.intake = { state: 'draining', reason: config.drainReason || undefined, requestedAt: at, requestedBy, instanceId: draft.instance.id };
      } else if (config.drainReason && config.drainReason !== draft.intake.reason) {
        draft.intake.reason = config.drainReason;
      } else return false;
      return draft;
    });
    const description = describe(result.state, { now: now() });
    if (!config.waitForIdle) {
      if (!config.json) out(config.resumeIntake ? (result.written ? 'Intake resumed: the instance accepts new tasks again.' : 'Intake was already accepting new tasks.') : result.written ? 'Drain requested: the instance stops taking new tasks within one publish interval.' : 'The instance is already draining.');
      if (!description.instance.alive && !config.json) out(`Note: ${description.instance.reason}.`);
      print(description);
      return 0;
    }
  }

  if (config.waitForIdle) {
    const deadline = config.waitTimeout > 0 ? now() + config.waitTimeout * 1000 : Infinity;
    let last = '';
    for (;;) {
      const { state } = await stateStore.read();
      const description = describe(state, { now: now() });
      if (!description.instance.alive) {
        err(`⚠️ No running instance (${description.instance.reason}); nothing to wait for.`);
        print(description, { waited: 'not-running' });
        return 0;
      }
      if (state.intake.state !== 'draining') {
        err('Intake is not draining; run with --drain to stop new tasks first.');
        print(description, { waited: 'not-draining' });
        return 1;
      }
      if (description.drained) {
        if (!config.json) out('Idle: the drain is acknowledged and no task is running or starting.');
        print(description, { waited: 'idle' });
        return 0;
      }
      const progress = description.intake.acknowledged ? `${description.busy} task(s) still running or starting` : 'waiting for the instance to acknowledge the drain';
      if (progress !== last && !config.json) err(progress);
      last = progress;
      if (now() >= deadline) {
        err(`Timed out after ${config.waitTimeout}s: ${progress}.`);
        print(description, { waited: 'timeout' });
        return 1;
      }
      await sleepImpl(Math.min(pollMs, Math.max(0, deadline - now())));
    }
  }

  const result = await stateStore.read();
  const description = describe(result.state, { now: now() });
  if (!result.exists && !config.json) out(`No bot state in ${stateStore.paths.dir} yet.`);
  print(description, { source: result.source, consistent: result.consistent, binaryStore: result.binaryStore });
  return 0;
}

export default { describeInstanceState, formatStatusText, runInstanceStateCommand };
