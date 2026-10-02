import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = process.argv[2];
const targets = /\/(?:issue-completion|issue-requirements|pr-issue-link-repair|solve\.issue-completion)\.lib\.mjs$/;
const counts = new Map();
for (const file of await readdir(directory)) {
  const coverage = JSON.parse(await readFile(`${directory}/${file}`, 'utf8'));
  for (const script of coverage.result.filter(script => targets.test(script.url))) {
    for (const fn of script.functions)
      for (const range of fn.ranges) {
        const key = `${script.url}:${range.startOffset}:${range.endOffset}`;
        const item = counts.get(key) || { url: script.url, name: fn.functionName, ...range, count: 0 };
        item.count += range.count;
        counts.set(key, item);
      }
  }
}
for (const item of counts.values()) {
  if (item.count) continue;
  const source = await readFile(fileURLToPath(item.url), 'utf8');
  const line = source.slice(0, item.startOffset).split('\n').length;
  console.log(`${fileURLToPath(item.url)}:${line} ${item.name}: ${JSON.stringify(source.slice(item.startOffset, item.endOffset))}`);
}
