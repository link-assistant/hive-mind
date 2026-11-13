/**
 * Provider status-page lookups (issue #4053).
 *
 * On 2026-11-13 a `/solve` run stopped at the first
 *
 *   Failed to authenticate. API Error: 403 Attention Required! | Cloudflare
 *
 * while https://status.claude.com already showed a major incident ("We are
 * investigating an issue with users authenticating to Claude.ai and Claude
 * Code"). A minute later `claude -p hi` worked again. The status page is the
 * provider's own statement that a failure is temporary, so an unconfirmed
 * authentication failure is retried for longer while it reports a problem.
 *
 * Both Anthropic (status.claude.com) and OpenAI (status.openai.com) publish the
 * Atlassian Statuspage v2 JSON API, so one parser serves both:
 *   GET <page>/api/v2/summary.json
 *   → { status: { indicator, description }, components: [...], incidents: [...] }
 * See https://developer.statuspage.io/ and docs/case-studies/issue-4053/.
 */

import { providerStatus as providerStatusConfig } from './config.lib.mjs';

/** Components that matter to each tool. Matched case-insensitively by substring. */
const TOOL_COMPONENTS = Object.freeze({
  claude: ['claude code', 'claude api', 'api', 'claude.ai', 'console', 'platform'],
  codex: ['codex', 'api', 'chatgpt'],
});

export const getProviderStatusPageUrl = tool => {
  const normalized = String(tool || '').toLowerCase();
  if (normalized === 'claude') return providerStatusConfig.claudeUrl || null;
  if (normalized === 'codex') return providerStatusConfig.codexUrl || null;
  return null;
};

const relevantComponent = (tool, name) => {
  const lower = String(name || '').toLowerCase();
  const needles = TOOL_COMPONENTS[String(tool || '').toLowerCase()];
  return !needles || needles.some(needle => lower.includes(needle));
};

/**
 * Reduce a Statuspage `summary.json` body to the facts the retry logic needs.
 * Pure: exported for tests and for the case-study probe in experiments/.
 */
export const parseStatuspageSummary = (body, { tool = null, pageUrl = null } = {}) => {
  const indicator = String(body?.status?.indicator || 'unknown').toLowerCase();
  const description = body?.status?.description || null;
  const degradedComponents = (Array.isArray(body?.components) ? body.components : [])
    .filter(component => component && !component.group && component.status && component.status !== 'operational' && component.status !== 'under_maintenance')
    .filter(component => relevantComponent(tool, component.name))
    .map(component => ({ name: component.name, status: component.status }));
  const activeIncidents = (Array.isArray(body?.incidents) ? body.incidents : [])
    .filter(incident => incident && incident.status !== 'resolved' && incident.status !== 'postmortem')
    .map(incident => ({
      name: incident.name,
      status: incident.status,
      impact: incident.impact || 'none',
      createdAt: incident.created_at || null,
      url: incident.shortlink || null,
      latestUpdate: incident.incident_updates?.[0]?.body || null,
    }));
  const hasIssues = activeIncidents.length > 0 || degradedComponents.length > 0 || (indicator !== 'none' && indicator !== 'unknown');
  return { ok: true, tool, pageUrl, indicator, description, degradedComponents, activeIncidents, hasIssues };
};

const cache = new Map();

/** Drop cached status lookups (tests). */
export const clearProviderStatusCache = () => cache.clear();

/**
 * Fetch the tool's status page. Never throws: network/parse failures return
 * `{ ok: false, hasIssues: false, error }` so a broken status page can never
 * make a run stop *earlier* than it would without the lookup.
 */
export const fetchProviderStatus = async (tool, { fetchImpl = globalThis.fetch, timeoutMs = providerStatusConfig.timeoutMs, cacheMs = providerStatusConfig.cacheMs, enabled = providerStatusConfig.enabled, now = () => Date.now(), log = null } = {}) => {
  const pageUrl = getProviderStatusPageUrl(tool);
  if (!enabled || !pageUrl || typeof fetchImpl !== 'function') return { ok: false, tool, pageUrl, hasIssues: false, error: !enabled ? 'disabled' : 'no status page for this tool' };
  const cached = cache.get(pageUrl);
  if (cached && now() - cached.at < cacheMs) return cached.value;
  const endpoint = `${pageUrl.replace(/\/+$/, '')}/api/v2/summary.json`;
  let value;
  try {
    const response = await fetchImpl(endpoint, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel?.();
      value = { ok: false, tool, pageUrl, hasIssues: false, error: `HTTP ${response.status}` };
    } else {
      value = parseStatuspageSummary(await response.json(), { tool, pageUrl });
    }
  } catch (error) {
    value = { ok: false, tool, pageUrl, hasIssues: false, error: error?.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : error?.message || String(error) };
  }
  if (log) await log(`   [provider-status] GET ${endpoint} → ${value.ok ? `indicator=${value.indicator} incidents=${value.activeIncidents.length} degraded=${value.degradedComponents.length}` : `unavailable (${value.error})`}`, { verbose: true });
  cache.set(pageUrl, { at: now(), value });
  return value;
};

/** One line for logs and reports, e.g. "status.claude.com: Partial System Outage — Elevated errors on claude.ai (major, investigating)". */
export const formatProviderStatusSummary = status => {
  if (!status || status.error === 'disabled') return '';
  const host = status.pageUrl ? status.pageUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '') : 'status page';
  if (!status.ok) return `${host}: unavailable (${status.error || 'unknown error'})`;
  if (!status.hasIssues) return `${host}: ${status.description || 'All Systems Operational'}`;
  const parts = [];
  for (const incident of status.activeIncidents.slice(0, 2)) parts.push(`${incident.name} (${incident.impact}, ${incident.status})`);
  if (parts.length === 0 && status.degradedComponents.length > 0) parts.push(status.degradedComponents.map(component => `${component.name}: ${component.status.replace(/_/g, ' ')}`).join(', '));
  return `${host}: ${status.description || status.indicator}${parts.length ? ` — ${parts.join('; ')}` : ''}`;
};

export default { getProviderStatusPageUrl, parseStatuspageSummary, fetchProviderStatus, formatProviderStatusSummary, clearProviderStatusCache };
