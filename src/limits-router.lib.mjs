/** Read the explicitly selected Router authority; never fall back to vendor auth. */
import { createHash } from 'node:crypto';
import { isRouterEnabled, resolveRouterBaseUrl } from './router-isolation.lib.mjs';
import { formatLocalizedResetTime } from './limits-i18n.lib.mjs';

const cached = new Map();
const pending = new Map();
const TTL_MS = 10000;

function windowInfo(window) {
  const resetsAt = window?.resets_at || null;
  return { percentage: window?.used_percentage ?? null, resetsAt, resetTime: formatLocalizedResetTime(resetsAt), windowSeconds: window?.window_seconds ?? null };
}

function mapUsage(tool, record) {
  const windows = record.windows;
  const session = tool === 'claude' ? windows.find(w => w.name === 'five_hour') : windows.find(w => w.window_seconds > 0 && w.window_seconds < 86400) || windows.find(w => w.name === 'primary' && !w.window_seconds);
  const weekly = tool === 'claude' ? windows.find(w => w.name === 'seven_day') : windows.find(w => w.window_seconds >= 86400) || windows.find(w => w.name === 'secondary' && !w.window_seconds);
  return { currentSession: windowInfo(session), allModels: windowInfo(weekly), sonnetOnly: windowInfo(windows.find(w => w.name === 'seven_day_sonnet')) };
}

export async function getSelectedRouterLimits(tool, { env = process.env, verbose = false } = {}) {
  if (!isRouterEnabled({ env })) return null;
  const provider = tool === 'claude' ? 'anthropic' : 'openai';
  const unavailable = message => ({ success: false, source: 'router', error: `Router ${provider} limits: ${message}` });
  const endpoint = resolveRouterBaseUrl({ env });
  if (endpoint.error || !endpoint.baseUrl) return unavailable('invalid endpoint configuration.');
  const token = env.HIVE_MIND_ROUTER_TOKEN;
  if (!token) return unavailable('no HIVE_MIND_ROUTER_TOKEN is configured for the selected authority.');
  // Partition by authority without retaining or printing the client token in keys.
  const key = createHash('sha256')
    .update(JSON.stringify([endpoint.baseUrl, token, provider]))
    .digest('hex');
  const hit = cached.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    try {
      const response = await fetch(`${endpoint.baseUrl}/api/usage/${provider}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
      if (verbose) console.log(`[VERBOSE] /limits authority=router provider=${provider} HTTP ${response.status}`);
      if (!response.ok) {
        await response.body?.cancel();
        return unavailable(`usage API returned HTTP ${response.status}; check the backend version and client authorization.`);
      }
      const data = await response.json();
      if (data.schema_version !== 1 || !Array.isArray(data.subscriptions)) return unavailable('unsupported usage response schema.');
      const record = data.subscriptions.find(item => item?.provider === provider);
      if (!record || record.state !== 'available') return unavailable('the selected backend could not verify current usage.');
      if (!Array.isArray(record.windows)) return unavailable('invalid usage window data.');
      return {
        success: true,
        source: 'router',
        usage: mapUsage(tool, record),
        planType: record.plan || null,
        subscription: { source: 'router', planType: record.plan || null, status: record.status || null, endsAt: record.subscription_end || null, trialEndsAt: record.trial_end || null },
        credits: record.credits || null,
        additionalRateLimits: (record.additional_limits || []).map(limit => ({
          limitId: limit.metered_feature || null,
          limitName: limit.limit_name || limit.name || 'additional',
          ...mapUsage(tool, limit),
          allowed: limit.allowed ?? null,
          limitReached: limit.limit_reached ?? null,
        })),
      };
    } catch {
      // Errors/bodies from an authority can contain credentials or identifiers.
      return unavailable('usage request failed; check connectivity and the backend contract.');
    }
  })();
  pending.set(key, request);
  try {
    const result = await request;
    if (cached.size >= 32) cached.delete(cached.keys().next().value);
    cached.set(key, { at: Date.now(), result });
    return result;
  } finally {
    pending.delete(key);
  }
}
