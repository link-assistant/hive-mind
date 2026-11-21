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
 *
 * Issue #4048: GitHub (www.githubstatus.com) publishes the same API, so the
 * `github` "tool" lets CI waits tell a global Actions/Webhooks outage apart
 * from a problem of our own (docs/case-studies/issue-4048/).
 */

import { providerStatus as providerStatusConfig } from './config.lib.mjs';

/** Components that matter to each tool. Matched case-insensitively by substring. */
const TOOL_COMPONENTS = Object.freeze({
  claude: ['claude code', 'claude api', 'api', 'claude.ai', 'console', 'platform'],
  codex: ['codex', 'api', 'chatgpt'],
  // Issue #4048: the GitHub components that decide whether CI/CD signals can arrive at all.
  github: ['actions', 'webhooks', 'api requests', 'pull requests', 'git operations'],
});

export const getProviderStatusPageUrl = tool => {
  const normalized = String(tool || '').toLowerCase();
  if (normalized === 'claude') return providerStatusConfig.claudeUrl || null;
  if (normalized === 'codex') return providerStatusConfig.codexUrl || null;
  if (normalized === 'github') return providerStatusConfig.githubUrl || null;
  return null;
};

const relevantComponent = (tool, name) => {
  const lower = String(name || '').toLowerCase();
  const needles = TOOL_COMPONENTS[String(tool || '').toLowerCase()];
  return !needles || needles.some(needle => lower.includes(needle));
};

// Incidents that list no components are judged by their wording: anything about
// authentication or a platform-wide failure is relevant, a third-party connector is not.
const GENERAL_INCIDENT_WORDING = /\b(auth\w*|log ?in|sign[- ]?in|oauth|api|outage|all (?:users|services)|multiple github products)\b/i;
const relevantIncident = (tool, incident) => {
  if (!TOOL_COMPONENTS[String(tool || '').toLowerCase()]) return true;
  const components = Array.isArray(incident.components) ? incident.components : [];
  if (components.length > 0) return components.some(component => relevantComponent(tool, component?.name));
  const text = `${incident.name || ''} ${incident.incident_updates?.[0]?.body || ''}`;
  return GENERAL_INCIDENT_WORDING.test(text) || TOOL_COMPONENTS[String(tool).toLowerCase()].some(needle => needle !== 'api' && text.toLowerCase().includes(needle));
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
    .filter(incident => relevantIncident(tool, incident))
    .map(incident => ({
      name: incident.name,
      status: incident.status,
      impact: incident.impact || 'none',
      createdAt: incident.created_at || null,
      url: incident.shortlink || null,
      latestUpdate: incident.incident_updates?.[0]?.body || null,
    }));
  // The page-wide indicator also reflects unrelated products, so it only counts when no tool filter applies.
  const filtered = Boolean(TOOL_COMPONENTS[String(tool || '').toLowerCase()]);
  const hasIssues = activeIncidents.length > 0 || degradedComponents.length > 0 || (!filtered && indicator !== 'none' && indicator !== 'unknown');
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
  if (!status.hasIssues) return `${host}: ${status.description || 'All Systems Operational'}${status.tool && status.indicator && !['none', 'unknown'].includes(status.indicator) ? ` (nothing reported for ${status.tool})` : ''}`;
  const parts = [];
  for (const incident of status.activeIncidents.slice(0, 2)) parts.push(`${incident.name} (${incident.impact}, ${incident.status})`);
  if (parts.length === 0 && status.degradedComponents.length > 0) parts.push(status.degradedComponents.map(component => `${component.name}: ${component.status.replace(/_/g, ' ')}`).join(', '));
  return `${host}: ${status.description || status.indicator}${parts.length ? ` — ${parts.join('; ')}` : ''}`;
};

/**
 * Issue #4048: incidents (resolved or not) that overlap a time window, e.g. the
 * period a workflow run has been sitting in `queued`. Pure: takes the
 * Statuspage `incidents.json` body.
 */
export const findIncidentsOverlapping = (body, { tool = null, from, to = Date.now() } = {}) => {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  return (Array.isArray(body?.incidents) ? body.incidents : [])
    .filter(incident => incident && relevantIncident(tool, incident))
    .map(incident => {
      const createdAt = incident.started_at || incident.created_at || null;
      const resolvedAt = incident.resolved_at || null;
      return { name: incident.name, status: incident.status, impact: incident.impact || 'none', createdAt, resolvedAt, url: incident.shortlink || null, components: (incident.components || []).map(component => component?.name).filter(Boolean) };
    })
    .filter(incident => {
      const incidentStart = new Date(incident.createdAt).getTime();
      const incidentEnd = incident.resolvedAt ? new Date(incident.resolvedAt).getTime() : Infinity;
      return Number.isFinite(incidentStart) && incidentStart <= end && incidentEnd >= start;
    });
};

/**
 * Fetch the recent incident history (`/api/v2/incidents.json`, last 50
 * incidents). Never throws; returns `{ ok, incidents: [...] }` filtered to the
 * window and the tool's components.
 */
export const fetchProviderIncidents = async (tool, { from, to = Date.now(), fetchImpl = globalThis.fetch, timeoutMs = providerStatusConfig.timeoutMs, enabled = providerStatusConfig.enabled } = {}) => {
  const pageUrl = getProviderStatusPageUrl(tool);
  if (!enabled || !pageUrl || typeof fetchImpl !== 'function') return { ok: false, tool, pageUrl, incidents: [], error: !enabled ? 'disabled' : 'no status page for this tool' };
  try {
    const response = await fetchImpl(`${pageUrl.replace(/\/+$/, '')}/api/v2/incidents.json`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel?.();
      return { ok: false, tool, pageUrl, incidents: [], error: `HTTP ${response.status}` };
    }
    return { ok: true, tool, pageUrl, incidents: findIncidentsOverlapping(await response.json(), { tool, from, to }) };
  } catch (error) {
    return { ok: false, tool, pageUrl, incidents: [], error: error?.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : error?.message || String(error) };
  }
};

export default { getProviderStatusPageUrl, parseStatuspageSummary, fetchProviderStatus, formatProviderStatusSummary, clearProviderStatusCache, findIncidentsOverlapping, fetchProviderIncidents };
