#!/usr/bin/env node

import { CONFIG, createRawJsonSection, formatDuration, safeJsonStringify } from './interactive-mode.shared.lib.mjs';

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

const formatNumber = value => (isFiniteNumber(value) ? value.toLocaleString() : 'unknown');

const formatSignedNumber = value => {
  if (!isFiniteNumber(value)) return 'unknown';
  return `${value > 0 ? '+' : ''}${value.toLocaleString()}`;
};

const pluralize = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;

const formatThinkingDuration = ms => {
  if (!isFiniteNumber(ms) || ms < 1000) return 'a moment';

  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return pluralize(totalSeconds, 'second');

  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  if (totalMinutes < 60) return pluralize(totalMinutes, 'minute');

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return [pluralize(hours, 'hour'), minutes > 0 ? pluralize(minutes, 'minute') : ''].filter(Boolean).join(' ');
};

const getThinkingStats = events => {
  const latest = events[events.length - 1] || {};
  const estimatedTokens = isFiniteNumber(latest.estimated_tokens) ? latest.estimated_tokens : null;
  const totalDelta = events.reduce((sum, event) => (isFiniteNumber(event.estimated_tokens_delta) ? sum + event.estimated_tokens_delta : sum), 0);
  const latestDelta = isFiniteNumber(latest.estimated_tokens_delta) ? latest.estimated_tokens_delta : null;
  return { estimatedTokens, totalDelta, latestDelta };
};

const buildThinkingComment = (thinking, { final = false } = {}) => {
  const events = thinking.events;
  const stats = getThinkingStats(events);
  const elapsedMs = Math.max(0, thinking.lastEventTime - thinking.firstEventTime);
  const header = final ? `## 🧠 Thought for ${formatThinkingDuration(elapsedMs)}.` : '## 🧠 Thinking...';
  const summary = [`${formatNumber(stats.estimatedTokens)} estimated thinking tokens`, pluralize(events.length, 'thinking-token event'), `${formatSignedNumber(stats.totalDelta)} total delta`].join(' | ');
  const latestDelta = stats.latestDelta == null ? 'unknown' : formatSignedNumber(stats.latestDelta);

  return `${header}

${summary}

| Metric | Value |
|--------|-------|
| **Estimated tokens** | ${formatNumber(stats.estimatedTokens)} |
| **Latest delta** | ${latestDelta} |
| **Events grouped** | ${events.length.toLocaleString()} |
| **Elapsed** | ${formatDuration(elapsedMs)} |

---

${createRawJsonSection(events)}`;
};

const waitForCommentId = async commentIdPromise => {
  let timeoutId;
  const timeoutPromise = new Promise(resolve => {
    timeoutId = setTimeout(() => resolve(null), 15000);
  });
  const commentId = await Promise.race([commentIdPromise, timeoutPromise]);
  clearTimeout(timeoutId);
  return commentId;
};

