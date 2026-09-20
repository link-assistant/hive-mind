/**
 * Which places a model list may come from, and the rule that keeps them free.
 *
 * Issue #2202 asks for a live model catalogue with one hard constraint attached:
 * "models extraction should never trigger any tokens expense, otherwise such
 * methods must be excluded from our codebase" (R7). That is a property of the
 * *sources*, not of the caller, so it is enforced here — at the only place a
 * source can be declared — rather than trusted at each call site.
 *
 * Two guards do it, and they are deliberately redundant:
 *
 * 1. `assertTokenFreeSource` rejects any descriptor that is not explicitly
 *    marked `billable: false`. A new source cannot be added by omission.
 * 2. `assertTokenFreeUrl` rejects any URL whose path is a completion endpoint,
 *    whatever descriptor it arrived under. Listing endpoints return a catalogue
 *    and no `usage` block; completion endpoints are the ones that bill. A typo
 *    that turns `/v1/models` into `/v1/messages` throws instead of spending.
 *
 * The rejected-methods table below is the other half of R7: it records the
 * extraction methods that were considered and excluded, so "we don't do that"
 * is a reviewable statement in the codebase rather than an absence.
 *
 * This is a leaf module: it imports nothing from the repository, so the guards
 * can be unit-tested — and imported by a source — without pulling in a catalogue.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

/** One hour, the freshness floor requirement R9 states. */
export const MODEL_CATALOGUE_TTL_MS = 60 * 60 * 1000;

/**
 * Cache lifetime in milliseconds.
 *
 * R9 says the data is "cached for at least 1 hour, so we don't request that data
 * from bot too much". `HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES` can therefore only
 * ever *raise* the TTL: a lower value would ask providers more often, which is
 * the thing the requirement exists to prevent.
 */
export const resolveModelCatalogueTtlMs = (env = process.env) => {
  const minutes = Number.parseFloat(String(env?.HIVE_MIND_MODEL_CATALOGUE_TTL_MINUTES ?? '').trim());
  if (!Number.isFinite(minutes) || minutes <= 0) return MODEL_CATALOGUE_TTL_MS;
  return Math.max(MODEL_CATALOGUE_TTL_MS, Math.round(minutes * 60 * 1000));
};

/**
 * Path fragments that mean "this request runs a model".
 *
 * Anthropic bills `/v1/messages` and `/v1/complete`, OpenAI bills
 * `/chat/completions` and `/responses`, Gemini bills `:generateContent` and
 * `:streamGenerateContent`, and the router proxies all of them under its own
 * prefixes — so the match is on the suffix, not the whole URL.
 */
export const BILLABLE_PATH_PATTERNS = Object.freeze(['/v1/messages', '/v1/complete', '/chat/completions', '/completions', '/responses', '/embeddings', ':generatecontent', ':streamgeneratecontent', ':counttokens', '/v1/batches', '/v1/messages/batches']);

/** True when a URL's path would run (and bill) a model rather than list them. */
export const isBillableCatalogueUrl = url => {
  const raw = String(url || '');
  if (!raw) return false;
  let pathname;
  try {
    pathname = new URL(raw).pathname.toLowerCase();
  } catch {
    pathname = raw.toLowerCase();
  }
  // `/v1/models` ends in `/models`, and `…/models/gpt-5` is still a listing.
  // Only a *terminal* billable segment counts, so a provider that one day serves
  // `/v1/models/completions-preview` is not mistaken for a completion call.
  return BILLABLE_PATH_PATTERNS.some(pattern => pathname === pattern || pathname.endsWith(pattern));
};

/**
 * Throw unless `url` is a listing endpoint.
 *
 * @param {string} url
 * @param {string} sourceId - named in the error, so the offending source is obvious
 */
export const assertTokenFreeUrl = (url, sourceId = 'unknown') => {
  if (isBillableCatalogueUrl(url)) {
    throw new Error(`Refusing to fetch a model catalogue from a billable endpoint (source "${sourceId}"): ${url}. Model extraction must never spend tokens (issue #2202, R7).`);
  }
  return url;
};

/** Throw unless a source descriptor has explicitly declared itself free. */
export const assertTokenFreeSource = source => {
  if (!source || typeof source !== 'object') throw new Error('Model catalogue source must be an object (issue #2202, R7).');
  if (source.billable !== false) {
    throw new Error(`Model catalogue source "${source.id ?? 'unnamed'}" must declare billable: false. Sources that can spend tokens are excluded from this codebase (issue #2202, R7).`);
  }
  return source;
};

/**
 * Extraction methods considered for R7 and deliberately not implemented.
 *
 * The issue explicitly raises one of them — "including but not exclusive to
 * usage of TUI" — and then says such methods "must be excluded from our
 * codebase" if they can cost tokens. Recording *why* each was excluded keeps the
 * next person from re-adding it, and gives `/models --details` something honest
 * to print when a live source is unavailable.
 */
