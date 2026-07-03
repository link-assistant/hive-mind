#!/usr/bin/env node
/**
 * Bidirectional Interactive Mode Library
 *
 * [EXPERIMENTAL] This module provides bidirectional real-time communication during tool execution.
 * It monitors issue/PR comments for user feedback and queues them for injection into the running tool session.
 *
 * Key features:
 * - Monitors GitHub issue/PR comments for new user feedback
 * - Queues feedback messages for injection into the tool stdin
 * - Works with Claude/Agent CLI --input-format stream-json mode
 * - Filters out system-generated comments (from interactive mode itself)
 *
 * Usage:
 *   const { createBidirectionalHandler } = await import('./bidirectional-interactive.lib.mjs');
 *   const handler = createBidirectionalHandler({ owner, repo, prNumber, $ });
 *   await handler.startMonitoring();
 *   // Later...
 *   const feedback = handler.getQueuedFeedback();
 *
 * @module bidirectional-interactive.lib.mjs
 * @experimental
 */

import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs'; // rate-limit marker (#1726): gh API calls flow through $ wrapped by caller
import { getLiveInputCapability, getLiveInputCapabilityRows, getLiveInputMode, isLiveInputSupported, LIVE_INPUT_MODE_FALLBACK, LIVE_INPUT_MODE_STREAM } from './live-input-capabilities.lib.mjs';
// Configuration constants
const CONFIG = {
  // Minimum time between comment checks to avoid rate limiting (in ms)
  MIN_POLL_INTERVAL: 10000,
  // Default poll interval (in ms)
  DEFAULT_POLL_INTERVAL: 15000,
  // Maximum queued feedback messages
  MAX_QUEUE_SIZE: 50,
  // Default keep-alive for a headless stream-json process between turns.
  // Claude Code exits after this many ms with no new input once it
  // has replied, so new issue/PR comments have a window to flow in as additional
  // user messages. Issue #817.
  DEFAULT_EXIT_AFTER_STOP_DELAY_MS: 60_000,
  // Signature to identify system-generated comments
  SYSTEM_COMMENT_SIGNATURES: ['## 🚀 Session Started', '## 💬 Assistant Response', '## 💻 Tool: ', '## 📝 Tool: ', '## 📖 Tool: ', '## ✏️ Tool: ', '## 🔍 Tool: ', '## 🔎 Tool: ', '## 🌐 Tool: ', '## 📋 Tool: ', '## 🎯 Tool: ', '## 📓 Tool: ', '## 🔧 Tool: ', '## ✅ Tool Result:', '## ❌ Tool Result:', '## ✅ Session Complete', '## ❌ Session Failed', '## ❓ Unrecognized Event:', '📄 Raw JSON', '🤖 Generated with [Claude Code]', '🤖 AI-Powered Solution Draft', '*This PR was created automatically by the AI issue solver*'],
};

/**
 * Check if a comment body is system-generated (from interactive mode)
 *
 * @param {string} body - Comment body to check
 * @returns {boolean} True if the comment is system-generated
 */
const isSystemComment = body => {
  if (!body || typeof body !== 'string') {
    return false;
  }
  return CONFIG.SYSTEM_COMMENT_SIGNATURES.some(sig => body.includes(sig));
};

/**
 * Format a user feedback message for Claude-compatible stream-json input.
 * Agent accepts the same `type: user` frame shape in stream-json mode.
 *
 * @param {string} feedbackText - The user's feedback text
 * @param {Object} [options]
 * @param {string} [options.kind='comment'] - Source kind: 'comment', 'ci', 'uncommitted', 'metadata'
 * @returns {string} JSON string ready to write to a stream-json stdin
 */
