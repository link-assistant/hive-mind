/**
 * Telegram bot virtual option: --show-limits (experimental).
 *
 * The --show-limits flag is intercepted by hive-telegram-bot and stripped from
 * the args before they are forwarded to /solve, /hive (or /task --split). When
 * set, the bot:
 *   1. Fetches usage limits for the selected tool (Claude or Codex) using the
 *      shared cached helpers in limits.lib.mjs (TTL: 20 minutes for the usage
 *      API to avoid rate limiting).
 *   2. Embeds a compact "Limits at start" snapshot below the infoBlock so the
 *      starting/executing message shows the user how much budget they had at
 *      the moment the command was queued.
 *   3. Captures the snapshot in the per-session record so the completion
 *      message can render an end-of-task snapshot plus a delta. The delta is
 *      not exact — multiple parallel sessions all consume from the same
 *      budget — and is reported as such.
 *
 * The flag is purely a Telegram bot concern; downstream commands never see it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/594
 */

const SHOW_LIMITS_FLAG = '--show-limits';
const NO_SHOW_LIMITS_FLAG = '--no-show-limits';

/**
 * Detect whether the user passed --show-limits (or --no-show-limits to opt out)
 * and return a copy of the args without that flag.
 *
 * Last occurrence wins, matching how yargs resolves repeated boolean flags.
 *
 * @param {string[]} args
 * @returns {{ showLimits: boolean|null, args: string[] }}
 *   `showLimits` is `true`/`false` when explicitly set, or `null` when absent.
 */
export function extractShowLimitsFlag(args) {
  if (!Array.isArray(args)) return { showLimits: null, args: args || [] };
  let showLimits = null;
  const filtered = [];
  for (const arg of args) {
    if (arg === SHOW_LIMITS_FLAG) {
      showLimits = true;
      continue;
    }
    if (arg === NO_SHOW_LIMITS_FLAG) {
      showLimits = false;
      continue;
    }
    if (arg === '--show-limits=true' || arg === '--show-limits=1') {
      showLimits = true;
      continue;
    }
    if (arg === '--show-limits=false' || arg === '--show-limits=0') {
      showLimits = false;
      continue;
    }
    filtered.push(arg);
  }
  return { showLimits, args: filtered };
}

/**
 * Pick a tool key for limits selection. Codex-like tools route to Codex, the
 * rest of the supported tools (claude, opencode, agent, gemini, qwen) route to
 * Claude. This mirrors how solve.mjs selects which CLI to invoke.
 *
 * @param {string|null|undefined} tool
 * @returns {'codex'|'claude'}
 */
export function pickLimitsToolKey(tool) {
  return String(tool || '').toLowerCase() === 'codex' ? 'codex' : 'claude';
}

/**
 * Fetch the cached limits snapshot for the given tool. Returns a normalized
 * shape that captures both the raw `success/usage/error` payload and a
 * `toolKey` so the renderers know which formatter to use.
 *
 * @param {Object} options
 * @param {string} [options.tool='claude']
 * @param {boolean} [options.verbose=false]
 * @param {{ getCachedClaudeLimits: Function, getCachedCodexLimits: Function }} options.limitsLib
 * @returns {Promise<{ toolKey: 'codex'|'claude', success: boolean, usage?: any, error?: string, capturedAt: Date, additionalRateLimits?: any[], credits?: any, planType?: any }>}
 */
export async function captureLimitsSnapshot({ tool = 'claude', verbose = false, limitsLib } = {}) {
  if (!limitsLib) throw new Error('captureLimitsSnapshot requires limitsLib');
  const toolKey = pickLimitsToolKey(tool);
  const fetcher = toolKey === 'codex' ? limitsLib.getCachedCodexLimits : limitsLib.getCachedClaudeLimits;
  const result = await fetcher(verbose);
  return {
    toolKey,
    success: !!result?.success,
    usage: result?.usage || null,
    error: result?.success ? null : result?.error || 'Unknown error',
    capturedAt: new Date(),
    additionalRateLimits: result?.additionalRateLimits || null,
    credits: result?.credits || null,
    planType: result?.planType || null,
  };
}

function pct(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.floor(num);
}

function formatPercentage(value) {
  const p = pct(value);
  return p === null ? 'N/A' : `${p}%`;
}

