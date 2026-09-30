/** GitHub API calls keep credentials in the environment and JSON on stdin. */
import { execFileSync } from 'node:child_process';
import { ghWithRateLimitRetry } from '../src/github-rate-limit.lib.mjs';

export async function githubApi(endpoint, { method = 'GET', body, paginate = false, retryOptions = {} } = {}) {
  const args = ['api', endpoint, '--method', method];
  if (body) args.push('--input', '-');
  if (paginate) args.push('--paginate', '--slurp');
  const output = await ghWithRateLimitRetry(() => execFileSync('gh', args, { encoding: 'utf8', input: body ? JSON.stringify(body) : undefined, maxBuffer: 32 * 1024 * 1024 }), { label: `gh api ${method} ${endpoint}`, ...retryOptions });
  return output.trim() ? JSON.parse(output) : null;
}

/** gh --paginate --slurp preserves pages for both array and object endpoints. */
export async function githubList(endpoint, field = null, api = githubApi) {
  const pages = await api(endpoint, { paginate: true });
  return pages.flatMap(page => (field ? page[field] : page));
}
