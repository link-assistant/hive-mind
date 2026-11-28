/* eslint-disable no-await-in-loop -- restored tasks are enqueued in their original order */
/**
 * Publish what a running hive-telegram-bot instance is doing into the durable
 * bot state (issue #4143), and read operator requests (drain) back from it.
 *
 * Every `intervalMs` the publisher snapshots the solve queue (queued, waiting,
 * waiting-for-tasks and starting items) and the tracked work sessions
 * (isolated or not), plus the /subscribe list. It writes the state only when
 * that snapshot changed, the intake request changed, or the heartbeat is due,
 * so an idle bot touches the store once a minute.
 *
 * The intake section belongs to the operator: `hive-telegram-bot --drain`
 * sets it to `draining`, the publisher picks that up on its next tick,
 * acknowledges it, and from then on `isDraining()` makes the bot reject new
 * tasks and keeps the queue consumer from starting queued ones. Running tasks
 * finish normally; queued ones stay in the state for the next instance, which
 * restores them (`restoreQueuedTasks`) and edits their Telegram messages as
 * the queue moves.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4143
 */

import { randomUUID } from 'node:crypto';

import { cloneState, createBotStateStore } from './bot-state-store.lib.mjs';
import { resolveBotStateMigrationTarget } from './bot-state-migrations.lib.mjs';
import { createItemTarget, createSessionTarget } from './telegram-solve-dependencies.lib.mjs';
import { currentLockOwner } from './state-lock.lib.mjs';

export const DEFAULT_STATE_PUBLISH_INTERVAL_MS = 5000;
export const DEFAULT_STATE_HEARTBEAT_MS = 60000;
export const RESTORABLE_TASK_STATUSES = Object.freeze(['queued', 'waiting']);
// Fields that change on every queue tick (resource percentages) and alone do not justify a write.
const VOLATILE_TASK_FIELDS = ['waitingReason'];

const toIso = value => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

/** Durable form of a solve queue item. */
export function queueItemToTask(item, { dependency = null } = {}) {
  return {
    source: 'queue',
    status: item.status,
    url: item.url,
    tool: item.tool,
    command: item.command || 'solve',
    commandAlias: item.commandAlias || undefined,
    isolation: item.perCommandIsolation || undefined,
    sessionName: item.sessionName || undefined,
    args: Array.isArray(item.args) ? item.args.map(String) : undefined,
    requester: typeof item.requester === 'string' ? item.requester : undefined,
    requesterUserId: item.requesterUserId ?? undefined,
    chatId: item.messageInfo?.chatId ?? item.ctx?.chat?.id ?? undefined,
    messageId: item.messageInfo?.messageId ?? undefined,
    messageThreadId: item.messageInfo?.messageThreadId ?? item.ctx?.message?.message_thread_id ?? undefined,
    locale: item.locale || undefined,
    infoBlock: item.infoBlock || undefined,
    showLimits: item.showLimits === true ? true : undefined,
    limitsAtStart: item.limitsAtStart || undefined,
    urlContext: item.urlContext || undefined,
    createdAt: toIso(item.createdAt),
    startedAt: toIso(item.startedAt),
    waitingReason: item.waitingReason || undefined,
    dependencyMode: dependency ? dependency.mode : undefined,
    waitsFor: dependency ? dependency.targets.map(target => ({ type: target.type, itemId: target.item?.id, url: target.url || undefined, label: target.label || undefined, names: [...(target.names || [])] })) : undefined,
  };
}

/** Durable form of a tracked work session (screen or isolated). */
export function sessionToTask(sessionName, info = {}) {
  return {
    source: 'session',
    status: info.explicitResumePending ? 'resuming' : info.pausedAt ? 'paused' : 'running',
    url: info.url || undefined,
    tool: info.tool || undefined,
    command: info.command || undefined,
    commandAlias: info.commandAlias || undefined,
    isolation: info.isolationBackend || 'none',
    sessionName,
    sessionId: info.sessionId || undefined,
    requesterUserId: info.requesterUserId ?? undefined,
    chatId: info.chatId ?? undefined,
    messageId: info.messageId ?? undefined,
    messageThreadId: info.messageThreadId ?? undefined,
    locale: info.locale || undefined,
    startedAt: toIso(info.launchedAt || info.startTime),
  };
}