/**
 * Render a compact one-line-per-window summary of a Claude snapshot.
 * The compact form is used inside a Markdown code block under the infoBlock.
 *
 * @param {Object} snapshot - Result of captureLimitsSnapshot for tool=claude
 * @returns {string}
 */
function formatClaudeSnapshotCompact(snapshot) {
  if (!snapshot) return 'Claude limits: N/A';
  if (!snapshot.success) return `Claude limits: ${snapshot.error || 'unavailable'}`;
  const usage = snapshot.usage || {};
  const lines = [];
  lines.push(`5h session: ${formatPercentage(usage.currentSession?.percentage)}`);
  lines.push(`7d all models: ${formatPercentage(usage.allModels?.percentage)}`);
  if (usage.sonnetOnly && usage.sonnetOnly.percentage !== null && usage.sonnetOnly.percentage !== undefined) {
    lines.push(`7d Sonnet only: ${formatPercentage(usage.sonnetOnly.percentage)}`);
  }
  return lines.join('\n');
}

function formatCodexSnapshotCompact(snapshot) {
  if (!snapshot) return 'Codex limits: N/A';
  if (!snapshot.success) return `Codex limits: ${snapshot.error || 'unavailable'}`;
  const usage = snapshot.usage || {};
  const lines = [];
  lines.push(`5h session: ${formatPercentage(usage.currentSession?.percentage)}`);
  lines.push(`Weekly: ${formatPercentage(usage.allModels?.percentage)}`);
  return lines.join('\n');
}

/**
 * Format a snapshot as a fenced code block suitable for prepending/appending
 * inside the info block of a Telegram message.
 *
 * @param {Object} snapshot
 * @param {Object} [options]
 * @param {string} [options.title='📊 Limits at start'] Block title
 * @returns {string}
 */
export function formatLimitsSnapshotBlock(snapshot, { title = '📊 Limits at start' } = {}) {
  if (!snapshot) return '';
  const heading = snapshot.toolKey === 'codex' ? 'Codex' : 'Claude';
  const body = snapshot.toolKey === 'codex' ? formatCodexSnapshotCompact(snapshot) : formatClaudeSnapshotCompact(snapshot);
  return `${title} (${heading})\n\`\`\`\n${body}\n\`\`\``;
}

function deltaFor(startPct, endPct) {
  const s = pct(startPct);
  const e = pct(endPct);
  if (s === null || e === null) return null;
  return e - s;
}

function formatDeltaValue(delta) {
  if (delta === null || delta === undefined) return 'N/A';
  if (delta === 0) return '±0%';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta}%`;
}

/**
 * Format a "Limits change" block summarizing start, end, and delta for the
 * configured windows. Includes a disclaimer about parallel sessions.
 *
 * @param {Object|null} startSnapshot
 * @param {Object|null} endSnapshot
 * @returns {string}
 */
export function formatLimitsDeltaBlock(startSnapshot, endSnapshot) {
  if (!startSnapshot || !endSnapshot) return '';
  if (startSnapshot.toolKey !== endSnapshot.toolKey) return '';
  const heading = startSnapshot.toolKey === 'codex' ? 'Codex' : 'Claude';
  const lines = [];

  if (!startSnapshot.success && !endSnapshot.success) {
    lines.push(`Start: ${startSnapshot.error || 'unavailable'}`);
    lines.push(`End: ${endSnapshot.error || 'unavailable'}`);
  } else {
    const startUsage = startSnapshot.usage || {};
    const endUsage = endSnapshot.usage || {};

    const sessionLabel = '5h session';
    lines.push(`${sessionLabel}: ${formatPercentage(startUsage.currentSession?.percentage)} → ${formatPercentage(endUsage.currentSession?.percentage)} (${formatDeltaValue(deltaFor(startUsage.currentSession?.percentage, endUsage.currentSession?.percentage))})`);

    const allModelsLabel = startSnapshot.toolKey === 'codex' ? 'Weekly' : '7d all models';
    lines.push(`${allModelsLabel}: ${formatPercentage(startUsage.allModels?.percentage)} → ${formatPercentage(endUsage.allModels?.percentage)} (${formatDeltaValue(deltaFor(startUsage.allModels?.percentage, endUsage.allModels?.percentage))})`);

    if (startSnapshot.toolKey === 'claude' && ((startUsage.sonnetOnly && startUsage.sonnetOnly.percentage !== null && startUsage.sonnetOnly.percentage !== undefined) || (endUsage.sonnetOnly && endUsage.sonnetOnly.percentage !== null && endUsage.sonnetOnly.percentage !== undefined))) {
      lines.push(`7d Sonnet only: ${formatPercentage(startUsage.sonnetOnly?.percentage)} → ${formatPercentage(endUsage.sonnetOnly?.percentage)} (${formatDeltaValue(deltaFor(startUsage.sonnetOnly?.percentage, endUsage.sonnetOnly?.percentage))})`);
    }
  }

  // Note: delta is not precise because multiple parallel tasks may consume
  // from the same Anthropic/OpenAI budget windows during the run.
  lines.push('Note: delta is approximate (parallel sessions share the same budget).');

  return `📊 Limits change (${heading})\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

