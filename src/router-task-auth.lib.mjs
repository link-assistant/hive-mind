// Check native launch values against the declared Router lease and route.
// This admission check does not mediate credentials held inside a native CLI.
import { resolveRouterTaskRoute } from './router-isolation.lib.mjs';
import { buildRouterToolServiceUrl } from './router-routes.lib.mjs';

export function inspectRouterTaskEnvironment({ tool = 'claude', env = process.env } = {}) {
  const violation = reason => ({ path: '(router task environment)', kind: 'router-environment', reason });
  const token = String(env?.HIVE_MIND_ROUTER_TOKEN || '');
  if (!token.trim()) return [violation('the router task token is missing')];
  if (token !== token.trim()) return [violation('the router task token has invalid surrounding whitespace')];
  if (!String(env?.HIVE_MIND_ROUTER_URL || '').trim()) return [violation('the router task origin is missing')];
  const normalizedTool = String(tool || 'claude').toLowerCase();
  if (normalizedTool === 'opencode' && env?.OPENCODE_AUTH_CONTENT) return [violation('the native OpenCode inline credential registry is present')];
  const route = resolveRouterTaskRoute({ tool: normalizedTool, env });
  if (route.error) return [violation('the router task route could not be resolved safely')];
  const endpoint = buildRouterToolServiceUrl({ baseUrl: route.baseUrl, dialect: route.dialect, tool: normalizedTool });
  const expected = ['claude', 'agent'].includes(normalizedTool) ? { ANTHROPIC_API_KEY: token, ANTHROPIC_AUTH_TOKEN: token, ANTHROPIC_BASE_URL: endpoint } : normalizedTool === 'gemini' ? { GEMINI_API_KEY: token, GOOGLE_GEMINI_BASE_URL: endpoint } : { OPENAI_API_KEY: token, OPENAI_BASE_URL: endpoint };
  return Object.entries(expected).flatMap(([key, value]) => (env?.[key] === value ? [] : [violation(`${key} differs from the selected Router task credential or route`)]));
}
