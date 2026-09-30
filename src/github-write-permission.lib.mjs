import { buildAuthorizationHeader } from './git-auth-transport.lib.mjs';

/**
 * Read the Git receive-pack advertisement to verify authorization for push.
 * This GET sends no pack, creates no refs, and does not bypass branch rules.
 * Repository REST role fields describe user roles, so they can all be false
 * for an installation token that actually has Contents write permission.
 */
export async function probeGitWriteAccess({ owner, repo, token, serverUrl = 'https://github.com', fetchImpl = globalThis.fetch }) {
  if (!token) return false;
  if (![owner, repo].every(value => typeof value === 'string' && /^[\w.-]+$/.test(value))) throw new Error('Invalid repository for Git write permission probe');
  const server = new URL(serverUrl);
  if (server.protocol !== 'https:' || server.username || server.password || server.pathname !== '/' || server.search || server.hash) throw new Error('Invalid GitHub server for Git write permission probe');
  const url = new URL(`/${owner}/${repo}.git/info/refs?service=git-receive-pack`, server);
  const response = await fetchImpl(url, {
    headers: { Authorization: buildAuthorizationHeader(token).slice('Authorization: '.length) },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  try {
    if ([401, 403, 404].includes(response.status)) return false;
    if (response.status !== 200) throw new Error(`Git write permission probe returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type')?.split(';')[0].trim();
    if (contentType !== 'application/x-git-receive-pack-advertisement') throw new Error('Git write permission probe returned an unexpected content type');
    return true;
  } finally {
    await response.body?.cancel();
  }
}

/** Keep ordinary user-role checks unchanged; probe only App installation tokens. */
export async function probeInstallationWriteAccess({ owner, repo, env = process.env, fetchImpl = globalThis.fetch }) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!token?.startsWith('ghs_')) return false;
  return probeGitWriteAccess({ owner, repo, token, serverUrl: env.GITHUB_SERVER_URL || `https://${env.GH_HOST || 'github.com'}`, fetchImpl });
}