/**
 * Append a free-form section (e.g. limits block) to an existing infoBlock,
 * preserving Markdown structure. A blank line separates sections so the
 * Telegram message stays readable.
 *
 * @param {string} infoBlock
 * @param {string} addition
 * @returns {string}
 */
export function appendInfoSection(infoBlock, addition) {
  const base = infoBlock || '';
  const extra = addition || '';
  if (!extra) return base;
  if (!base) return extra;
  return `${base}\n\n${extra}`;
}

/**
 * High-level helper used by /solve and /hive: parse `--show-limits` out of the
 * raw user args, decide whether the flag is honored (subject to the bot
 * administrator's TELEGRAM_SHOW_LIMITS toggle), and either reply with a
 * rejection message (returning {handled:true}) or hand back the stripped args
 * and a boolean for the caller to thread through.
 *
 * @param {Object} options
 * @param {Object} options.ctx - Telegraf context (used to reply on rejection)
 * @param {Function} options.safeReply - safeReply(ctx, text, opts)
 * @param {string[]} options.args - Raw user args before stripping
 * @param {boolean} options.enabled - Master switch (config.showLimits)
 * @returns {Promise<{ handled: boolean, args: string[], showLimits: boolean }>}
 */
export async function handleShowLimitsFlag({ ctx, safeReply, args, enabled }) {
  const { showLimits, args: stripped } = extractShowLimitsFlag(args);
  if (showLimits === true && !enabled) {
    await safeReply(ctx, '❌ `--show-limits` is disabled by the bot administrator.', { reply_to_message_id: ctx.message.message_id });
    return { handled: true, args: stripped, showLimits: false };
  }
  return { handled: false, args: stripped, showLimits: showLimits === true && enabled };
}

/**
 * Capture a "limits at start" snapshot for the given tool and append a
 * formatted block to `infoBlock`. Errors are logged via the optional
 * `verbose` flag and silently swallowed so a transient API failure does not
 * abort the user's command.
 *
 * @param {Object} options
 * @param {string} options.infoBlock - Existing infoBlock to append to
 * @param {string} [options.tool='claude']
 * @param {boolean} [options.verbose=false]
 * @param {Object} options.limitsLib - { getCachedClaudeLimits, getCachedCodexLimits }
 * @param {string} [options.commandLabel='command'] - For verbose logging
 * @returns {Promise<{ infoBlock: string, limitsAtStart: Object|null }>}
 */
export async function captureStartSnapshotAndAppend({ infoBlock, tool = 'claude', verbose = false, limitsLib, commandLabel = 'command' } = {}) {
  let limitsAtStart = null;
  let nextInfoBlock = infoBlock || '';
  try {
    limitsAtStart = await captureLimitsSnapshot({ tool, verbose, limitsLib });
    const block = formatLimitsSnapshotBlock(limitsAtStart, { title: '📊 Limits at start' });
    if (block) nextInfoBlock = appendInfoSection(nextInfoBlock, block);
  } catch (e) {
    if (verbose) console.log(`[VERBOSE] ${commandLabel} --show-limits snapshot failed: ${e?.message || e}`);
  }
  return { infoBlock: nextInfoBlock, limitsAtStart };
}

export const SHOW_LIMITS_FLAG_NAME = SHOW_LIMITS_FLAG;
export const NO_SHOW_LIMITS_FLAG_NAME = NO_SHOW_LIMITS_FLAG;
