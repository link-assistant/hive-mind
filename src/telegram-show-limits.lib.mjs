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

import { lt, resolveLimitLocale } from './limits-i18n.lib.mjs';

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

function formatPercentage(value, locale = null) {
  const p = pct(value);
  return p === null ? lt('na', {}, { locale }) : `${p}%`;
}

/**
 * Render a compact one-line-per-window summary of a Claude snapshot.
 * The compact form is used inside a Markdown code block under the infoBlock.
 *
 * @param {Object} snapshot - Result of captureLimitsSnapshot for tool=claude
 * @returns {string}
 */
function formatClaudeSnapshotCompact(snapshot, options = {}) {
  const locale = resolveLimitLocale(options);
  if (!snapshot) return `${lt('claude_limits', {}, { locale })}: ${lt('na', {}, { locale })}`;
  if (!snapshot.success) return `${lt('claude_limits', {}, { locale })}: ${snapshot.error || lt('unavailable', {}, { locale })}`;
  const usage = snapshot.usage || {};
  const lines = [];
  lines.push(`${lt('five_hour_session', {}, { locale })}: ${formatPercentage(usage.currentSession?.percentage, locale)}`);
  lines.push(`${lt('seven_day_all_models', {}, { locale })}: ${formatPercentage(usage.allModels?.percentage, locale)}`);
  if (usage.sonnetOnly && usage.sonnetOnly.percentage !== null && usage.sonnetOnly.percentage !== undefined) {
    lines.push(`${lt('seven_day_sonnet_only', {}, { locale })}: ${formatPercentage(usage.sonnetOnly.percentage, locale)}`);
  }
  return lines.join('\n');
}

function formatCodexSnapshotCompact(snapshot, options = {}) {
  const locale = resolveLimitLocale(options);
  if (!snapshot) return `${lt('codex_limits', {}, { locale })}: ${lt('na', {}, { locale })}`;
  if (!snapshot.success) return `${lt('codex_limits', {}, { locale })}: ${snapshot.error || lt('unavailable', {}, { locale })}`;
  const usage = snapshot.usage || {};
  const lines = [];
  lines.push(`${lt('five_hour_session', {}, { locale })}: ${formatPercentage(usage.currentSession?.percentage, locale)}`);
  lines.push(`${lt('weekly', {}, { locale })}: ${formatPercentage(usage.allModels?.percentage, locale)}`);
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
export function formatLimitsSnapshotBlock(snapshot, { title = null, locale = null } = {}) {
  if (!snapshot) return '';
  const heading = snapshot.toolKey === 'codex' ? 'Codex' : 'Claude';
  const localizedTitle = title || `📊 ${lt('limits_at_start', {}, { locale })}`;
  const body = snapshot.toolKey === 'codex' ? formatCodexSnapshotCompact(snapshot, { locale }) : formatClaudeSnapshotCompact(snapshot, { locale });
  return `${localizedTitle} (${heading})\n\`\`\`\n${body}\n\`\`\``;
}

function deltaFor(startPct, endPct) {
  const s = pct(startPct);
  const e = pct(endPct);
  if (s === null || e === null) return null;
  return e - s;
}

function formatDeltaValue(delta, locale = null) {
  if (delta === null || delta === undefined) return lt('na', {}, { locale });
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
 * @param {Object|string} [options]
 * @returns {string}
 */
export function formatLimitsDeltaBlock(startSnapshot, endSnapshot, options = {}) {
  if (!startSnapshot || !endSnapshot) return '';
  if (startSnapshot.toolKey !== endSnapshot.toolKey) return '';
  const locale = resolveLimitLocale(options);
  const heading = startSnapshot.toolKey === 'codex' ? 'Codex' : 'Claude';
  const lines = [];

  if (!startSnapshot.success && !endSnapshot.success) {
    lines.push(`${lt('start', {}, { locale })}: ${startSnapshot.error || lt('unavailable', {}, { locale })}`);
    lines.push(`${lt('end', {}, { locale })}: ${endSnapshot.error || lt('unavailable', {}, { locale })}`);
  } else {
    const startUsage = startSnapshot.usage || {};
    const endUsage = endSnapshot.usage || {};

    const sessionLabel = lt('five_hour_session', {}, { locale });
    lines.push(`${sessionLabel}: ${formatPercentage(startUsage.currentSession?.percentage, locale)} → ${formatPercentage(endUsage.currentSession?.percentage, locale)} (${formatDeltaValue(deltaFor(startUsage.currentSession?.percentage, endUsage.currentSession?.percentage), locale)})`);

    const allModelsLabel = startSnapshot.toolKey === 'codex' ? lt('weekly', {}, { locale }) : lt('seven_day_all_models', {}, { locale });
    lines.push(`${allModelsLabel}: ${formatPercentage(startUsage.allModels?.percentage, locale)} → ${formatPercentage(endUsage.allModels?.percentage, locale)} (${formatDeltaValue(deltaFor(startUsage.allModels?.percentage, endUsage.allModels?.percentage), locale)})`);

    if (startSnapshot.toolKey === 'claude' && ((startUsage.sonnetOnly && startUsage.sonnetOnly.percentage !== null && startUsage.sonnetOnly.percentage !== undefined) || (endUsage.sonnetOnly && endUsage.sonnetOnly.percentage !== null && endUsage.sonnetOnly.percentage !== undefined))) {
      lines.push(`${lt('seven_day_sonnet_only', {}, { locale })}: ${formatPercentage(startUsage.sonnetOnly?.percentage, locale)} → ${formatPercentage(endUsage.sonnetOnly?.percentage, locale)} (${formatDeltaValue(deltaFor(startUsage.sonnetOnly?.percentage, endUsage.sonnetOnly?.percentage), locale)})`);
    }
  }

  // Note: delta is not precise because multiple parallel tasks may consume
  // from the same Anthropic/OpenAI budget windows during the run.
  lines.push(lt('note_delta_approx', {}, { locale }));

  return `📊 ${lt('limits_change', {}, { locale })} (${heading})\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
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
export async function handleShowLimitsFlag({ ctx, safeReply, args, enabled, locale = null }) {
  const { showLimits, args: stripped } = extractShowLimitsFlag(args);
  if (showLimits === true && !enabled) {
    await safeReply(ctx, `❌ ${lt('disabled_by_admin', {}, { locale })}`, { reply_to_message_id: ctx.message.message_id });
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
export async function captureStartSnapshotAndAppend({ infoBlock, tool = 'claude', verbose = false, limitsLib, commandLabel = 'command', locale = null } = {}) {
  let limitsAtStart = null;
  let nextInfoBlock = infoBlock || '';
  try {
    limitsAtStart = await captureLimitsSnapshot({ tool, verbose, limitsLib });
    const block = formatLimitsSnapshotBlock(limitsAtStart, { locale });
    if (block) nextInfoBlock = appendInfoSection(nextInfoBlock, block);
  } catch (e) {
    if (verbose) console.log(`[VERBOSE] ${commandLabel} --show-limits snapshot failed: ${e?.message || e}`);
  }
  return { infoBlock: nextInfoBlock, limitsAtStart };
}

export const SHOW_LIMITS_FLAG_NAME = SHOW_LIMITS_FLAG;
export const NO_SHOW_LIMITS_FLAG_NAME = NO_SHOW_LIMITS_FLAG;
