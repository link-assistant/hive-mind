/**
 * Close parent issues whose work is complete (issue #3359).
 *
 * GitHub closes neither a parent when its last sub-issue closes, nor sub-issues
 * when their parent closes. After the post-merge check or the merged-PR
 * sweeper closes an issue, its parents (sub-issues API, any repository) are
 * walked upwards and closed only when every condition holds:
 * 1. every sub-issue is closed as completed; one closed as not planned or as a
 *    duplicate counts only if the parent body says so on a line naming it;
 * 2. the parent body has no unchecked task-list item and no "Done when" item
 *    marked open;
 * 3. no open blocked-by dependency;
 * 4. no person reopened the parent after its last sub-issue closed.
 * Otherwise one status comment on the parent is posted or updated. Sub-issues
 * are never closed because a parent closed: that is the #3174 direction.
 * Read failures fail closed.
 */
import { ghJson, runLinkGh } from './issue-link-verification.lib.mjs';

export const PARENT_STATUS_MARKER = '<!-- hive-mind:parent-completion-status -->';

const parseKey = key => {
  const match = String(key).match(/^([^/\s]+)\/([^#\s]+)#(\d+)$/);
  if (!match) throw new Error(`Invalid issue key: ${key}`);
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
};
const nodeKey = node => `${node.repository.nameWithOwner}#${node.number}`.toLowerCase();

const PARENT_QUERY = 'query($owner:String!,$repo:String!,$number:Int!) { repository(owner:$owner,name:$repo) { issue(number:$number) { number state body repository { nameWithOwner } parent { number repository { nameWithOwner } } subIssues(first:100) { totalCount nodes { number state stateReason closedAt repository { nameWithOwner } } } blockedBy(first:50) { totalCount nodes { number state repository { nameWithOwner } } } timelineItems(last:100, itemTypes:[REOPENED_EVENT]) { nodes { ... on ReopenedEvent { createdAt actor { __typename login } } } } comments(last:100) { nodes { databaseId body } } } } }';

/** One issue with what {@link evaluateParentCompletion} needs. Throws on read failures and truncated lists. */
export async function fetchParentIssue(issue, run = runLinkGh) {
  const response = await ghJson(run, ['api', 'graphql', '-f', `query=${PARENT_QUERY}`, '-f', `owner=${issue.owner}`, '-f', `repo=${issue.repo}`, '-F', `number=${issue.number}`]);
  const node = response?.data?.repository?.issue;
  if (!node || !Array.isArray(node.subIssues?.nodes) || !Array.isArray(node.blockedBy?.nodes) || !Array.isArray(node.timelineItems?.nodes)) throw new Error(`Cannot read ${issue.owner}/${issue.repo}#${issue.number}`);
  if (node.subIssues.totalCount > node.subIssues.nodes.length || node.blockedBy.totalCount > node.blockedBy.nodes.length) throw new Error(`Too many sub-issues or dependencies to verify ${issue.owner}/${issue.repo}#${issue.number}`);
  return node;
}

const NOT_DONE_ALLOWED = /not[ -]planned|won'?t (?:do|fix)|wontfix|duplicate|dropped|out of scope|cancel(?:l?ed)?|superseded|obsolete/i;
const UNCHECKED = /^\s*[-*+]\s+\[ \]\s/m;
const OPEN_MARK = /\((?:open|todo|pending)\)|\[(?:open|todo|pending)\]|\*\*(?:open|todo|pending)\*\*/i;

/** The list items of a "Done when" section (a heading or a bold/plain "Done when:" line). */
function doneWhenItems(body) {
  const items = [];
  let inside = false;
  for (const line of String(body || '').split('\n')) {
    if (/^\s*(?:#{1,6}\s*|\*\*)?done when\b/i.test(line)) inside = true;
    else if (inside && /^\s*#{1,6}\s/.test(line)) inside = false;
    else if (inside && /^\s*[-*+]\s/.test(line)) items.push(line.trim());
  }
  return items;
}

/** Whether the parent body names the sub-issue on a line that says it is not planned, a duplicate, … */
function bodyAllowsNotDone(body, sub, parentRepository) {
  const [owner, repo] = sub.repository.nameWithOwner.split('/');
  const full = new RegExp(`(?:${owner}/${repo}#|https://github\\.com/${owner}/${repo}/issues/)${sub.number}(?!\\d)`, 'i');
  const short = new RegExp(`(?:^|[^\\w/#])#${sub.number}(?!\\d)`);
  const sameRepository = sub.repository.nameWithOwner.toLowerCase() === parentRepository.toLowerCase();
  return String(body || '')
    .split('\n')
    .some(line => NOT_DONE_ALLOWED.test(line) && (full.test(line) || (sameRepository && short.test(line))));
}

/**
 * Pure check of the four conditions. Returns { allSubIssuesClosed, complete, reasons }:
 * `allSubIssuesClosed` is false while a sub-issue is open (nothing to report then).
 */
export function evaluateParentCompletion(parent) {
  const subs = parent.subIssues.nodes;
  const allSubIssuesClosed = subs.length > 0 && subs.every(sub => sub.state === 'CLOSED');
  const reasons = [];
  if (!allSubIssuesClosed) return { allSubIssuesClosed, complete: false, reasons: [`${subs.filter(sub => sub.state !== 'CLOSED').length} sub-issue(s) still open`] };
  const notDone = subs.filter(sub => sub.stateReason !== 'COMPLETED' && !bodyAllowsNotDone(parent.body, sub, parent.repository.nameWithOwner));
  const describe = sub =>
    `${nodeKey(sub)} (${String(sub.stateReason || 'unknown')
      .toLowerCase()
      .replace('_', ' ')})`;
  if (notDone.length) reasons.push(`${notDone.map(describe).join(', ')} not closed as completed, and the description does not accept that`);
  if (UNCHECKED.test(parent.body || '')) reasons.push('the description has unchecked task-list items');
  const openDoneWhen = doneWhenItems(parent.body).filter(item => OPEN_MARK.test(item));
  if (openDoneWhen.length) reasons.push(`${openDoneWhen.length} "Done when" item(s) marked open`);
  const blockers = parent.blockedBy.nodes.filter(node => node.state === 'OPEN');
  if (blockers.length) reasons.push(`blocked by open ${blockers.map(nodeKey).join(', ')}`);
  const lastClosed = Math.max(...subs.map(sub => Date.parse(sub.closedAt || '') || 0));
  const reopened = parent.timelineItems.nodes.filter(event => event?.actor?.__typename === 'User' && Date.parse(event.createdAt) > lastClosed);
  if (reopened.length) reasons.push(`reopened by @${reopened.at(-1).actor.login} after the last sub-issue closed`);
  return { allSubIssuesClosed, complete: reasons.length === 0, reasons };
}

export const buildParentStatusComment = (count, reasons) => `${PARENT_STATUS_MARKER}\nAll ${count} sub-issues are closed; still open because: ${reasons.join('; ')}.`;

const check = async (promise, what) => {
  const result = await promise;
  if ((result.code ?? 0) !== 0) throw new Error(result.stderr?.toString().trim() || `${what} failed`);
  return result;
};

/** Post the status comment, or update the earlier one (only when its text changed). */
async function postStatusComment(parent, ref, body, run) {
  const existing = (parent.comments?.nodes || []).find(comment => comment?.body?.includes(PARENT_STATUS_MARKER));
  if (existing?.body === body) return;
  if (existing) await check(run(['api', '-X', 'PATCH', `repos/${ref.owner}/${ref.repo}/issues/comments/${existing.databaseId}`, '-f', `body=${body}`]), 'gh api PATCH comment');
  else await check(run(['issue', 'comment', String(ref.number), '--repo', `${ref.owner}/${ref.repo}`, '--body', body]), 'gh issue comment');
}

/**
 * Walk up from the closed issues `keys` ("owner/repo#N"). `mode: 'report'`
 * closes and comments nothing. Returns { closed, wouldClose, keptOpen:
 * [{ key, reasons }], failed: [{ key, error }] }. Never throws.
 */
export async function closeCompletedParents(keys, { mode = 'close', run = runLinkGh, logger = async () => {} } = {}) {
  const result = { closed: [], wouldClose: [], keptOpen: [], failed: [] };
  const seen = new Set();
  const queue = [...keys];
  while (queue.length) {
    const key = String(queue.shift()).toLowerCase();
    let parentKey;
    try {
      const child = await fetchParentIssue(parseKey(key), run);
      if (!child.parent) continue;
      parentKey = nodeKey(child.parent);
      if (seen.has(parentKey)) continue;
      seen.add(parentKey);
      const ref = parseKey(parentKey);
      const parent = await fetchParentIssue(ref, run);
      if (parent.state !== 'OPEN') continue;
      const verdict = evaluateParentCompletion(parent);
      if (!verdict.allSubIssuesClosed) continue;
      if (!verdict.complete) {
        result.keptOpen.push({ key: parentKey, reasons: verdict.reasons });
        if (mode === 'close') await postStatusComment(parent, ref, buildParentStatusComment(parent.subIssues.nodes.length, verdict.reasons), run);
        continue;
      }
      if (mode === 'close') {
        const comment = `All ${parent.subIssues.nodes.length} sub-issues are closed as completed, the description has no open items and nothing blocks it: closing (last closed: ${key}).`;
        await check(run(['issue', 'close', String(ref.number), '--repo', `${ref.owner}/${ref.repo}`, '--reason', 'completed', '--comment', comment]), 'gh issue close');
        result.closed.push(parentKey);
      } else result.wouldClose.push(parentKey);
      queue.push(parentKey);
    } catch (error) {
      result.failed.push({ key: parentKey || key, error: error.message });
      await logger(`Could not check the parent of ${key}: ${error.message}`, { level: 'warning' });
    }
  }
  return result;
}
