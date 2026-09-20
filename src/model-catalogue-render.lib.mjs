/**
 * Rendering for the merged model catalogue (issue #2202, R5).
 *
 * R5 asks that `/models` show "list of merged models (from fully supported, to
 * hot loaded)… which models are loaded live, and available for use with all our
 * tools, and which models are included with Hive Mind installation". Those are
 * the three groups `mergeModelCatalogue` produces, and this module is the only
 * place that decides how they look — so the CLI and the Telegram command cannot
 * drift apart, and both can be tested without a network.
 *
 * Pure formatting: no I/O, no imports beyond the source table it labels with.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import { getModelCatalogueSource } from './model-catalogue-sources.lib.mjs';

/** Telegram refuses a message over 4096 characters; leave room for the footer. */
export const TELEGRAM_MESSAGE_BUDGET = 3600;

export const GROUP_TITLES = Object.freeze({
  bundledAndLive: { title: 'Bundled and live', note: 'shipped with this installation and confirmed reachable now' },
  liveOnly: { title: 'Hot loaded', note: 'a live source has them, this installation does not — use with --model at your own risk' },
  bundledOnly: { title: 'Bundled only', note: 'shipped, but no live source confirmed them' },
});

/**
 * With hot load off there is nothing to compare against, so "no live source
 * confirmed them" would be an accusation rather than a fact.
 */
export const groupHeading = (key, { hotLoad = true } = {}) => (!hotLoad && key === 'bundledOnly' ? { title: 'Bundled', note: 'shipped with this installation; live sources were not consulted' } : GROUP_TITLES[key]);