/** Every task the instance knows about, keyed by queue item id or session name. */
export function snapshotTasks({ queue = null, sessions = [] } = {}) {
  const tasks = {};
  for (const { sessionName, sessionInfo = {} } of sessions) {
    if (sessionInfo.retainedForResume && !sessionInfo.explicitResumePending) continue; // finished, kept only for /resume
    tasks[sessionName] = sessionToTask(sessionName, sessionInfo);
  }
  if (!queue) return tasks;
  for (const items of Object.values(queue.queues || {})) for (const item of items) tasks[item.id] = queueItemToTask(item);
  for (const item of queue.processing?.values?.() || []) if (!item.sessionName || !tasks[item.sessionName]) tasks[item.id] = queueItemToTask(item);
  for (const entry of queue.dependencies?.entries || []) tasks[entry.item.id] = queueItemToTask(entry.item, { dependency: entry });
  return tasks;
}

export function snapshotSubscribers(list = []) {
  const subscribers = {};
  for (const { userId, username, firstName, subscribedAt, sourceChatId } of list) subscribers[String(userId)] = { userId, username: username || undefined, firstName: firstName || undefined, subscribedAt: toIso(subscribedAt), sourceChatId: sourceChatId ?? undefined };
  return subscribers;
}

const signatureOf = (tasks, subscribers, stoppedChats, launching) =>
  JSON.stringify({
    tasks: Object.fromEntries(Object.entries(tasks).map(([id, task]) => [id, Object.fromEntries(Object.entries(task).filter(([key, value]) => value !== undefined && !VOLATILE_TASK_FIELDS.includes(key)))])),
    subscribers,
    stoppedChats,
    launching,
  });

/**
 * Re-enqueue the queued tasks of a previous instance. Tasks that were already
 * starting are not restored: their launch may have gone through.
 * @returns {Promise<{restored: object[], skipped: Array<{id: string, reason: string}>}>}
 */
export async function restoreQueuedTasks({ tasks = {}, queue, telegram, isUrlActive = async () => false, log = () => {} }) {
  const restored = [];
  const skipped = [];
  const byId = new Map();
  const entries = Object.entries(tasks)
    .filter(([, task]) => task?.source === 'queue')
    .sort(([, a], [, b]) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const [id, task] of entries) {
    if (!RESTORABLE_TASK_STATUSES.includes(task.status)) {
      skipped.push({ id, reason: `status ${task.status}` });
      continue;
    }
    if (!task.url || !Array.isArray(task.args)) {
      skipped.push({ id, reason: 'no url or args' });
      continue;
    }
    const active = queue.findByUrl?.(task.url) || (await isUrlActive(task.url));
    if (active && (typeof active.isActive !== 'boolean' || active.isActive)) {
      skipped.push({ id, reason: 'already queued or running' });
      continue;
    }
    const ctx = task.chatId === undefined ? null : { telegram, chat: { id: task.chatId }, from: { id: task.requesterUserId ?? null }, message: { message_id: task.messageId ?? null, message_thread_id: task.messageThreadId ?? null } };
    const options = { id, createdAt: task.createdAt, url: task.url, args: task.args, ctx, requester: task.requester, infoBlock: task.infoBlock, commandAlias: task.commandAlias, tool: task.tool, perCommandIsolation: task.isolation, urlContext: task.urlContext, showLimits: task.showLimits === true, limitsAtStart: task.limitsAtStart, locale: task.locale };
    let item;
    if (Array.isArray(task.waitsFor) && task.waitsFor.length > 0) {
      const targets = task.waitsFor.map(target => (target.type === 'item' && byId.has(target.itemId) ? createItemTarget(byId.get(target.itemId), target.label) : createSessionTarget({ names: target.names || [], url: target.url || null, label: target.label || null })));
      item = queue.enqueueAfter({ ...options, waitingReason: task.waitingReason }, { targets, mode: task.dependencyMode || 'success' });
    } else {
      item = queue.enqueue(options);
    }
    item.requesterUserId = task.requesterUserId ?? item.requesterUserId;
    if (task.chatId !== undefined && task.messageId !== undefined) item.messageInfo = { chatId: task.chatId, messageId: task.messageId, messageThreadId: task.messageThreadId ?? null };
    byId.set(id, item);
    restored.push(item);
    log(`♻️ Restored queued task ${id} (${task.url})`);
  }
  for (const { id, reason } of skipped) log(`Not restoring task ${id}: ${reason}`);
  return { restored, skipped };
}

