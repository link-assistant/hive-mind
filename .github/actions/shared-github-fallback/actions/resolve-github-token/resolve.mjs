import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Repository creation has no read-only capability endpoint for installation
// or fine-grained tokens. Those tokens safely use orphan fixtures unless the
// shared action can verify their owner-level capability. Classic PAT scopes
// and the authenticated owner's login provide positive evidence here.
async function canCreateRepositories(token, layer) {
  if (layer !== 'token') return false;
  const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/user`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  if ([401, 403].includes(response.status)) return false;
  if (!response.ok) throw new Error(`Credential capability probe failed: HTTP ${response.status}`);
  const scopes = (response.headers.get('x-oauth-scopes') || '').split(',').map(scope => scope.trim());
  const user = await response.json();
  return scopes.some(scope => ['repo', 'public_repo'].includes(scope)) && user.login?.toLowerCase() === process.env.GITHUB_REPOSITORY_OWNER?.toLowerCase();
}

export async function resolveCredentials({ appId = '', appPrivateKey = '', appToken = '', token = '', defaultToken = '' }, capability = canCreateRepositories) {
  const layer = appId && appPrivateKey ? 'app' : token ? 'token' : 'default';
  const resolved = layer === 'app' ? appToken : layer === 'token' ? token : defaultToken;
  if (!resolved) throw new Error(layer === 'app' ? 'Configured GitHub App token was not minted' : 'The built-in GitHub token is missing');
  return { token: resolved, layer, triggersWorkflows: layer !== 'default', canCreateRepositories: layer !== 'default' && (await capability(resolved, layer)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await resolveCredentials({ appId: process.env.APP_ID, appPrivateKey: process.env.APP_PRIVATE_KEY, appToken: process.env.APP_TOKEN, token: process.env.AUTOMATION_TOKEN, defaultToken: process.env.DEFAULT_TOKEN });
  console.log(`::add-mask::${result.token.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
  const delimiter = randomUUID();
  appendFileSync(process.env.GITHUB_OUTPUT, `token<<${delimiter}\n${result.token}\n${delimiter}\nlayer=${result.layer}\ntriggers-workflows=${result.triggersWorkflows}\ncan-create-repositories=${result.canCreateRepositories}\n`);
  const summary = `GitHub credentials: layer ${result.layer}; check strategy ${result.triggersWorkflows ? 'pull_request' : 'dispatch-checks'}; repository creation ${result.canCreateRepositories ? 'verified' : 'unverified (orphan fixtures)'}.\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