const formatFeedbackForClaude = (feedbackText, options = {}) => {
  const kind = options.kind || 'comment';
  const headers = {
    comment: {
      open: '[USER FEEDBACK FROM PR COMMENT]',
      close: '[END OF USER FEEDBACK - Please address this feedback in your current work]',
    },
    ci: {
      open: '[CI/CD STATUS UPDATE — auto-input-until-mergeable]',
      close: '[END OF CI STATUS — Please address the failing checks before continuing]',
    },
    uncommitted: {
      open: '[UNCOMMITTED CHANGES DETECTED — auto-input-until-mergeable]',
      close: '[END OF UNCOMMITTED CHANGES — Please commit them if part of the solution, or revert them otherwise]',
    },
    metadata: {
      open: '[ISSUE/PR METADATA UPDATE — auto-input-until-mergeable]',
      close: '[END OF METADATA UPDATE — Please incorporate this into your current work]',
    },
  };
  const { open, close } = headers[kind] || headers.comment;
  const message = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${open}\n\n${feedbackText}\n\n${close}`,
        },
      ],
    },
  };
  return JSON.stringify(message);
};

/**
 * Build the first stream-json user frame for a headless tool session.
 *
 * Issue #817: When --accept-incomming-comments-as-input is enabled, solve
 * spawns the tool with `--input-format stream-json` and a pipe stdin. The
 * initial user prompt must therefore be delivered as a NDJSON frame rather
 * than via `-p`. This matches the pattern from the reference gist
 * `claude-stream-persistent.mjs`.
 *
 * @param {string} promptText - The initial user prompt
 * @param {Object} [options]
 * @param {string} [options.sessionId] - Optional session_id to stamp on the frame
 * @returns {string} NDJSON-ready JSON string (no trailing newline)
 */
const buildInitialUserFrame = (promptText, options = {}) => {
  const frame = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: String(promptText ?? '') }],
    },
    parent_tool_use_id: null,
  };
  if (options.sessionId) frame.session_id = options.sessionId;
  return JSON.stringify(frame);
};

/**
 * Write one NDJSON frame into a live stream-json stdin stream.
 *
 * Returns true on a successful write, false when the stream is missing or
 * closed. Never throws — callers just log and continue. Internal helper used
 * by both the comment-polling loop and `streamInitialPrompt`.
 *
 * @param {Object} stream - A writable stream (child.stdin)
 * @param {string} jsonFrame - A single JSON frame (no trailing newline)
 * @param {Function} [logFn] - Optional logger
 * @param {boolean} [verbose=false]
 * @returns {Promise<boolean>}
 * @private
 */
const writeFrameToStdin = async (stream, jsonFrame, logFn, verbose = false) => {
  if (!stream || typeof stream.write !== 'function') return false;
  if (stream.destroyed || stream.writableEnded || stream.closed) return false;
  try {
    stream.write(`${jsonFrame}\n`);
    return true;
  } catch (err) {
    if (logFn && verbose) {
      try {
        await logFn(`⚠️ Bidirectional mode: Failed to write to tool stdin: ${err.message}`, { verbose: true });
      } catch {
        /* ignore logger errors */
      }
    }
    return false;
  }
};

/**
 * Creates a bidirectional interactive mode handler
 *
 * @param {Object} options - Handler configuration
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number
 * @param {number} [options.issueNumber] - Issue number (for issue body/title polling — Issue #1708)
 * @param {string} [options.tempDir] - Local clone directory (for uncommitted-changes polling — Issue #1708)
 * @param {Function} options.$ - command-stream $ function
 * @param {Function} options.log - Logging function
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {number} [options.pollInterval=15000] - Interval between comment checks (ms)
 * @param {boolean} [options.excludeOwnComments=false] - Exclude comments authored by the same GitHub user that solve runs as (prevents "talking to yourself")
 * @param {string} [options.deliveryMode='stream'] - 'stream' (immediate forward) or 'queue' (hold until AI idle). Issue #1708.
 * @param {boolean} [options.streamStatusToInput=false] - Also stream CI/uncommitted/PR-status changes as NDJSON frames. Issue #1708.
 * @param {number} [options.statusPollInterval=60000] - Status-poller interval (ms) when streamStatusToInput is on.
 * @param {string} [options.toolLabel='AI tool'] - Human label for logging stdin writes.
 * @returns {Object} Handler object with monitoring methods
 */
export const createBidirectionalHandler = options => {
  const { owner, repo, prNumber, issueNumber, tempDir, $, log, verbose = false, pollInterval = CONFIG.DEFAULT_POLL_INTERVAL, excludeOwnComments = false, deliveryMode = 'stream', streamStatusToInput = false, statusPollInterval = 60000, toolLabel = 'AI tool' } = options;
  // Resolved lazily on first check, cached for the lifetime of the handler
  let ownUserLogin = null;
  let ownUserResolved = false;
  const resolveOwnUserLogin = async () => {
    if (ownUserResolved) return ownUserLogin;
    try {
      const result = await $`gh api user --jq .login`;
      ownUserLogin = (result.stdout?.toString() || '').trim() || null;
    } catch (error) {
      if (verbose) {
        await log(`⚠️ Bidirectional mode: Could not resolve current gh user: ${error.message}`, { verbose: true });
      }
      ownUserLogin = null;
    }
    ownUserResolved = true;
    return ownUserLogin;
  };

  // State tracking for the handler
  const state = {
    isMonitoring: false,
    lastCheckedCommentId: null,
    lastCheckedTimestamp: null,
    feedbackQueue: [],
    pollIntervalId: null,
    processedCommentIds: new Set(),
    totalCommentsProcessed: 0,
    totalFeedbackQueued: 0,
    // Issue #817/#2007: Writable stdin of the live stream-json process. When set, new
    // non-system comments are written directly as NDJSON frames rather than
    // only accumulated in feedbackQueue.
    claudeStdin: null,
    totalFeedbackStreamed: 0,
    // Issue #1708: Queue-comments-to-input support — buffer NDJSON frames
    // until the AI signals it is idle (result event seen) and only then
    // flush them to stdin. In stream mode pendingFrames is bypassed; the
    // frame is written immediately as before.
    isAiBusy: false,
    pendingFrames: [],
    totalFramesQueued: 0,
    totalFramesFlushed: 0,
    // Issue #1708: Status-poller state. When streamStatusToInput is true,
    // a separate poller emits NDJSON frames for CI/uncommitted/PR-metadata
    // changes detected during the session. Signatures dedupe so the same
    // failing check doesn't generate a frame on every poll.
    statusPollIntervalId: null,
    statusSignatures: new Set(),
    lastIssueSnapshot: null,
    lastPrSnapshot: null,
    totalStatusFramesSent: 0,
  };

  /**
   * Fetch comments from a GitHub API endpoint.
   *
   * @param {string} apiPath
   * @param {string} source
   * @returns {Promise<Array>} Array of normalized comment objects
   * @private
   */
  const fetchCommentsFromEndpoint = async (apiPath, source) => {
    try {
      const result = await $`gh api ${apiPath} --paginate --slurp`;
      const parsed = JSON.parse(result.stdout?.toString() || '[]');
      const comments = Array.isArray(parsed) && parsed.every(Array.isArray) ? parsed.flat() : parsed;
      return comments.map(comment => ({
        id: comment.id,
        body: comment.body || '',
        created_at: comment.created_at,
        user: typeof comment.user === 'string' ? comment.user : comment.user?.login || '',
        source,
      }));
    } catch (error) {
      if (verbose) {
        await log(`⚠️ Bidirectional mode: Failed to fetch ${source} comments: ${error.message}`, { verbose: true });
      }
      return [];
    }
  };

  /**
   * Fetch recent comments from PR conversation, PR review, and source issue.
   *
   * @returns {Promise<Array>} Array of comment objects
   * @private
   */
  const fetchRecentComments = async () => {
    if (!prNumber || !owner || !repo) {
      if (verbose) {
        await log('⚠️ Bidirectional mode: Cannot fetch comments - missing PR info', { verbose: true });
      }
      return [];
    }

    const comments = [...(await fetchCommentsFromEndpoint(`repos/${owner}/${repo}/issues/${prNumber}/comments`, 'pull request conversation')), ...(await fetchCommentsFromEndpoint(`repos/${owner}/${repo}/pulls/${prNumber}/comments`, 'pull request review'))];

    if (issueNumber && String(issueNumber) !== String(prNumber)) {
      comments.push(...(await fetchCommentsFromEndpoint(`repos/${owner}/${repo}/issues/${issueNumber}/comments`, 'issue')));
    }

    const seenKeys = new Set();
    const uniqueComments = [];
    for (const comment of comments) {
      const key = comment.id == null ? `${comment.source}:${comment.created_at}:${comment.user}:${comment.body}` : String(comment.id);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      uniqueComments.push(comment);
    }

    return uniqueComments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  };

  /**
   * Issue #1708: Delivery-mode-aware frame dispatcher.
   *
   * - In stream mode (default for --accept-incomming-comments-as-input),
   *   the frame is written to the tool stdin immediately.
   * - In queue mode (default for --auto-input-until-mergeable), the frame
   *   is buffered in state.pendingFrames while the AI is busy; on idle
   *   (markAiIdle) the buffer is flushed to stdin in FIFO order.
   *
   * Always returns true if the frame was either written or buffered,
   * false if the stream is missing/closed.
   *
   * @param {string} jsonFrame
   * @param {Object} [meta]
   * @param {string} [meta.kind]
   * @param {string} [meta.label]
   * @returns {Promise<boolean>}
   * @private
   */
  const dispatchFrame = async (jsonFrame, meta = {}) => {
    if (!state.claudeStdin) return false;
    const useQueue = deliveryMode === 'queue';
    if (useQueue && state.isAiBusy) {
      if (state.pendingFrames.length < CONFIG.MAX_QUEUE_SIZE) {
        state.pendingFrames.push({ jsonFrame, meta });
        state.totalFramesQueued++;
        if (verbose) {
          await log(`⏸️ Bidirectional mode: Queued frame (${meta.kind || 'frame'}: ${meta.label || ''}) — AI is busy, will flush on idle`, { verbose: true });
        }
        return true;
      }
      if (verbose) {
        await log(`⚠️ Bidirectional mode: Pending-frames buffer full, dropping frame (${meta.kind || 'frame'})`, { verbose: true });
      }
      return false;
    }
    const ok = await writeFrameToStdin(state.claudeStdin, jsonFrame, log, verbose);
    if (ok) {
      state.totalFeedbackStreamed++;
      if (verbose) {
        await log(`📤 Bidirectional mode: Streamed frame (${meta.kind || 'frame'}: ${meta.label || ''}) into ${toolLabel} stdin`, { verbose: true });
      }
    }
    return ok;
  };

  /**
   * Issue #1708: Mark the AI as actively processing. While busy, queue mode
   * holds new frames in state.pendingFrames instead of writing to stdin.
   * Safe to call repeatedly — idempotent.
   */
  const markAiBusy = () => {
    state.isAiBusy = true;
  };

  /**
   * Issue #1708: Mark the AI as idle (waiting for next user input). Triggers
   * a flush of any frames queued while busy, in FIFO order. Safe to call
   * repeatedly — flushes only if pendingFrames is non-empty.
   *
   * @returns {Promise<number>} Number of frames flushed.
   */
  const markAiIdle = async () => {
    state.isAiBusy = false;
    if (state.pendingFrames.length === 0) return 0;
    if (!state.claudeStdin) {
      if (verbose) {
        await log(`⚠️ Bidirectional mode: AI idle but no stdin attached — ${state.pendingFrames.length} frame(s) remain queued`, { verbose: true });
      }
      return 0;
    }
    let flushed = 0;
    while (state.pendingFrames.length > 0) {
      const { jsonFrame, meta } = state.pendingFrames.shift();
      const ok = await writeFrameToStdin(state.claudeStdin, jsonFrame, log, verbose);
      if (!ok) {
        // Stream closed mid-flush — push the frame back so finalize can surface it.
        state.pendingFrames.unshift({ jsonFrame, meta });
        break;
      }
      flushed++;
      state.totalFramesFlushed++;
      state.totalFeedbackStreamed++;
      if (verbose) {
        await log(`📤 Bidirectional mode: Flushed pending frame (${meta?.kind || 'frame'}: ${meta?.label || ''}) into ${toolLabel} stdin`, { verbose: true });
      }
    }
    return flushed;
  };

  /**
   * Check for new user comments and queue them as feedback
   * @private
   */
  const checkForNewComments = async () => {
    if (!state.isMonitoring) {
      return;
    }

    try {
      const comments = await fetchRecentComments();

      if (comments.length === 0) {
        return;
      }

      // Resolve current user login once if we need to exclude own comments
      const ownLogin = excludeOwnComments ? await resolveOwnUserLogin() : null;

      // Filter for new comments we haven't processed yet
      for (const comment of comments) {
        // Skip if already processed
        if (state.processedCommentIds.has(comment.id)) {
          continue;
        }

        // Skip if this is a system-generated comment (comments generated by our own solve command)
        if (isSystemComment(comment.body)) {
          state.processedCommentIds.add(comment.id);
          continue;
        }

        // Issue #817: Optionally skip comments authored by the same GitHub user that solve runs as
        if (excludeOwnComments && ownLogin && comment.user === ownLogin) {
          if (verbose) {
            await log(`⏭️ Bidirectional mode: Skipping comment #${comment.id} from own user @${ownLogin} (--exclude-all-own-incomming-comments-from-input)`, { verbose: true });
          }
          state.processedCommentIds.add(comment.id);
          continue;
        }

        // This is a new user comment - queue it as feedback
        if (state.feedbackQueue.length < CONFIG.MAX_QUEUE_SIZE) {
          const formattedMessage = formatFeedbackForClaude(comment.body, { kind: 'comment' });
          state.feedbackQueue.push({
            id: comment.id,
            body: comment.body,
            user: comment.user,
            created_at: comment.created_at,
            formattedMessage,
          });
          state.totalFeedbackQueued++;

          if (verbose) {
            await log(`📥 Bidirectional mode: Queued feedback from @${comment.user} (${comment.source || 'comment'} #${comment.id})`, { verbose: true });
          }

          // Issue #817 / #1708: Dispatch through the delivery-mode router so
          // queue-comments-to-input can hold the frame until the AI is idle.
          await dispatchFrame(formattedMessage, {
            kind: 'comment',
            label: `${comment.source || 'comment'} #${comment.id} from @${comment.user}`,
          });
        } else {
          if (verbose) {
            await log(`⚠️ Bidirectional mode: Feedback queue full, skipping comment #${comment.id}`, { verbose: true });
          }
        }

        state.processedCommentIds.add(comment.id);
        state.totalCommentsProcessed++;
      }
    } catch (error) {
      if (verbose) {
        await log(`⚠️ Bidirectional mode: Error checking comments: ${error.message}`, { verbose: true });
      }
    }
  };

  /**
   * Issue #1708: Fetch a snapshot of an issue's or PR's title+body for
   * change detection. Returns null when fetching fails — callers treat
   * null as "skip this round" rather than as an empty snapshot.
   *
   * @param {'issue'|'pr'} kind
   * @param {number} number
   * @returns {Promise<{title:string, body:string}|null>}
   * @private
   */
  const fetchMetadataSnapshot = async (kind, number) => {
    if (!number || !owner || !repo) return null;
    try {
      const endpoint = kind === 'pr' ? `repos/${owner}/${repo}/pulls/${number}` : `repos/${owner}/${repo}/issues/${number}`;
      const result = await $`gh api ${endpoint} --jq '{title, body}'`;
      if (!result || result.code !== 0) return null;
      const parsed = JSON.parse(result.stdout.toString() || '{}');
      return { title: parsed.title || '', body: parsed.body || '' };
    } catch (error) {
      if (verbose) {
        await log(`⚠️ Bidirectional mode: Metadata fetch failed for ${kind} #${number}: ${error.message}`, { verbose: true });
      }
      return null;
    }
  };

  /**
   * Issue #1708: Diff two metadata snapshots and produce a human-readable
   * summary. Returns null when nothing changed.
   *
   * @param {{title:string, body:string}|null} prev
   * @param {{title:string, body:string}|null} next
   * @returns {string|null}
   * @private
   */
  const diffMetadataSnapshot = (prev, next) => {
    if (!prev || !next) return null;
    const lines = [];
    if (prev.title !== next.title) {
      lines.push(`Title changed:\n  before: ${prev.title}\n  after:  ${next.title}`);
    }
    if (prev.body !== next.body) {
      lines.push(`Body changed (length ${prev.body.length} → ${next.body.length}). New body:\n${next.body}`);
    }
    return lines.length > 0 ? lines.join('\n\n') : null;
  };

  /**
   * Issue #1708: Status poller. Runs alongside the comment poller while
   * --auto-input-until-mergeable is on. On every tick, it checks:
   *   - PR title/body changes (vs the previous snapshot)
   *   - Issue title/body changes (vs the previous snapshot)
   *   - Uncommitted changes (git status --porcelain in tempDir)
   *   - CI/CD blockers (via getMergeBlockers)
   *
   * For each change, a one-shot NDJSON frame is dispatched through the
   * delivery-mode router. Each change is keyed by a stable signature so
   * the same failing check doesn't re-emit on every poll.
   *
   * Failures in any sub-check are swallowed and logged — the poller must
   * never break the live tool session.
   *
   * @private
   */
  const checkForStatusChanges = async () => {
    if (!state.isMonitoring) return;
    if (!state.claudeStdin) return;
    // PR metadata
    if (prNumber) {
      const next = await fetchMetadataSnapshot('pr', prNumber);
      if (next) {
        if (state.lastPrSnapshot === null) {
          state.lastPrSnapshot = next;
        } else {
          const summary = diffMetadataSnapshot(state.lastPrSnapshot, next);
          if (summary) {
            const frame = formatFeedbackForClaude(`Pull request #${prNumber} metadata changed during this session:\n\n${summary}`, { kind: 'metadata' });
            await dispatchFrame(frame, { kind: 'metadata', label: `PR #${prNumber} title/body` });
            state.totalStatusFramesSent++;
            state.lastPrSnapshot = next;
          }
        }
      }
    }
    // Issue metadata (only when issueNumber differs from prNumber to avoid double-fetch)
    if (issueNumber && issueNumber !== prNumber) {
      const next = await fetchMetadataSnapshot('issue', issueNumber);
      if (next) {
        if (state.lastIssueSnapshot === null) {
          state.lastIssueSnapshot = next;
        } else {
          const summary = diffMetadataSnapshot(state.lastIssueSnapshot, next);
          if (summary) {
            const frame = formatFeedbackForClaude(`Issue #${issueNumber} metadata changed during this session:\n\n${summary}`, { kind: 'metadata' });
            await dispatchFrame(frame, { kind: 'metadata', label: `issue #${issueNumber} title/body` });
            state.totalStatusFramesSent++;
            state.lastIssueSnapshot = next;
          }
        }
      }
    }
    // Uncommitted changes
    if (tempDir) {
      try {
        const result = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
        if (result && result.code === 0) {
          const out = (result.stdout?.toString() || '').trim();
          const sig = `uncommitted::${out}`;
          if (out && !state.statusSignatures.has(sig)) {
            state.statusSignatures.add(sig);
            const frame = formatFeedbackForClaude(`The local clone has uncommitted changes (git status --porcelain):\n\n${out}\n\nPlease either commit them (git add + git commit + git push) if they belong to the solution, or revert them (git checkout -- <file> or git clean -fd) otherwise.`, { kind: 'uncommitted' });
            await dispatchFrame(frame, { kind: 'uncommitted', label: 'git status --porcelain' });
            state.totalStatusFramesSent++;
          }
        }
      } catch (error) {
        if (verbose) {
          await log(`⚠️ Bidirectional mode: Uncommitted-changes poll failed: ${error.message}`, { verbose: true });
        }
      }
    }
    // CI/CD blockers — only when we have prNumber + a working ./solve.auto-merge-helpers
    if (prNumber) {
      try {
        const helpers = await import('./solve.auto-merge-helpers.lib.mjs');
        if (helpers && typeof helpers.getMergeBlockers === 'function') {
          const { blockers } = await helpers.getMergeBlockers(owner, repo, prNumber, false, 1, null);
          for (const b of blockers || []) {
            // Only stream actionable failures (not "ci_pending" or "ci_cancelled"
            // — those don't need AI involvement and would be noise).
            if (b.type !== 'ci_failure' && b.type !== 'not_mergeable') continue;
            const sig = `ci::${b.type}::${(b.details && b.details[0]) || b.message}`;
            if (state.statusSignatures.has(sig)) continue;
            state.statusSignatures.add(sig);
            const detailLines = (b.details || []).map(d => `  - ${d}`).join('\n');
            const frame = formatFeedbackForClaude(`CI/CD blocker detected during this session: ${b.message}\n${detailLines || ''}\n\nPlease address the failing checks before continuing.`, { kind: 'ci' });
            await dispatchFrame(frame, { kind: 'ci', label: b.message });
            state.totalStatusFramesSent++;
          }
        }
      } catch (error) {
        if (verbose) {
          await log(`⚠️ Bidirectional mode: CI status poll failed: ${error.message}`, { verbose: true });
        }
      }
    }
  };

  /**
   * Start monitoring issue/PR comments for user feedback
   *
   * @returns {Promise<void>}
   */
  const startMonitoring = async () => {
    if (state.isMonitoring) {
      if (verbose) {
        await log('ℹ️ Bidirectional mode: Already monitoring', { verbose: true });
      }
      return;
    }

    if (!prNumber || !owner || !repo) {
      if (verbose) {
        await log('⚠️ Bidirectional mode: Cannot start monitoring - missing PR info', { verbose: true });
      }
      return;
    }

    state.isMonitoring = true;

    // Do initial check
    await checkForNewComments();

    // Set up polling interval
    const interval = Math.max(pollInterval, CONFIG.MIN_POLL_INTERVAL);
    state.pollIntervalId = setInterval(async () => {
      await checkForNewComments();
    }, interval);

    if (verbose) {
      await log(`🔌 Bidirectional mode: Started monitoring issue/PR comments for PR #${prNumber} (polling every ${interval / 1000}s)`, { verbose: true });
    }

    // Issue #1708: When --auto-input-until-mergeable enables status streaming,
    // start a parallel poller that watches CI/uncommitted/PR-metadata changes
    // and emits NDJSON frames so the live AI session reacts to them without
    // requiring an auto-restart.
    if (streamStatusToInput) {
      // Take an initial snapshot so the first real diff is meaningful.
      if (prNumber) state.lastPrSnapshot = await fetchMetadataSnapshot('pr', prNumber);
      if (issueNumber && issueNumber !== prNumber) state.lastIssueSnapshot = await fetchMetadataSnapshot('issue', issueNumber);
      const statusInterval = Math.max(statusPollInterval, CONFIG.MIN_POLL_INTERVAL);
      state.statusPollIntervalId = setInterval(async () => {
        try {
          await checkForStatusChanges();
        } catch (error) {
          if (verbose) {
            await log(`⚠️ Bidirectional mode: Status poll error: ${error.message}`, { verbose: true });
          }
        }
      }, statusInterval);
      if (verbose) {
        await log(`🔌 Bidirectional mode: Started status poller (CI/uncommitted/PR-metadata) every ${statusInterval / 1000}s`, { verbose: true });
      }
    }
  };

  /**
   * Stop monitoring issue/PR comments
   *
   * @returns {Promise<void>}
   */
  const stopMonitoring = async () => {
    if (!state.isMonitoring) {
      return;
    }

    state.isMonitoring = false;

    if (state.pollIntervalId) {
      clearInterval(state.pollIntervalId);
      state.pollIntervalId = null;
    }
    if (state.statusPollIntervalId) {
      clearInterval(state.statusPollIntervalId);
      state.statusPollIntervalId = null;
    }

    if (verbose) {
      await log(`🔌 Bidirectional mode: Stopped monitoring (processed ${state.totalCommentsProcessed} comments, queued ${state.totalFeedbackQueued} feedback, ${state.totalStatusFramesSent} status frames)`, { verbose: true });
    }
  };

  /**
   * Get next queued feedback message (FIFO)
   * Does not remove from queue - use acknowledgeFeedback() after processing
   *
   * @returns {Object|null} Next feedback object or null if queue is empty
   */
  const peekFeedback = () => {
    if (state.feedbackQueue.length === 0) {
      return null;
    }
    return state.feedbackQueue[0];
  };

  /**
   * Get and remove next queued feedback message (FIFO)
   *
   * @returns {Object|null} Next feedback object or null if queue is empty
   */
  const popFeedback = () => {
    if (state.feedbackQueue.length === 0) {
      return null;
    }
    return state.feedbackQueue.shift();
  };

  /**
   * Get all queued feedback messages without removing them
   *
   * @returns {Array} Array of queued feedback objects
   */
  const getAllQueuedFeedback = () => {
    return [...state.feedbackQueue];
  };

  /**
   * Check if there is any queued feedback
   *
   * @returns {boolean} True if there is queued feedback
   */
  const hasFeedback = () => {
    return state.feedbackQueue.length > 0;
  };

  /**
   * Get the count of queued feedback messages
   *
   * @returns {number} Number of queued feedback messages
   */
  const getFeedbackCount = () => {
    return state.feedbackQueue.length;
  };

  /**
   * Clear all queued feedback
   */
  const clearFeedbackQueue = () => {
    state.feedbackQueue = [];
  };

  /**
   * Mark a specific comment ID as already processed
   * Useful for filtering out comments that existed before monitoring started
   *
   * @param {number} commentId - Comment ID to mark as processed
   */
  const markCommentAsProcessed = commentId => {
    state.processedCommentIds.add(commentId);
  };

  /**
   * Initialize with existing comment IDs to skip
   * Call this before startMonitoring() to avoid processing old comments
   *
   * @param {Array<number>} commentIds - Array of comment IDs to skip
   */
  const initializeWithExistingComments = commentIds => {
    for (const id of commentIds) {
      state.processedCommentIds.add(id);
    }
  };

  /**
   * Fetch and mark all existing comments as processed
   * Call this before startMonitoring() to only get new comments
   *
   * @returns {Promise<number>} Number of existing comments marked
   */
  const initializeFromCurrentComments = async () => {
    const comments = await fetchRecentComments();
    for (const comment of comments) {
      state.processedCommentIds.add(comment.id);
    }
    if (verbose) {
      await log(`📋 Bidirectional mode: Initialized with ${comments.length} existing comments`, { verbose: true });
    }
    return comments.length;
  };

  /**
   * Attach a live tool stdin stream to the handler.
   *
   * Issue #817/#2007: Once attached, every new non-system comment detected by
   * the polling loop is also written to this stream as a NDJSON `user` frame.
   * Safe to call before or after monitoring starts.
   *
   * @param {Object} stream - Writable stream (child.stdin)
   */
  const attachToolStdin = stream => {
    state.claudeStdin = stream || null;
  };

  /**
   * Detach the tool stdin stream. After this call, comments are only queued.
   */
  const detachToolStdin = () => {
    state.claudeStdin = null;
  };

  // Compatibility aliases for the original Claude-only public surface.
  const attachClaudeStdin = attachToolStdin;
  const detachClaudeStdin = detachToolStdin;

  /**
   * Stream the initial user prompt as a stream-json frame into the attached
   * tool stdin. Use this when running a tool with `--input-format stream-json`.
   *
   * @param {string} promptText
   * @param {Object} [options]
   * @param {string} [options.sessionId]
   * @returns {Promise<boolean>} Whether the write succeeded
   */
  const streamInitialPrompt = async (promptText, options = {}) => {
    if (!state.claudeStdin) return false;
    const frame = buildInitialUserFrame(promptText, options);
    return writeFrameToStdin(state.claudeStdin, frame, log, verbose);
  };

  /**
   * Stream a non-comment feedback message into the attached tool stdin.
   *
   * @param {string} feedbackText
   * @param {Object} [options]
   * @param {string} [options.kind='metadata']
   * @returns {Promise<boolean>} Whether the write succeeded
   */
  const sendFeedback = async (feedbackText, options = {}) => {
    if (!state.claudeStdin) return false;
    const frame = formatFeedbackForClaude(feedbackText, { kind: options.kind || 'metadata' });
    return writeFrameToStdin(state.claudeStdin, frame, log, verbose);
  };

  /**
   * Get current handler state (for debugging)
   *
   * @returns {Object} Current state
   */
  const getState = () => ({
    isMonitoring: state.isMonitoring,
    feedbackQueueLength: state.feedbackQueue.length,
    processedCommentCount: state.processedCommentIds.size,
    totalCommentsProcessed: state.totalCommentsProcessed,
    totalFeedbackQueued: state.totalFeedbackQueued,
    totalFeedbackStreamed: state.totalFeedbackStreamed,
    isStreamingAttached: !!state.claudeStdin,
    // Issue #1708 additions
    deliveryMode,
    streamStatusToInput,
    isAiBusy: state.isAiBusy,
    pendingFramesLength: state.pendingFrames.length,
    totalFramesQueued: state.totalFramesQueued,
    totalFramesFlushed: state.totalFramesFlushed,
    totalStatusFramesSent: state.totalStatusFramesSent,
  });

  return {
    startMonitoring,
    stopMonitoring,
    peekFeedback,
    popFeedback,
    getAllQueuedFeedback,
    hasFeedback,
    getFeedbackCount,
    clearFeedbackQueue,
    markCommentAsProcessed,
    initializeWithExistingComments,
    initializeFromCurrentComments,
    attachToolStdin,
    detachToolStdin,
    attachClaudeStdin,
    detachClaudeStdin,
    streamInitialPrompt,
    sendFeedback,
    // Issue #1708: queue mode + status streaming
    markAiBusy,
    markAiIdle,
    checkForStatusChanges,
    getState,
    // Expose for testing
    _internal: {
      checkForNewComments,
      fetchRecentComments,
      isSystemComment,
      formatFeedbackForClaude,
      buildInitialUserFrame,
      writeFrameToStdin,
      dispatchFrame,
      fetchMetadataSnapshot,
      diffMetadataSnapshot,
    },
  };
};

