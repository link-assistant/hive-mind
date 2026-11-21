// Native issue ancestry is independent of a PR's GitHub closing references.
import { MAX_SUB_ISSUE_DEPTH, parseIssueRef } from './hive.issue-relations.lib.mjs';

export const ISSUE_ANCESTOR_FIELDS = Array.from({ length: MAX_SUB_ISSUE_DEPTH }).reduce(fields => `parent { url ${fields} }`, '');

export function getIssueAncestorUrls(issue) {
  const urls = [];
  const seen = new Set(issue?.url ? [issue.url.toLowerCase()] : []);
  for (let parent = issue?.parent; parent?.url && urls.length < MAX_SUB_ISSUE_DEPTH; parent = parent.parent) {
    const key = parent.url.toLowerCase();
    if (seen.has(key)) break;
    seen.add(key);
    urls.push(parent.url);
  }
  return urls;
}

/** Cached, bounded native-parent and PR-head lookups for the REST timeline fallback. */
export function createRestIssueOwnershipFetcher({ execGhWithRetry, log }) {
  const parents = new Map();
  const pullRequests = new Map();
  const read = async endpoint => {
    try {
      const { stdout } = await execGhWithRetry(`gh api ${endpoint}`, { execOptions: { encoding: 'utf8', env: process.env }, label: 'issue PR ownership' });
      return JSON.parse(stdout);
    } catch (error) {
      await log(`      ℹ️  Could not read ${endpoint}: ${error.message}`, { verbose: true });
      return null;
    }
  };
  return {
    async getAncestors(owner, repo, number) {
      const urls = [];
      const seen = new Set();
      let ref = { owner, repo, number };
      for (let depth = 0; depth < MAX_SUB_ISSUE_DEPTH; depth++) {
        const endpoint = `repos/${ref.owner}/${ref.repo}/issues/${ref.number}/parent`;
        if (seen.has(endpoint)) break;
        seen.add(endpoint);
        if (!parents.has(endpoint)) parents.set(endpoint, read(endpoint));
        const parent = await parents.get(endpoint);
        ref = parseIssueRef(parent?.html_url);
        if (!ref || !/^[\w.-]+$/.test(ref.owner) || !/^[\w.-]+$/.test(ref.repo)) break;
        if (seen.has(`repos/${ref.owner}/${ref.repo}/issues/${ref.number}/parent`)) break;
        urls.push(ref.url);
      }
      return urls;
    },
    async getPullRequestSource(pr) {
      const source = pr.url?.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)(?:$|[/?#])/i);
      if (!source) return pr;
      const endpoint = `repos/${source[1]}/${source[2]}/pulls/${source[3]}`;
      if (!pullRequests.has(endpoint)) pullRequests.set(endpoint, read(endpoint));
      const details = await pullRequests.get(endpoint);
      return { ...pr, headRefName: details?.head?.ref || pr.headRefName };
    },
  };
}