export const REJECTED_EXTRACTION_METHODS = Object.freeze([
  Object.freeze({
    id: 'claude-tui-model-picker',
    label: 'Drive the Claude Code TUI `/model` picker',
    reason: "Starting the TUI starts a session. Claude Code sends a request as part of session start, so reading the picker is not free even if the picker itself is only a menu — and the cost is invisible, arriving on someone else's bill.",
  }),
  Object.freeze({
    id: 'codex-tui-model-picker',
    label: 'Drive the Codex TUI `/model` picker',
    reason: '`codex debug models` returns the same catalogue as JSON from the installed binary with no network call at all, so the TUI adds cost and flakiness for nothing.',
  }),
  Object.freeze({
    id: 'probe-completion-endpoint',
    label: 'Ask a completion endpoint whether a model id exists',
    reason: 'A `POST /v1/messages` with one token still bills a request, and a 404 for an unknown model is indistinguishable from a 404 for an unentitled one. `assertTokenFreeUrl` refuses these URLs outright.',
  }),
  Object.freeze({
    id: 'scrape-vendor-docs-html',
    label: 'Scrape vendor documentation pages for model tables',
    reason: 'Free, but unversioned and layout-dependent. models.dev already aggregates the same specifications behind a stable JSON contract, so it is the fallback instead (R8).',
  }),
]);

/**
 * The sources a live catalogue is assembled from, in the order they are tried.
 *
 * `rank` is that order and is also the precedence used when two sources describe
 * the same model: the router speaks for what is actually reachable *right now*
 * through the gateway a task will use, the local CLI speaks for what an
 * installed tool will accept, the vendor endpoint speaks for the account's
 * entitlements, and models.dev only ever contributes metadata (R8) — never
 * availability, because it does not know about this account.
 *
 * Every entry is `billable: false` and every entry is checked by
 * `assertTokenFreeSource` at module load, below.
 */
export const MODEL_CATALOGUE_SOURCES = Object.freeze([
  Object.freeze({
    id: 'router',
    rank: 1,
    label: 'Link.Assistant Router',
    kind: 'live',
    billable: false,
    contributes: 'availability',
    tools: Object.freeze(['claude', 'agent', 'codex', 'opencode', 'qwen', 'gemini']),
    why: 'The gateway a routed task actually talks to. Its catalogue is the merge of every provider it holds credentials for, and it reports degradation, so it is the only source that can say a model is reachable *through the path the task will take*.',
  }),
  Object.freeze({
    id: 'codex-cli',
    rank: 2,
    label: 'codex debug models',
    kind: 'live',
    billable: false,
    contributes: 'availability',
    tools: Object.freeze(['codex']),
    why: 'The installed Codex CLI answers from its own compiled catalogue with no network call, so it is both free and authoritative about what this binary will accept.',
  }),
  Object.freeze({
    id: 'anthropic-api',
    rank: 3,
    label: 'Anthropic GET /v1/models',
    kind: 'live',
    billable: false,
    contributes: 'availability',
    tools: Object.freeze(['claude', 'agent']),
    why: "Anthropic's listing endpoint returns the models this API key is entitled to. Listing is not metered: the response carries no `usage` block.",
  }),
  Object.freeze({
    id: 'openai-api',
    rank: 4,
    label: 'OpenAI GET /v1/models',
    kind: 'live',
    billable: false,
    contributes: 'availability',
    tools: Object.freeze(['codex', 'opencode']),
    why: "OpenAI's listing endpoint, same shape and same reasoning as Anthropic's.",
  }),
  Object.freeze({
    id: 'models-dev',
    rank: 5,
    label: 'models.dev',
    kind: 'metadata',
    billable: false,
    contributes: 'metadata',
    tools: Object.freeze(['claude', 'agent', 'codex', 'opencode', 'qwen', 'gemini']),
    why: 'The R8 fallback: context windows, pricing, modalities and release dates for models no first-party source described. It never adds a model to the available list — it only annotates one.',
  }),
  Object.freeze({
    id: 'bundled',
    rank: 6,
    label: 'Bundled with this installation',
    kind: 'bundled',
    billable: false,
    contributes: 'availability',
    tools: Object.freeze(['claude', 'agent', 'codex', 'opencode', 'qwen', 'gemini']),
    why: 'src/models/catalog.mjs, the aliases and defaults that ship with Hive Mind. Always present, never stale in the network sense, and the answer when every live source is unreachable.',
  }),
]);

for (const source of MODEL_CATALOGUE_SOURCES) assertTokenFreeSource(source);

/** Descriptor by id, or null. */
export const getModelCatalogueSource = id => MODEL_CATALOGUE_SOURCES.find(source => source.id === id) ?? null;

/** The sources that can say anything about `tool`, in rank order. */
export const listModelCatalogueSourcesForTool = tool => {
  const name = String(tool || '').toLowerCase();
  if (!name) return [...MODEL_CATALOGUE_SOURCES];
  return MODEL_CATALOGUE_SOURCES.filter(source => source.tools.includes(name));
};

export default {
  MODEL_CATALOGUE_TTL_MS,
  MODEL_CATALOGUE_SOURCES,
  REJECTED_EXTRACTION_METHODS,
  assertTokenFreeSource,
  assertTokenFreeUrl,
  getModelCatalogueSource,
  isBillableCatalogueUrl,
  listModelCatalogueSourcesForTool,
  resolveModelCatalogueTtlMs,
};