/**
 * Check if bidirectional interactive mode is supported for the given tool
 *
 * @param {string} tool - Tool name (claude, opencode, codex, agent, gemini)
 * @returns {boolean} Whether bidirectional interactive mode is supported
 */
export const isBidirectionalModeSupported = tool => {
  return isLiveInputSupported(tool);
};

/**
 * Apply bidirectional interactive mode composition and validation.
 *
 * Semantics (Issue #817):
 * - --bidirectional-interactive-mode is a convenience flag that automatically enables
 *   --interactive-mode, --accept-incomming-comments-as-input and
 *   --exclude-all-own-incomming-comments-from-input.
 * - Individual flags can still be used on their own (e.g. --interactive-mode with
 *   --accept-incomming-comments-as-input but without --exclude-all-own-..., which lets
 *   the same GitHub user "talk to themself").
 * - All three flags default to disabled and the behavior is experimental.
 *
 * @param {Object} argv - Parsed command line arguments (mutated in place)
 * @param {Function} log - Logging function
 * @returns {Promise<boolean>} Whether configuration is valid for the chosen tool
 */
export const validateBidirectionalModeConfig = async (argv, log) => {
  // Issue #1708/#2007: --auto-input-until-mergeable enables only the
  // input-side of bidirectional mode without enabling --interactive-mode
  // (which would push tool output back as PR comments).
  //
  // Live event input is available for every tool, but the delivery mode differs:
  //   - stream-mode tools (Claude, Agent) get a live stdin pipe.
  //   - fallback-mode tools (Codex, opencode, gemini, qwen, ...) use the
  //     universal restart/resume fallback: the run finishes the current session
  //     in the JSON output, stops, and resumes the AI with the new issue/PR
  //     events as feedback via --auto-restart-until-mergeable.
  if (argv.autoInputUntilMergeable) {
    if (getLiveInputMode(argv.tool) === LIVE_INPUT_MODE_FALLBACK) {
      // No live stdin channel for this tool: activate the restart/resume
      // fallback instead of disabling the feature. Live comment streaming
      // stays off; the auto-restart loop delivers the same events at session
      // boundaries.
      const capability = getLiveInputCapability(argv.tool);
      argv.acceptIncommingCommentsAsInput = false;
      argv.excludeAllOwnIncommingCommentsFromInput = false;
      argv.streamCommentsToInput = false;
      argv.queueCommentsToInput = false;
      // Ensure the fallback loop is actually running. It defaults to enabled,
      // but --auto-input-until-mergeable relies on it entirely for these tools,
      // so re-enable it unless the user explicitly opted out.
      if (argv.autoRestartUntilMergeable !== false) {
        argv.autoRestartUntilMergeable = true;
      }
      await log(`🔁 --auto-input-until-mergeable: live streaming input is not available for --tool ${argv.tool}; using the restart/resume fallback.`, { level: 'info' });
      await log(`   ${capability.unsupportedReason}`, { level: 'info' });
      if (capability.futureProtocol) {
        await log(`   Candidate live-streaming protocol: ${capability.futureProtocol} (tracked in link-assistant/agent).`, { level: 'info' });
      }
      if (argv.autoRestartUntilMergeable === false) {
        await log('   ⚠️ --no-auto-restart-until-mergeable disables the fallback, so no live input mechanism remains for this tool.', { level: 'warning' });
      } else {
        await log('   The auto-restart-until-mergeable loop will resume the session with new issue/PR events (comments, title/body changes, CI failures, conflicts).', { level: 'info' });
      }
      return true;
    }
    if (!argv.acceptIncommingCommentsAsInput) argv.acceptIncommingCommentsAsInput = true;
    // Default delivery mode for --auto-input-until-mergeable is queue:
    // hold comments until the AI is idle so the model can finish the
    // current step before being interrupted.
    if (!argv.streamCommentsToInput && !argv.queueCommentsToInput) {
      argv.queueCommentsToInput = true;
    }
  }

  // Composition: --bidirectional-interactive-mode implies the three experimental flags.
  if (argv.bidirectionalInteractiveMode) {
    if (!argv.interactiveMode) argv.interactiveMode = true;
    if (!argv.acceptIncommingCommentsAsInput) argv.acceptIncommingCommentsAsInput = true;
    if (!argv.excludeAllOwnIncommingCommentsFromInput) argv.excludeAllOwnIncommingCommentsFromInput = true;
  }

  // Default delivery mode for --accept-incomming-comments-as-input on its
  // own is stream (matches the existing #817 behavior of forwarding
  // comments immediately as pollIncomingComments sees them).
  if (argv.acceptIncommingCommentsAsInput && !argv.streamCommentsToInput && !argv.queueCommentsToInput) {
    argv.streamCommentsToInput = true;
  }

  // queue mode wins if both delivery modes are set (defensive, in case the
  // user passes both flags explicitly).
  if (argv.queueCommentsToInput && argv.streamCommentsToInput) {
    argv.streamCommentsToInput = false;
  }

  // Nothing more to validate if no incoming-comment acceptance is requested
  if (!argv.acceptIncommingCommentsAsInput) return true;

  // Live comment *streaming* is only wired for stream-mode tools (uses
  // --input-format stream-json). The universal restart/resume fallback is reached via
  // --auto-input-until-mergeable (handled above), not through the standalone
  // --accept-incomming-comments-as-input / --bidirectional-interactive-mode
  // flags, which are specifically about live streaming.
  if (!isBidirectionalModeSupported(argv.tool)) {
    const capability = getLiveInputCapability(argv.tool);
    const supportedTools = getLiveInputCapabilityRows()
      .filter(row => row.mode === LIVE_INPUT_MODE_STREAM)
      .map(row => `--tool ${row.tool}`)
      .join(' or ');
    await log(`⚠️ Live comment streaming is not supported for --tool ${argv.tool} in this build (supported: ${supportedTools}).`, { level: 'warning' });
    await log(`   ${capability.unsupportedReason}`, { level: 'warning' });
    if (capability.futureProtocol) {
      await log(`   Candidate follow-up protocol: ${capability.futureProtocol}.`, { level: 'warning' });
    }
    await log('   Live incoming-comment streaming will be disabled for this session.', { level: 'warning' });
    await log('   Tip: use --auto-input-until-mergeable to deliver the same issue/PR events through the restart/resume fallback instead.', { level: 'warning' });
    argv.acceptIncommingCommentsAsInput = false;
    argv.excludeAllOwnIncommingCommentsFromInput = false;
    argv.streamCommentsToInput = false;
    argv.queueCommentsToInput = false;
    return false;
  }

  const deliveryMode = argv.queueCommentsToInput ? 'queue' : 'stream';
  const capability = getLiveInputCapability(argv.tool);
  await log('🔌 Bidirectional Interactive Mode: ENABLED (experimental)', { level: 'info' });
  await log(`   accept-incomming-comments-as-input: true${argv.excludeAllOwnIncommingCommentsFromInput ? ', exclude-all-own-incomming-comments-from-input: true' : ''}`, { level: 'info' });
  await log(`   delivery mode: ${deliveryMode}-comments-to-input`, { level: 'info' });
  await log(`   Issue/PR comments will be monitored and queued as feedback for ${capability.label}.`, { level: 'info' });

  return true;
};