export const createSystemLifecycleHandlers = ({ state, owner, repo, prNumber, log, verbose, postComment, editComment, processQueue, handleTaskProgress, handleTaskNotification }) => {
  const resolveThinkingCommentId = async thinking => {
    if (thinking.commentId) return thinking.commentId;
    if (!prNumber || !owner || !repo) return null;

    if (state.commentQueue.length > 0) {
      const wasProcessing = state.isProcessing;
      state.isProcessing = false;
      await processQueue();
      state.isProcessing = wasProcessing;
    }

    if (thinking.commentId) return thinking.commentId;
    if (!thinking.commentIdPromise) return null;
    return waitForCommentId(thinking.commentIdPromise);
  };

  const rememberThinkingComment = thinking => commentId => {
    thinking.commentId = commentId;
    if (thinking.resolveCommentId) thinking.resolveCommentId(commentId);
  };

  const handleThinkingTokens = async data => {
    const now = Date.now();
    let thinking = state.activeThinking;

    if (!thinking) {
      let resolveCommentId;
      const commentIdPromise = new Promise(resolve => {
        resolveCommentId = resolve;
      });
      thinking = {
        commentId: null,
        commentIdPromise,
        resolveCommentId,
        events: [],
        firstEventTime: now,
        lastEventTime: now,
        lastEditTime: now,
      };
      state.activeThinking = thinking;
    }

    thinking.events.push(data);
    thinking.lastEventTime = now;

    if (thinking.events.length === 1) {
      const rememberComment = rememberThinkingComment(thinking);
      const commentId = await postComment(buildThinkingComment(thinking), null, null, rememberComment);
      if (commentId) rememberComment(commentId);
      if (verbose) {
        await log(`🧠 Interactive mode: Thinking started (${formatNumber(data.estimated_tokens)} estimated tokens)`, { verbose: true });
      }
      return;
    }

    if (now - thinking.lastEditTime >= CONFIG.MIN_THINKING_COMMENT_UPDATE_INTERVAL) {
      const commentId = await resolveThinkingCommentId(thinking);
      if (commentId) {
        await editComment(commentId, buildThinkingComment(thinking));
        thinking.lastEditTime = now;
      }
    }
  };

  const finalizeThinkingGroup = async () => {
    const thinking = state.activeThinking;
    if (!thinking) return;

    state.activeThinking = null;
    const commentId = await resolveThinkingCommentId(thinking);
    if (commentId) await editComment(commentId, buildThinkingComment(thinking, { final: true }));

    if (verbose) {
      await log(`🧠 Interactive mode: Thinking finished after ${formatThinkingDuration(thinking.lastEventTime - thinking.firstEventTime)} (${thinking.events.length} events)`, {
        verbose: true,
      });
    }
  };

  const handleSystemStatus = async data => {
    if (verbose) await log(`ℹ️ Interactive mode: System status ${data.status || 'unknown'}`, { verbose: true });
  };

  const handleCompactBoundary = async data => {
    const metadata = data.compact_metadata || {};
    const trigger = metadata.trigger || 'unknown';
    const preTokens = isFiniteNumber(metadata.pre_tokens) ? metadata.pre_tokens : null;
    const postTokens = isFiniteNumber(metadata.post_tokens) ? metadata.post_tokens : null;
    const reduction = preTokens != null && postTokens != null ? preTokens - postTokens : null;
    const durationText = isFiniteNumber(metadata.duration_ms) ? formatDuration(metadata.duration_ms) : 'unknown';

    await postComment(`## 🧭 Context compacted

| Metric | Value |
|--------|-------|
| **Trigger** | \`${trigger}\` |
| **Before** | ${formatNumber(preTokens)} tokens |
| **After** | ${formatNumber(postTokens)} tokens |
| **Reduction** | ${formatNumber(reduction)} tokens |
| **Duration** | ${durationText} |

---

${createRawJsonSection(data)}`);
  };

  const handleTaskUpdated = async data => {
    const taskId = data.task_id;
    const patch = data.patch && typeof data.patch === 'object' ? data.patch : {};
    const pendingTask = state.pendingTasks.get(taskId);

    if (!pendingTask) {
      if (verbose) {
        await log(`🤖 Interactive mode: Task update for unknown task ${taskId || 'unknown'}: ${safeJsonStringify(patch)}`, { verbose: true });
      }
      return;
    }

    const status = patch.status || data.status;
    if (status) {
      await handleTaskNotification({
        ...data,
        status,
        summary: data.summary || data.description || patch.summary || `Task ${status}`,
        usage: data.usage || patch.usage || {},
      });
      return;
    }

    if (patch.description || data.description || patch.last_tool_name || data.last_tool_name || patch.usage || data.usage) {
      await handleTaskProgress({
        ...data,
        subtype: 'task_progress',
        description: patch.description || data.description || pendingTask.lastProgressDescription || pendingTask.description,
        usage: data.usage || patch.usage || {},
        last_tool_name: patch.last_tool_name || data.last_tool_name || '',
      });
      return;
    }

    pendingTask.allEvents.push(data);
    if (verbose) await log(`🤖 Interactive mode: Task update recorded for ${taskId}: ${safeJsonStringify(patch)}`, { verbose: true });
  };

  return {
    handleThinkingTokens,
    finalizeThinkingGroup,
    handleSystemStatus,
    handleCompactBoundary,
    handleTaskUpdated,
  };
};
