/** Compare original and catalog-backed renderings without invoking any AI tools. */
import { execFileSync } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import './issue-3837-installed-dependencies.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
await initI18n('en');
for (const backend of ['claude', 'codex']) {
  const source = execFileSync('git', ['show', `eafc26398:src/${backend}.prompts.lib.mjs`], { encoding: 'utf8' }).replaceAll("from './", "from '../src/");
  const file = new URL(`./issue-3837-original-${backend}.mjs`, import.meta.url);
  await writeFile(file, source);
  try {
    const original = await import(file.href);
    const current = await import(`../src/${backend}.prompts.lib.mjs`);
    const params = { owner: 'example', repo: 'project', issueNumber: 1, prNumber: 2, branchName: 'issue-1', argv: {} };
    await writeFile(`/tmp/issue-3837-${backend}-original.txt`, original.buildSystemPrompt(params));
    await writeFile(`/tmp/issue-3837-${backend}-current.txt`, current.buildSystemPrompt(params));
  } finally {
    await unlink(file);
  }
}