/**
 * Set up the bidirectional handler for an execution. Returns `null` when the
 * feature is not requested or PR info is missing — callers can treat a null
 * return as "no-op".
 *
 * @param {Object} params
 * @param {Object} params.argv - Parsed CLI args (expects `acceptIncommingCommentsAsInput`,
 *   `excludeAllOwnIncommingCommentsFromInput`, `queueCommentsToInput`,
 *   `streamCommentsToInput`, `autoInputUntilMergeable`, `verbose`).
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string|number} params.prNumber
 * @param {string|number} [params.issueNumber] - Issue #1708: enables issue title/body polling
 * @param {string} [params.tempDir] - Issue #1708: enables uncommitted-changes polling
 * @param {Function} params.$ - command-stream tagged template
 * @param {Function} params.log
 * @returns {Promise<Object|null>} Started handler or null when inactive.
 */
export const setupBidirectionalHandler = async ({ argv, owner, repo, prNumber, issueNumber, tempDir, $, log }) => {
  if (!argv.acceptIncommingCommentsAsInput) return null;
  if (!owner || !repo || !prNumber) {
    await log('⚠️ Bidirectional mode: Disabled - missing PR info (owner/repo/prNumber)', { verbose: true });
    return null;
  }
  const capability = getLiveInputCapability(argv.tool);
  const toolLabel = capability.label || argv.tool || 'AI tool';
  // Issue #1708: Resolve delivery mode from argv. validateBidirectionalModeConfig
  // already enforces queue-wins-over-stream and the per-flag defaults; here we
  // just translate the booleans into the handler-side enum.
  const deliveryMode = argv.queueCommentsToInput ? 'queue' : 'stream';
  // Issue #1708: Status streaming (CI/uncommitted/PR-metadata → NDJSON frames)
  // is only enabled by --auto-input-until-mergeable; the standalone
  // --accept-incomming-comments-as-input path keeps the existing #817 behavior
  // of forwarding only comments.
  const streamStatusToInput = !!argv.autoInputUntilMergeable;
  await log(`🔌 Bidirectional mode: Creating handler to accept incoming issue/PR comments as ${toolLabel} input`, { verbose: true });
  const handler = createBidirectionalHandler({
    owner,
    repo,
    prNumber,
    issueNumber,
    tempDir,
    $,
    log,
    verbose: argv.verbose,
    pollInterval: 15000,
    excludeOwnComments: !!argv.excludeAllOwnIncommingCommentsFromInput,
    deliveryMode,
    streamStatusToInput,
    toolLabel,
  });
  await handler.initializeFromCurrentComments();
  await handler.startMonitoring();
  await log(`🔌 Bidirectional mode: Started monitoring (delivery: ${deliveryMode}-comments-to-input${streamStatusToInput ? ', status streaming: on' : ''})`, { verbose: true });
  return handler;
};

