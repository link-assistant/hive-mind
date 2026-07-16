#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

/**
 * Escalate-mode module for solve.mjs
 *
 * [EXPERIMENTAL] `--escalate` makes the solver try to solve a task fast and
 * cheap first (with a lower-tier model), and only escalate to a more capable
 * (and more expensive) model when the cheaper model did not finish the job.
 *
 * The intuition (from issue #1885): small models often get *most* of the work
 * right, but not quite right. By iterating cheaply first, the more expensive
 * models spend their budget reading and refining an existing draft rather than
 * writing everything from scratch.
 *
 * Model ladder (Claude), cheapest → most capable:
 *
 *     haiku  →  sonnet  →  opus  →  fable
 *
 * Options:
 *   --escalate [lower-upper]   Enable escalate mode. Bare flag means the default
 *                              range `sonnet-fable`. `sonnet-opus` sets the lower
 *                              and upper bound (delimiter is `-`). A single name
 *                              (e.g. `opus`) means just that one tier.
 *   --escalate-from <model>    Shortcut for `--escalate <model>-fable` (escalate
 *                              from <model> up to the top of the ladder).
 *   --escalate-steps <n>       How many working sessions to keep each tier before
 *                              escalating to the next one (default: 1). For
 *                              example `2` keeps the lower tier for two working
 *                              sessions, then the next tier for two, and so on.
 *
 * The pure parsing/planning helpers in this module are network-free so they can
 * be unit-tested in isolation. The `runEscalation` orchestrator restarts the AI
 * tool with the escalated model, reusing the same deferred-work detection that
 * powers `--keep-working-until-all-requirements-are-fully-done` (issue #1883) as
 * the "did the cheaper model finish?" signal.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1885
 */

// ───────────────────────────── Pure helpers ──────────────────────────────────
// Everything above the `runEscalation` orchestrator is pure (no I/O, no network)
// so it can be imported and unit-tested without side effects.

/**
 * Ordered Claude model ladder used by escalate mode, cheapest → most capable.
 * These are the short canonical tier names; aliases (e.g. `opus-4-8`,
 * `claude-fable-5`) are normalized to these by {@link canonicalTier}.
 */
export const MODEL_ESCALATION_ORDER = ['haiku', 'sonnet', 'opus', 'fable'];

/** Default lower bound when `--escalate` is given without an explicit range. */
export const DEFAULT_ESCALATE_LOWER = 'sonnet';

/** Default upper bound (top of the ladder). */
export const DEFAULT_ESCALATE_UPPER = 'fable';

/** Default range used when `--escalate` is given as a bare flag. */
export const DEFAULT_ESCALATE_RANGE = `${DEFAULT_ESCALATE_LOWER}-${DEFAULT_ESCALATE_UPPER}`;

/** Default number of working sessions to keep each tier before escalating. */
export const DEFAULT_ESCALATE_STEPS = 1;

/**
 * Mapping of known model aliases → canonical tier name. Lets users pass either
 * the short tier name (`opus`) or a more specific alias (`opus-4-8`,
 * `claude-opus-4-8`) wherever a single model is accepted (e.g. --escalate-from).
 */
const TIER_ALIASES = {
  haiku: 'haiku',
  'haiku-4-5': 'haiku',
  'claude-haiku-4-5': 'haiku',
  'claude-haiku-4-5-20251001': 'haiku',
  sonnet: 'sonnet',
  'sonnet-5': 'sonnet',
  'sonnet-4-6': 'sonnet',
  'sonnet-4-5': 'sonnet',
  'claude-sonnet-5': 'sonnet',
  'claude-sonnet-4-6': 'sonnet',
  'claude-sonnet-4-5': 'sonnet',
  opus: 'opus',
  'opus-4-8': 'opus',
  'opus-4-7': 'opus',
  'opus-4-6': 'opus',
  'opus-4-5': 'opus',
  'claude-opus-4-8': 'opus',
  'claude-opus-4-7': 'opus',
  fable: 'fable',
  'fable-5': 'fable',
  'claude-fable-5': 'fable',
};