/** "2 minutes", "1 hour" — a duration a person reads rather than parses. */
export const formatAge = ms => {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

/** 200000 → "200K", 1000000 → "1M". Context windows are quoted, not computed. */
export const formatTokenCount = value => {
  const tokens = Number(value);
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  if (tokens >= 1_000_000) return `${Math.round((tokens / 1_000_000) * 10) / 10}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
};

/**
 * The R8 technical detail line for one model.
 *
 * Whatever the sources actually carried, in a fixed order, and nothing when
 * they carried nothing — an invented number is worse than a blank.
 */
export const formatModelSpec = (model = {}) => {
  const spec = model.spec ?? {};
  const parts = [];
  const context = formatTokenCount(model.contextWindow ?? spec?.limit?.context);
  if (context) parts.push(`${context} ctx`);
  const output = formatTokenCount(model.maxOutput ?? spec?.limit?.output);
  if (output) parts.push(`${output} out`);
  const input = spec?.cost?.input;
  const outputCost = spec?.cost?.output;
  if (Number.isFinite(Number(input)) && Number.isFinite(Number(outputCost))) parts.push(`$${input}/$${outputCost} per Mtok`);
  if (spec?.reasoning === true) parts.push('reasoning');
  if (Array.isArray(spec?.modalities?.input) && spec.modalities.input.length > 1) parts.push(spec.modalities.input.join('+'));
  if (spec?.release_date) parts.push(String(spec.release_date));
  return parts.join(' · ');
};

/** Source ids as a reader-facing list: `router, anthropic-api` → their labels. */
export const formatModelSources = (model = {}) =>
  (model.sources ?? [])
    .map(id => getModelCatalogueSource(id)?.label ?? id)
    .filter(Boolean)
    .join(', ');

/** One line per source: what it said, and how old the answer is. */
export const describeCatalogueSources = (catalogue = {}) =>
  (catalogue.sources ?? []).map(source => {
    // A metadata source contributes specifications, not names, so counting its
    // models would always print "0" and read like a failure.
    const okDetail = source.kind === 'metadata' ? `specifications for ${Object.keys(source.meta?.metadata ?? {}).length} model(s)` : `${source.models?.length ?? 0} model(s)`;
    const detail = source.status === 'ok' ? okDetail : source.error || source.status;
    const age = source.cached ? ` · cached ${formatAge(source.ageMs)}` : '';
    const stale = source.stale ? ' · stale' : '';
    return { id: source.id, label: source.label ?? source.id, status: source.status, text: `${source.label ?? source.id}: ${source.status} — ${detail}${age}${stale}` };
  });

const modelLine = (model, { details = false } = {}) => {
  const columns = [model.id];
  if (model.aliases?.length > 0) columns.push(`(${model.aliases.join(', ')})`);
  if (model.label && model.label !== model.id) columns.push(`— ${model.label}`);
  const spec = details ? formatModelSpec(model) : '';
  if (spec) columns.push(`[${spec}]`);
  const sources = details ? formatModelSources(model) : '';
  if (sources) columns.push(`via ${sources}`);
  return columns.join(' ');
};

/**
 * The plain-text rendering used by `hive-models`.
 *
 * @param {object} merged result of `mergeModelCatalogue`, with `.catalogue`
 * @param {object} options `details` adds the R8 specification columns
 */
export const formatModelCatalogueText = (merged = {}, { details = false, defaultModel = null } = {}) => {
  const catalogue = merged.catalogue ?? {};
  const lines = [];
  lines.push(`Models for ${merged.tool}${merged.default ? ` (default: ${merged.default})` : ''}`);
  lines.push(`${merged.counts?.bundledAndLive ?? 0} bundled and live · ${merged.counts?.liveOnly ?? 0} hot loaded · ${merged.counts?.bundledOnly ?? 0} bundled only`);

  for (const key of ['bundledAndLive', 'liveOnly', 'bundledOnly']) {
    const group = merged[key] ?? [];
    if (group.length === 0) continue;
    lines.push('');
    const heading = groupHeading(key, { hotLoad: catalogue.hotLoad !== false });
    lines.push(`${heading.title} (${group.length}) — ${heading.note}`);
    for (const model of group) {
      const marker = defaultModel && (model.id === defaultModel || model.aliases?.includes(defaultModel)) ? '*' : ' ';
      lines.push(`  ${marker} ${modelLine(model, { details })}`);
    }
  }

  const sources = describeCatalogueSources(catalogue);
  if (sources.length > 0) {
    lines.push('');
    lines.push('Sources, in the order they are trusted:');
    for (const source of sources) lines.push(`  - ${source.text}`);
  }
  // Only when the router never became a source line of its own; otherwise this
  // repeats what the list above already said.
  const routerReported = (catalogue.sources ?? []).some(source => source.id === 'router');
  if (!routerReported && catalogue.router && !catalogue.router.available && catalogue.router.reason) lines.push(`  - router: not read — ${catalogue.router.reason}`);
  lines.push('');
  lines.push(`Live answers are cached for ${formatAge(catalogue.ttlMs ?? 0)}; pass --refresh to ignore the cache.`);
  if (catalogue.hotLoad === false) lines.push('Hot load is disabled (HIVE_MIND_MODELS_HOT_LOAD), so only the bundled catalogue was consulted.');
  return lines.join('\n');
};

/**
 * The Telegram rendering.
 *
 * Same content, but budgeted: a full catalogue is far longer than one message,
 * so each group is truncated with an explicit "and N more" rather than being
 * silently cut by the API.
 */
export const formatModelCatalogueTelegram = (merged = {}, { details = false, budget = TELEGRAM_MESSAGE_BUDGET, perGroupLimit = 40 } = {}) => {
  const catalogue = merged.catalogue ?? {};
  const lines = [];
  lines.push(`🧠 *Models for ${merged.tool}*${merged.default ? ` — default \`${merged.default}\`` : ''}`);
  lines.push(`${merged.counts?.bundledAndLive ?? 0} bundled and live · ${merged.counts?.liveOnly ?? 0} hot loaded · ${merged.counts?.bundledOnly ?? 0} bundled only`);

  for (const key of ['bundledAndLive', 'liveOnly', 'bundledOnly']) {
    const group = merged[key] ?? [];
    if (group.length === 0) continue;
    lines.push('');
    const heading = groupHeading(key, { hotLoad: catalogue.hotLoad !== false });
    lines.push(`*${heading.title}* (${group.length}) — _${heading.note}_`);
    for (const model of group.slice(0, perGroupLimit)) lines.push(`• \`${model.id}\`${details && formatModelSpec(model) ? ` — ${formatModelSpec(model)}` : ''}`);
    if (group.length > perGroupLimit) lines.push(`… and ${group.length - perGroupLimit} more`);
  }

  lines.push('');
  const sources = describeCatalogueSources(catalogue);
  lines.push(`Sources: ${sources.map(source => `${source.label} (${source.status})`).join(' · ') || 'none'}`);
  lines.push(`Cached for ${formatAge(catalogue.ttlMs ?? 0)}; \`/models --refresh\` re-reads them.`);

  const text = lines.join('\n');
  if (text.length <= budget) return text;
  // Trim whole lines from the model listings rather than cutting mid-token, and
  // keep the footer, which is the part that explains what was left out.
  const footer = lines.slice(-3).join('\n');
  const head = [];
  let used = footer.length + 24;
  for (const line of lines.slice(0, -3)) {
    if (used + line.length + 1 > budget) {
      head.push('… list truncated; run `hive-models` for the full catalogue');
      break;
    }
    head.push(line);
    used += line.length + 1;
  }
  return `${head.join('\n')}\n\n${footer}`;
};

export default { GROUP_TITLES, groupHeading, TELEGRAM_MESSAGE_BUDGET, describeCatalogueSources, formatAge, formatModelCatalogueTelegram, formatModelCatalogueText, formatModelSources, formatModelSpec, formatTokenCount };