/**
 * Attach a live tool process to the handler so new comments stream into its
 * stdin as NDJSON frames. Also writes the initial user prompt as the
 * first frame so the run starts normally. Issue #817.
 *
 * Safe to call with a null handler (no-op). Logs diagnostics but never throws.
 *
 * @param {Object|null} handler - Handler from setupBidirectionalHandler, or null
 * @param {Object} execCommand - command-stream ProcessRunner with `streams.stdin`
 * @param {string} prompt - Initial user prompt text
 * @param {Function} log
 * @param {boolean} [verbose=false]
 * @param {Object} [options]
 * @param {string} [options.toolLabel='AI tool']
 * @returns {Promise<boolean>} Whether streaming input is active
 */
export const attachStreamingInput = async (handler, execCommand, prompt, log, verbose = false, options = {}) => {
  if (!handler || !execCommand) return false;
  const toolLabel = options.toolLabel || 'AI tool';
  try {
    const stdinStream = await execCommand.streams.stdin;
    if (!stdinStream) {
      if (verbose) await log(`⚠️ Bidirectional mode: Could not acquire ${toolLabel} stdin stream; falling back to queued-only feedback.`, { verbose: true });
      return false;
    }
    if (typeof handler.attachToolStdin === 'function') {
      handler.attachToolStdin(stdinStream);
    } else {
      handler.attachClaudeStdin(stdinStream);
    }
    const ok = await handler.streamInitialPrompt(prompt);
    if (verbose) await log(`🔌 Bidirectional mode: Streaming input ${ok ? 'ENABLED' : 'FAILED'} (wrote initial user frame to ${toolLabel} stdin).`, { verbose: true });
    return ok;
  } catch (attachError) {
    await log(`⚠️ Bidirectional mode: Failed to attach stdin (${attachError.message}); continuing without live streaming.`, { verbose: true });
    return false;
  }
};