/**
 * Normalize a model name/alias to its canonical escalate-ladder tier.
 * @param {string} name
 * @returns {string|null} canonical tier name, or null if not a known tier.
 */
export const canonicalTier = name => {
  if (typeof name !== 'string') return null;
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return TIER_ALIASES[key] || null;
};

/**
 * Parse a `--escalate` range value into { from, to } canonical tier names.
 *
 * Accepted forms:
 *   - true / '' / undefined  → the default range (`sonnet-fable`)
 *   - `sonnet`               → { from: 'sonnet', to: 'sonnet' }
 *   - `sonnet-fable`         → { from: 'sonnet', to: 'fable' }
 *
 * The delimiter is `-`. Only the short ladder names (haiku|sonnet|opus|fable)
 * are accepted inside a range to avoid ambiguity with dashed aliases such as
 * `opus-4-8` (use --escalate-from for those).
 *
 * @param {string|boolean|undefined} value
 * @returns {{ from: string, to: string }}
 * @throws {Error} on an unparseable / invalid range.
 */
export const parseEscalateRange = value => {
  let raw = value;
  if (raw === true || raw === undefined || raw === null) {
    raw = DEFAULT_ESCALATE_RANGE;
  }
  if (typeof raw !== 'string') {
    throw new Error(`Invalid --escalate value: ${JSON.stringify(value)}. Expected a model range like "sonnet-fable".`);
  }
  const trimmed = raw.trim().toLowerCase();
  const parts = (trimmed === '' ? DEFAULT_ESCALATE_RANGE : trimmed).split('-');

  const order = MODEL_ESCALATION_ORDER;
  const requireLadderName = part => {
    if (!order.includes(part)) {
      throw new Error(`Invalid --escalate model "${part}". Expected one of: ${order.join(', ')} (range form: "${DEFAULT_ESCALATE_RANGE}").`);
    }
    return part;
  };

  let from;
  let to;
  if (parts.length === 1) {
    from = requireLadderName(parts[0]);
    to = from;
  } else if (parts.length === 2) {
    from = requireLadderName(parts[0]);
    to = requireLadderName(parts[1]);
  } else {
    throw new Error(`Invalid --escalate range "${trimmed}". Expected "<lower>-<upper>" with short model names (e.g. "${DEFAULT_ESCALATE_RANGE}").`);
  }

  if (order.indexOf(from) > order.indexOf(to)) {
    throw new Error(`Invalid --escalate range "${trimmed}": lower bound "${from}" is more capable than upper bound "${to}". Order is ${order.join(' < ')}.`);
  }

  return { from, to };
};

/**
 * Parse a `--escalate-from` value into { from, to } where `to` is the top of
 * the ladder. Accepts canonical names and aliases (e.g. `opus-4-8`).
 * @param {string} value
 * @returns {{ from: string, to: string }}
 * @throws {Error} on an invalid model name.
 */
export const parseEscalateFrom = value => {
  const from = canonicalTier(value);
  if (!from) {
    throw new Error(`Invalid --escalate-from model ${JSON.stringify(value)}. Expected one of: ${MODEL_ESCALATION_ORDER.join(', ')}.`);
  }
  return { from, to: DEFAULT_ESCALATE_UPPER };
};

/**
 * Normalize the `--escalate-steps` value into a positive integer (default 1).
 * @param {string|number|undefined} value
 * @returns {number}
 * @throws {Error} on a non-positive / non-numeric value.
 */
