/**
 * A tiny in-memory GitHub for tests that drive the `gh` comment commands the
 * monitor runs (issue #3530): `gh pr|issue comment URL --body-file F` creates a
 * comment, `gh api repos/o/r/issues/comments/ID --method PATCH --input F` edits
 * it, and `gh api repos/o/r/issues/comments/ID --jq .body` reads it back.
 *
 * @hive-mind-test-skip
 */
import fs from 'node:fs/promises';

export function createGhCommentRecorder() {
  let nextId = 1;
  const store = new Map(); // id -> { url, body }
  const posts = []; // bodies of created comments, in order
  const patches = []; // { id, body } of edits, in order
  const calls = [];
  const create = (targetUrl, body) => {
    const id = String(nextId++);
    const url = `${targetUrl}#issuecomment-${id}`;
    store.set(id, { url, body });
    posts.push(body);
    return { id, url };
  };
  const runCommand = async (command, args) => {
    calls.push([command, ...args]);
    const apiPath = args[0] === 'api' ? args[1] : null;
    const commentId = apiPath ? /\/issues\/comments\/(\d+)$/.exec(apiPath)?.[1] : null;
    if (apiPath && args.includes('--input')) {
      const body = JSON.parse(await fs.readFile(args[args.indexOf('--input') + 1], 'utf8')).body;
      const entry = store.get(commentId);
      if (!entry) return { code: 1, stdout: '', stderr: 'HTTP 404: Not Found' };
      entry.body = body;
      patches.push({ id: commentId, body });
      return { code: 0, stdout: `${entry.url}\n`, stderr: '' };
    }
    if (apiPath && commentId) {
      const entry = store.get(commentId);
      return entry ? { code: 0, stdout: `${entry.body}\n`, stderr: '' } : { code: 1, stdout: '', stderr: 'HTTP 404: Not Found' };
    }
    if (args[1] === 'comment' && args.includes('--body-file')) {
      const { url } = create(args[2], await fs.readFile(args[args.indexOf('--body-file') + 1], 'utf8'));
      return { code: 0, stdout: `${url}\n`, stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected gh call: ${args.join(' ')}` };
  };
  return {
    runCommand,
    /** Create a comment the way another poster (e.g. the log uploader) would. */
    create,
    posts,
    patches,
    calls,
    /** Every comment as it reads now. */
    current: () => [...store.values()].map(entry => entry.body),
    /** Every comment with its URL, in posting order. */
    urls: () => [...store.values()].map(entry => ({ ...entry })),
  };
}