/**
 * Stop the handler, flush its queue, and log a summary. Safe to call with a
 * null handler (returns an empty array).
 *
 * @param {Object|null} handler - Handler returned by setupBidirectionalHandler, or null.
 * @param {Function} log
 * @returns {Promise<Array>} Queued feedback messages (possibly empty).
 */
export const finalizeBidirectionalHandler = async (handler, log) => {
  if (!handler) return [];
  try {
    if (typeof handler.detachToolStdin === 'function') {
      handler.detachToolStdin();
    } else {
      handler.detachClaudeStdin?.();
    }
    await handler.stopMonitoring();
    const state = handler.getState();
    const queuedFeedback = handler.getAllQueuedFeedback();
    if (queuedFeedback.length > 0) {
      await log(`\n📥 Bidirectional mode: ${queuedFeedback.length} feedback message(s) received during execution`, { level: 'info' });
      for (const feedback of queuedFeedback) {
        await log(`   • From @${feedback.user}: ${feedback.body.substring(0, 100)}${feedback.body.length > 100 ? '...' : ''}`, { level: 'info' });
      }
      if (state.totalFeedbackStreamed > 0) {
        await log(`   📤 ${state.totalFeedbackStreamed} of these were streamed live into the tool stdin.`, { level: 'info' });
      } else {
        await log('   💡 This feedback will be available for the next continuation of this task.', { level: 'info' });
      }
    } else {
      await log('📊 Bidirectional mode: No new feedback received during execution', { verbose: true });
    }
    await log(`📊 Bidirectional mode stats: ${state.totalCommentsProcessed} comments processed, ${state.totalFeedbackQueued} feedback queued, ${state.totalFeedbackStreamed} streamed into tool stdin`, { verbose: true });
    return queuedFeedback;
  } catch (bidirectionalError) {
    await log(`⚠️ Bidirectional mode cleanup error: ${bidirectionalError.message}`, { verbose: true });
    return [];
  }
};

// Export utilities for testing
export const utils = {
  isSystemComment,
  formatFeedbackForClaude,
  buildInitialUserFrame,
  writeFrameToStdin,
  CONFIG,
};

// Export all functions
export default {
  createBidirectionalHandler,
  isBidirectionalModeSupported,
  validateBidirectionalModeConfig,
  setupBidirectionalHandler,
  finalizeBidirectionalHandler,
  utils,
};
