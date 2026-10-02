/** Remove only the three named recovery artifacts, preserving every other tree entry. */
import { writeFile } from 'node:fs/promises';
import { ghApi, ghList } from '../../scripts/github-actions.lib.mjs';
const repositories = ['konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a', 'konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b', 'konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c'];
const results = [];
for (const repository of repositories) {
  const pr = await ghApi(`repos/${repository}/pulls/2`);
  const files = await ghList(`repos/${repository}/pulls/2/files?per_page=100`);
  const remove = files.filter(file => ['Main.java', 'Main.class', 'Main.jar'].includes(file.filename)).map(file => file.filename);
  const result = { repository, pullRequest: pr.html_url, branch: pr.head.ref, removed: remove };
  if (remove.length) {
    const parent = await ghApi(`repos/${repository}/git/commits/${pr.head.sha}`);
    const tree = await ghApi(`repos/${repository}/git/trees`, { method: 'POST', body: { base_tree: parent.tree.sha, tree: remove.map(path => ({ path, mode: '100644', type: 'blob', sha: null })) } });
    const commit = await ghApi(`repos/${repository}/git/commits`, { method: 'POST', body: { message: 'Remove Hello World recovery artifacts (hive-mind#2324)', tree: tree.sha, parents: [pr.head.sha] } });
    await ghApi(`repos/${repository}/git/refs/heads/${pr.head.ref}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
    result.commit = `https://github.com/${repository}/commit/${commit.sha}`;
  }
  const verified = await ghList(`repos/${repository}/pulls/2/files?per_page=100`);
  result.clean = !verified.some(file => ['Main.java', 'Main.class', 'Main.jar'].includes(file.filename));
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile('experiments/issue-2324/historical-cleanup.json', JSON.stringify(results, null, 2));
