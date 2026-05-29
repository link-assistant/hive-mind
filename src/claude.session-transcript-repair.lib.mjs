#!/usr/bin/env node

// Issue #1834 (PR #1836): repair a Claude Code session transcript that was poisoned by a
// corrupted extended-thinking block, so the session can be RESUMED (context preserved) instead
// of being discarded entirely.
//
// Root cause (upstream anthropics/claude-code#63147, #46843, #24662, #41992): when extended
// thinking is combined with tool use, Claude Code can persist a thinking block to the on-disk
// session JSONL with its `thinking` text emptied to "" while keeping the original `signature`:
//
//   { "type": "thinking", "thinking": "", "signature": "Eyc…" }
//
// On resume/continue the API replays that block and validates the signature against the now-empty
// text, rejecting every following turn with a 400:
//   `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified.
//
// The proven community workaround (anthropics/claude-code#46843, miteshashar/claude-code-thinking-
// blocks-fix) is to STRIP the corrupted (empty-text) thinking blocks from the transcript — the API
// permits omitting earlier-turn thinking, so once the offending blocks are gone the session resumes
// cleanly with all of its text/tool-use history intact. This is strictly better than throwing the
// whole session away: when the repair succeeds we keep the accumulated context (worth many dollars
// and dozens of turns); when it can't help we still fall back to a fresh restart.

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

/**
 * Resolve the on-disk session transcript path for a Claude Code session. Claude Code stores each
 * session as `~/.claude/projects/<cwd-with-slashes-as-dashes>/<sessionId>.jsonl` (mirrors the
 * path logic already used by getModelUsageFromSession in claude.lib.mjs).
 *
 * @param {string} tempDir - the working directory the Claude session ran in.
 * @param {string} sessionId - the Claude Code session id.
 * @param {string} [homeDir] - override home dir (tests).
 * @returns {string} absolute path to the session JSONL file.
 */
export const resolveSessionTranscriptPath = (tempDir, sessionId, homeDir = os.homedir()) => {
  const projectDirName = String(tempDir).replace(/\//g, '-');
  return path.join(homeDir, '.claude', 'projects', projectDirName, `${sessionId}.jsonl`);
};

/**
 * True when a content block is a corrupted thinking block: an extended-thinking block whose text
 * was emptied (the upstream corruption) — `{ type: 'thinking', thinking: '' }` (optionally with a
 * stale `signature`) or the redacted variant `{ type: 'redacted_thinking', data: '' }`.
 */
const isCorruptedThinkingBlock = block => {
  if (!block || typeof block !== 'object') return false;
  if (block.type === 'thinking') return !block.thinking; // '' / undefined / null
  if (block.type === 'redacted_thinking') return !block.data;
  return false;
};

/**
 * Strip corrupted (empty-text) thinking blocks from a Claude Code session transcript so the session
 * can be resumed. Conservative and side-effect-safe:
 *   - never throws (returns a result object describing what happened);
 *   - only removes blocks whose thinking text is empty (legitimate signed thinking is untouched);
 *   - never empties an assistant message (if removing the blocks would leave a message with no
 *     content, that message is left exactly as-is);
 *   - writes a one-time backup (`<file>.pre-repair-backup`) before modifying the transcript.
 *
 * @param {object} opts
 * @param {string} opts.tempDir - working directory the session ran in.
 * @param {string} opts.sessionId - Claude Code session id.
 * @param {string} [opts.homeDir] - override home dir (tests).
 * @param {Function} [opts.log] - async logger.
 * @returns {Promise<{ repaired: boolean, removedBlocks: number, scannedLines: number, sessionFile: string|null, reason?: string }>}
 */
export const repairCorruptedThinkingBlocks = async ({ tempDir, sessionId, homeDir, log = async () => {} } = {}) => {
  const result = { repaired: false, removedBlocks: 0, scannedLines: 0, sessionFile: null };
  if (!tempDir || !sessionId) {
    return { ...result, reason: 'missing tempDir or sessionId' };
  }
  const sessionFile = resolveSessionTranscriptPath(tempDir, sessionId, homeDir);
  result.sessionFile = sessionFile;
  let fileContent;
  try {
    fileContent = await fs.readFile(sessionFile, 'utf8');
  } catch {
    // No transcript on disk (e.g. fresh run never persisted, or path mismatch) — nothing to repair.
    return { ...result, reason: 'session transcript not found' };
  }

  try {
    const lines = fileContent.split('\n');
    const out = [];
    let removedBlocks = 0;
    let scannedLines = 0;
    for (const line of lines) {
      if (!line.trim()) {
        out.push(line);
        continue;
      }
      scannedLines++;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        out.push(line); // preserve anything we can't parse verbatim
        continue;
      }
      const content = entry?.message?.content;
      if (Array.isArray(content)) {
        const corrupted = content.filter(isCorruptedThinkingBlock).length;
        if (corrupted > 0) {
          const cleaned = content.filter(b => !isCorruptedThinkingBlock(b));
          // Never leave an assistant message with an empty content array (invalid for the API).
          if (cleaned.length > 0) {
            entry.message.content = cleaned;
            removedBlocks += corrupted;
            out.push(JSON.stringify(entry));
            continue;
          }
        }
      }
      out.push(line);
    }

    result.scannedLines = scannedLines;
    if (removedBlocks === 0) {
      return { ...result, reason: 'no corrupted thinking blocks found' };
    }

    // Back up the original transcript exactly once before rewriting it.
    const backupFile = `${sessionFile}.pre-repair-backup`;
    try {
      await fs.access(backupFile);
    } catch {
      try {
        await fs.copyFile(sessionFile, backupFile);
      } catch {
        // Best effort — a missing backup must not block the repair.
      }
    }

    await fs.writeFile(sessionFile, out.join('\n'), 'utf8');
    result.repaired = true;
    result.removedBlocks = removedBlocks;
    await log(`🩹 Repaired session transcript: stripped ${removedBlocks} corrupted thinking block(s) from ${scannedLines} message line(s) (Issue #1834). Backup: ${backupFile}`, { verbose: true });
    return result;
  } catch (error) {
    // Defensive: any unexpected failure degrades gracefully to "no repair" so the caller can fall
    // back to a fresh restart.
    return { ...result, reason: `repair failed: ${error?.message || error}` };
  }
};

export default { repairCorruptedThinkingBlocks, resolveSessionTranscriptPath };