export const normalizeEscalateSteps = value => {
  if (value === undefined || value === null || value === true || value === '') {
    return DEFAULT_ESCALATE_STEPS;
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid --escalate-steps value: ${JSON.stringify(value)}. Expected a positive integer (>= 1).`);
  }
  return n;
};

/**
 * Build the ordered list of models (the "escalation plan"), where each tier
 * between `from` and `to` (inclusive) is repeated `steps` times.
 *
 * Example: { from: 'sonnet', to: 'fable', steps: 2 } →
 *   ['sonnet', 'sonnet', 'opus', 'opus', 'fable', 'fable']
 *
 * @param {{ from: string, to: string, steps?: number }} params
 * @returns {string[]}
 */
export const buildEscalationPlan = ({ from, to, steps = DEFAULT_ESCALATE_STEPS }) => {
  const order = MODEL_ESCALATION_ORDER;
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx === -1 || toIdx === -1 || fromIdx > toIdx) {
    throw new Error(`Invalid escalation bounds: from="${from}", to="${to}".`);
  }
  const tiers = order.slice(fromIdx, toIdx + 1);
  const plan = [];
  for (const tier of tiers) {
    for (let i = 0; i < steps; i++) {
      plan.push(tier);
    }
  }
  return plan;
};

/**
 * Resolve the model to use for a given 0-based working-session index. Indexes
 * past the end of the plan clamp to the last (most capable) model so the loop
 * never reaches outside the ladder.
 * @param {string[]} plan
 * @param {number} sessionIndex
 * @returns {string}
 */
export const resolveEscalationModel = (plan, sessionIndex) => {
  if (!Array.isArray(plan) || plan.length === 0) return undefined;
  const idx = Math.max(0, Math.min(sessionIndex, plan.length - 1));
  return plan[idx];
};

/**
 * Whether escalate mode is enabled given parsed argv.
 * @param {object} argv
 * @returns {boolean}
 */
export const isEscalateEnabled = argv => {
  if (!argv) return false;
  return Boolean(argv.escalate) || Boolean(argv.escalateFrom);
};

/**
 * Resolve the full escalation configuration from argv. Returns null when the
 * feature is disabled.
 *
 * `--escalate-from` takes precedence over `--escalate` when both are given.
 *
 * @param {object} argv
 * @returns {{ enabled: boolean, from: string, to: string, steps: number, plan: string[] }|null}
 */
export const resolveEscalationConfig = argv => {
  if (!isEscalateEnabled(argv)) return null;
  const { from, to } = argv.escalateFrom ? parseEscalateFrom(argv.escalateFrom) : parseEscalateRange(argv.escalate);
  const steps = normalizeEscalateSteps(argv.escalateSteps);
  const plan = buildEscalationPlan({ from, to, steps });
  return { enabled: true, from, to, steps, plan };
};

/**
 * Human-readable one-line description of an escalation plan, collapsing
 * consecutive repeats into "model×N".
 * @param {string[]} plan
 * @returns {string}
 */
export const formatEscalationPlan = plan => {
  if (!Array.isArray(plan) || plan.length === 0) return '(empty)';
  const groups = [];
  for (const model of plan) {
    const last = groups[groups.length - 1];
    if (last && last.model === model) {
      last.count++;
    } else {
      groups.push({ model, count: 1 });
    }
  }
  return groups.map(({ model, count }) => (count > 1 ? `${model}×${count}` : model)).join(' → ');
};

// ─────────────────────────── Orchestrator (I/O) ──────────────────────────────

// Lazy module bindings are set up inside runEscalation so that importing this
// module for its pure helpers (e.g. in tests) does not pull in command-stream,
// the network bootstrap, or other heavy dependencies.

/**
 * Runs escalate restart iterations after the main solve.
 *
 * The first regular solve session already ran with the lowest tier in the plan
 * (see the config-time model override in solve.config.lib.mjs), so escalation
 * continues from plan index 1 onward. Before each restart it re-scans for
 * deferred / unfinished work (the same detector used by keep-working). If no
 * unfinished-work indicators remain, the cheaper model is considered to have
 * succeeded and escalation stops early — we do not waste the more expensive
 * models.
 *
 * @param {object} params
 * @param {string} params.issueUrl
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string|number} params.issueNumber
 * @param {string|number} params.prNumber
 * @param {string} params.branchName
 * @param {string} params.tempDir
 * @param {string} [params.workspaceTmpDir]
 * @param {object} params.argv - CLI arguments
 * @param {function} params.cleanupClaudeFile - cleanup function
 * @param {string} [params.resultSummary] - AI solution summary from the last session
 * @returns {Promise<{sessionId, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo}|null>}
 */
export const runEscalation = async ({ issueUrl, owner, repo, issueNumber, prNumber, branchName, tempDir, workspaceTmpDir, argv, cleanupClaudeFile, resultSummary }) => {
  const config = resolveEscalationConfig(argv);
  if (!config || !prNumber) {
    return null;
  }

  // Import shared library functions lazily (network bootstrap lives here).
  const lib = await import('./lib.mjs');
  const { log, cleanErrorMessage } = lib;

  // Escalate mode only makes sense for the Claude model ladder. For other tools
  // we skip with a clear message rather than misusing the ladder names.
  const tool = argv.tool || 'claude';
  if (tool !== 'claude') {
    await log(`ℹ️  ESCALATE: --escalate is only supported with --tool claude (current tool: ${tool}). Skipping.`, { level: 'warning' });
    return null;
  }

  if (typeof globalThis.use === 'undefined') {
    await ensureUseM();
  }
  const use = globalThis.use;
  const { $: __rawDollar$ } = await use('command-stream');
  const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
  const $ = wrapDollarWithGhRetry(__rawDollar$);

  const restartShared = await import('./solve.restart-shared.lib.mjs');
  const { executeToolIteration, isApiError, isUsageLimitReached } = restartShared;

  const keepWorkingLib = await import('./solve.keep-working.lib.mjs');
  const { collectDeferredWorkSources } = keepWorkingLib;
  const detectLib = await import('./solve.keep-working.detect.lib.mjs');
  const { detectDeferredWorkInSources } = detectLib;

  const { resolveDefaultFallbackModel } = await import('./models/index.mjs');

  const sentryLib = await import('./sentry.lib.mjs');
  const { reportError } = sentryLib;

  const { plan } = config;

  await log('');
  await log(`🆙 ESCALATE: ${config.from} → ${config.to} (steps: ${config.steps} working session(s) per tier)`);
  await log(`   Plan: ${formatEscalationPlan(plan)}`);
  await log('   Strategy: solve cheaply first; escalate to a more capable model only while unfinished work remains.');
  await log('');

  // Get PR merge state status for the iterations
  let currentMergeStateStatus = null;
  try {
    // `$` is wrapped via wrapDollarWithGhRetry above; the lazy import keeps this module
    // network-free for tests, so the lint rule (which only detects top-level rebinds) can't see it.
    // eslint-disable-next-line gh-rate-limit/no-direct-gh-exec -- $ is rate-limit-safe (wrapDollarWithGhRetry), rebound lazily on line 334.
    const prStateResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.mergeStateStatus'`;
    if (prStateResult.code === 0) {
      currentMergeStateStatus = prStateResult.stdout.toString().trim();
    }
  } catch {
    // Ignore errors getting merge state
  }

  let sessionId;
  let anthropicTotalCostUSD;
  let publicPricingEstimate;
  let pricingInfo;
  let lastResultSummary = resultSummary;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;
  let restartsRun = 0;

  // The first regular solve session = plan index 0. Continue escalating from 1.
  for (let sessionIndex = 1; sessionIndex < plan.length; sessionIndex++) {
    const model = resolveEscalationModel(plan, sessionIndex);
    const previousModel = resolveEscalationModel(plan, sessionIndex - 1);

    // Decide whether the cheaper model already finished. Re-scan the PR
    // description, AI solution summary and changed markdown documents for
    // deferred/unfinished-work indicators (same signal as keep-working).
    let sources = [];
    try {
      sources = await collectDeferredWorkSources({ owner, repo, prNumber, resultSummary: lastResultSummary });
    } catch (error) {
      reportError(error, { context: 'escalate_collect_sources', owner, repo, prNumber, operation: 'collect_sources' });
      await log(`⚠️  ESCALATE: Could not collect sources to evaluate completion: ${cleanErrorMessage(error)}`, { level: 'warning' });
    }
    const detections = detectDeferredWorkInSources(sources);

    if (detections.length === 0) {
      await log(`✅ ESCALATE: No unfinished-work indicators after ${previousModel} session(s). Stopping before escalating to ${model}.`);
      break;
    }

    await log('');
    await log(`🆙 ESCALATE: ${detections.length} unfinished-work indicator(s) remain after ${previousModel}; escalating to ${model} (session ${sessionIndex + 1}/${plan.length}).`);
    for (const detection of detections.slice(0, 10)) {
      await log(`   • [${detection.label}] in ${detection.source}: "${detection.snippet}"`);
    }

    // Sync local branch with remote before each iteration (issue #1572 pattern).
    try {
      const pullResult = await $({ cwd: tempDir })`git pull origin ${branchName} 2>&1`;
      if (pullResult.code === 0) {
        await log(`   Synced local branch ${branchName} from remote`, { verbose: true });
      } else {
        await log(`   Warning: git pull failed (code ${pullResult.code}); continuing with local state`, { level: 'warning' });
      }
    } catch (error) {
      reportError(error, { context: 'escalate_git_pull', branchName, operation: 'git_pull' });
      await log(`   Warning: git pull error: ${cleanErrorMessage(error)}`, { level: 'warning' });
    }

    const feedbackLines = ['', '='.repeat(60), `🆙 ESCALATE MODE — now running on a more capable model (${model}):`, '='.repeat(60), '', `The previous working session(s) used "${previousModel}" but left unfinished work. You are a more capable model. Carefully review what has already been done, then finish every remaining requirement in this single pull request — do not defer, delay, or mark anything as out of scope. Ensure all changes are correct, consistent, validated, tested and that all CI/CD checks pass.`, ''];

    const fallbackModel = resolveDefaultFallbackModel(tool, model) || undefined;

    const iterationResult = await executeToolIteration({
      issueUrl,
      owner,
      repo,
      issueNumber,
      prNumber,
      branchName,
      tempDir,
      workspaceTmpDir,
      mergeStateStatus: currentMergeStateStatus,
      feedbackLines,
      argv: {
        ...argv,
        // Escalate to the next tier for this iteration.
        model,
        fallbackModel,
        // Reinforce the "finish everything now" guidance in the system prompt.
        promptEnsureAllRequirementsAreMet: true,
        // Prevent recursive escalation inside the restart iteration.
        escalate: undefined,
        escalateFrom: undefined,
      },
    });

    restartsRun++;

    if (iterationResult) {
      if (iterationResult.sessionId) sessionId = iterationResult.sessionId;
      if (iterationResult.anthropicTotalCostUSD) anthropicTotalCostUSD = iterationResult.anthropicTotalCostUSD;
      if (iterationResult.publicPricingEstimate) publicPricingEstimate = iterationResult.publicPricingEstimate;
      if (iterationResult.pricingInfo) pricingInfo = iterationResult.pricingInfo;
      if (iterationResult.result) lastResultSummary = iterationResult.result;
    }

    if (isUsageLimitReached(iterationResult)) {
      await log('🛑 ESCALATE: Usage limit reached during restart. Stopping escalate loop.');
      break;
    }
    if (isApiError(iterationResult)) {
      consecutiveErrors++;
      await log(`⚠️  ESCALATE: API error during ${model} restart (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} consecutive).`, { level: 'warning' });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        await log('🛑 ESCALATE: Too many consecutive errors. Stopping escalate loop.');
        break;
      }
    } else {
      consecutiveErrors = 0;
    }

    await log(`✅ ESCALATE: ${model} session complete (${sessionIndex + 1}/${plan.length})`);
    await log('');
  }

  // Clean up CLAUDE.md/.gitkeep after restarts
  try {
    await cleanupClaudeFile(tempDir, branchName, null, argv);
  } catch (error) {
    reportError(error, { context: 'escalate_cleanup', branchName, operation: 'cleanup_claude_file' });
  }

  if (restartsRun === 0) return null;
  return { sessionId, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo };
};

export default {
  MODEL_ESCALATION_ORDER,
  DEFAULT_ESCALATE_LOWER,
  DEFAULT_ESCALATE_UPPER,
  DEFAULT_ESCALATE_RANGE,
  DEFAULT_ESCALATE_STEPS,
  canonicalTier,
  parseEscalateRange,
  parseEscalateFrom,
  normalizeEscalateSteps,
  buildEscalationPlan,
  resolveEscalationModel,
  isEscalateEnabled,
  resolveEscalationConfig,
  formatEscalationPlan,
  runEscalation,
};
