/** Compatibility contract for link-foundation/.github#1 until its actions ship. */
export function selectAutomationToken({ appToken = '', token = '', defaultToken = '' } = {}) {
  const layer = appToken ? 'app' : token ? 'token' : 'default';
  return { token: appToken || token || defaultToken, layer, triggersWorkflows: layer !== 'default' };
}

/** Conservative, read-only capability probe. An unknown capability uses branches. */
export async function probeRepositoryCapabilities({ token, layer, owner, administrationGranted = false, fetchImpl = fetch }) {
  if (layer === 'default') return { canCreateRepositories: false, canDeleteRepositories: false };
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' };
  try {
    if (layer === 'app') {
      // The mint step succeeds only when GitHub granted the explicitly requested
      // Administration write permission on the owner's installation.
      if (!administrationGranted) return { canCreateRepositories: false, canDeleteRepositories: false };
      const response = await fetchImpl(`https://api.github.com/orgs/${encodeURIComponent(owner)}`, { headers });
      return { canCreateRepositories: response.ok, canDeleteRepositories: true };
    }
    const response = await fetchImpl('https://api.github.com/user', { headers });
    const user = response.ok ? await response.json() : null;
    const scopes = (response.headers.get('x-oauth-scopes') || '').split(/,\s*/);
    const ownAccount = user?.login?.toLowerCase() === owner.toLowerCase();
    return { canCreateRepositories: Boolean(ownAccount && scopes.some(scope => ['repo', 'public_repo'].includes(scope))), canDeleteRepositories: Boolean(ownAccount && scopes.includes('delete_repo')) };
  } catch {
    return { canCreateRepositories: false, canDeleteRepositories: false };
  }
}

export function credentialSummary({ layer, triggersWorkflows }) {
  return `GitHub credentials: layer ${layer}${layer === 'default' ? ' (built-in github.token; optional credentials unavailable)' : ''}; pull request checks through ${triggersWorkflows ? 'pull_request' : 'dispatch-checks'}.`;
}