/**
 * Create the instance state publisher.
 * @param {object} [options]
 * @param {object} [options.store] - Dual store (default: `createBotStateStore`).
 * @param {number} [options.intervalMs] - Snapshot interval.
 * @param {number} [options.heartbeatMs] - Write at least this often.
 */
export function createBotInstanceState({ store, env = process.env, verbose = false, intervalMs = Number(env.HIVE_MIND_STATE_PUBLISH_INTERVAL_MS) || DEFAULT_STATE_PUBLISH_INTERVAL_MS, heartbeatMs = DEFAULT_STATE_HEARTBEAT_MS, now = () => Date.now(), version = null, log = message => console.log(`[bot-state] ${message}`) } = {}) {
  const stateStore = store ?? createBotStateStore({ env, verbose, log });
  const trace = message => verbose && log(message);
  const instanceId = randomUUID();
  const owner = currentLockOwner(now);
  const instance = { id: instanceId, pid: owner.pid, hostname: owner.hostname, pidNamespace: owner.pidNamespace || undefined, startedAt: new Date(now()).toISOString(), version: version || undefined, publishIntervalMs: String(intervalMs), heartbeatMs: String(heartbeatMs) };
  let intake = { state: 'accepting' };
  let sources = null;
  let timer = null;
  let lastSignature = null;
  let lastWriteAt = 0;
  let running = null;
  let rerun = false;
  let stopped = false;
  let restored = false;
  let ready = false;
  let mirrorNeedsRepair = false;
  let stopListening;
  const isIntakePaused = () => !ready || stopped || intake.state === 'draining';

  const collect = () => {
    const tasks = snapshotTasks({ queue: sources.queue, sessions: sources.getActiveSessions?.() || [] });
    const subscribers = snapshotSubscribers(sources.getSubscribers?.() || []);
    const stoppedChats = Object.fromEntries(sources.getStoppedChats?.() || []);
    const launching = Number(sources.getLaunchingCount?.() || 0);
    return { tasks, subscribers, stoppedChats, launching, signature: signatureOf(tasks, subscribers, stoppedChats, launching) };
  };

  async function publish({ force = false, final = false } = {}) {
    if (!restored) return null;
    const peeked = await stateStore.peek().catch(() => null);
    const intakeChanged = peeked && JSON.stringify(peeked.intake) !== JSON.stringify(intake);
    const due = now() - lastWriteAt >= heartbeatMs;
    if (!force && !final && !due && !intakeChanged && !mirrorNeedsRepair && collect().signature === lastSignature) return null;
    let snapshot;
    const result = await stateStore.update(draft => {
      const at = new Date(now()).toISOString();
      if (draft.intake.state === 'draining') {
        // Close the in-process gate before taking the acknowledged snapshot.
        // The files are visible to operators before the write promise settles.
        intake = draft.intake;
        if (draft.intake.acknowledgedBy !== instanceId) {
          draft.intake.acknowledgedAt = at;
          draft.intake.acknowledgedBy = instanceId;
          log(`🚧 Draining: new tasks are rejected and queued tasks wait for the next instance (requested by ${draft.intake.requestedBy || 'unknown'}${draft.intake.reason ? `: ${draft.intake.reason}` : ''})`);
        }
      }
      snapshot = collect();
      draft.instance = { ...instance, heartbeatAt: at, updatedAt: at, launching: snapshot.launching || undefined, stoppedAt: final ? at : undefined };
      draft.tasks = snapshot.tasks;
      draft.subscribers = snapshot.subscribers;
      draft.stoppedChats = snapshot.stoppedChats;
      return draft;
    });
    if (intake.state !== result.state.intake.state && result.state.intake.state === 'accepting') log('✅ Intake resumed: accepting new tasks');
    intake = result.state.intake;
    mirrorNeedsRepair = result.binaryStore === 'available' && !result.binaryWritten;
    lastSignature = snapshot.signature;
    lastWriteAt = now();
    trace(`Published ${Object.keys(snapshot.tasks).length} task(s), intake ${intake.state}${mirrorNeedsRepair ? ' (link-cli repair pending)' : result.consistent === false ? ' (repaired the link-cli copy)' : ''}`);
    return result;
  }

  /** Serialized publish; a request during a running publish runs once more afterwards. */
  async function tick(options) {
    if (stopped) return null;
    if (running) {
      rerun = true;
      return running;
    }
    running = publish(options)
      .then(result => {
        if (result && !stopped) ready = true;
        return result;
      })
      .catch(error => log(`⚠️ Could not publish the instance state: ${error.message}`))
      .finally(() => {
        running = null;
        if (rerun && !stopped) {
          rerun = false;
          tick();
        }
      });
    return running;
  }

  return {
    get instanceId() {
      return instanceId;
    },
    get store() {
      return stateStore;
    },
    get intake() {
      return intake;
    },
    isDraining: () => intake.state === 'draining',
    isIntakePaused,
    /**
     * Read the previous state, reset a drain that targeted an earlier
     * instance, restore subscribers and queued tasks, then publish on a timer.
     * @param {object} params
     * @param {object} params.queue - SolveQueue
     * @param {Function} params.getActiveSessions - session monitor snapshot
     * @param {Function} [params.getSubscribers] / [params.restoreSubscribers] / [params.onSubscribersChanged]
     * @param {Function} [params.getLaunchingCount] - direct launches not yet tracked
     * @param {Function} [params.restore] - `async tasks => ...` re-enqueues queued tasks
     */
    async start(params) {
      sources = params;
      if (params.queue) params.queue.isIntakePausedFn = isIntakePaused;
      let previous = null;
      const targetVersion = resolveBotStateMigrationTarget(env);
      const result = await stateStore.update(
        draft => {
          previous = cloneState(draft);
          if (draft.intake.state === 'draining' && draft.intake.instanceId !== instanceId) {
            log(`Intake was draining for instance ${draft.intake.instanceId || 'unknown'}; this new instance accepts tasks`);
            draft.intake = { state: 'accepting', resetAt: new Date(now()).toISOString(), previousRequest: draft.intake.requestedAt };
          }
          draft.instance = { ...instance, heartbeatAt: instance.startedAt, updatedAt: instance.startedAt };
          return draft;
        },
        { targetVersion }
      );
      intake = result.state.intake;
      log(`State: ${stateStore.paths.lino} (link-cli: ${result.binaryStore}, ${result.consistent === false ? 'repaired' : 'consistent'})`);
      const savedSubscribers = Object.values(previous?.subscribers || {});
      if (savedSubscribers.length && params.restoreSubscribers) log(`Restored ${params.restoreSubscribers(savedSubscribers)} subscriber(s)`);
      params.restoreStoppedChats?.(previous?.stoppedChats);
      if (params.restore) await params.restore(previous?.tasks || {});
      if (stopped) return previous;
      restored = true;
      const publishChange = () => tick({ force: true });
      const stopSubscribers = params.onSubscribersChanged?.(publishChange);
      const stopChats = params.onStoppedChatsChanged?.(publishChange);
      stopListening = () => {
        stopSubscribers?.();
        stopChats?.();
      };
      timer = setInterval(() => tick(), intervalMs);
      timer.unref?.();
      await tick({ force: true });
      return previous;
    },
    tick,
    /** Final write with `stoppedAt`; queued tasks stay for the next instance. */
    async stop() {
      stopped = true;
      stopListening?.();
      if (timer) clearInterval(timer);
      timer = null;
      if (running) await running;
      return publish({ final: true }).catch(error => log(`⚠️ Could not write the final instance state: ${error.message}`));
    },
    /** Wrap the chat-stop checks so a draining instance rejects new tasks in every chat. */
    wrapChatStop({ isChatStopped, getChatStopInfo, getStoppedChatRejectMessage }) {
      const reason = () => (intake.state === 'draining' || stopped ? `This bot instance is draining before a restart${intake.reason ? ` (${intake.reason})` : ''}: running tasks finish, new tasks are not accepted. Please send the command again after the restart.` : 'The bot is loading its saved state. Please try again once it is ready.');
      return {
        isChatStopped: chatId => isIntakePaused() || isChatStopped(chatId),
        getChatStopInfo: chatId => getChatStopInfo(chatId) || (isIntakePaused() ? { reason: reason(), stoppedAt: intake.requestedAt } : null),
        getStoppedChatRejectMessage: (chatId, commandName = 'Command') => (isIntakePaused() && !isChatStopped(chatId) ? `❌ ${commandName} command rejected.\n\n🚧 ${reason()}` : getStoppedChatRejectMessage(chatId, commandName)),
      };
    },
  };
}

export default { DEFAULT_STATE_HEARTBEAT_MS, DEFAULT_STATE_PUBLISH_INTERVAL_MS, RESTORABLE_TASK_STATUSES, createBotInstanceState, queueItemToTask, restoreQueuedTasks, sessionToTask, snapshotSubscribers, snapshotTasks };
