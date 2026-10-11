// Lists heading anchors (id="...") of GitHub Docs pages, so the deep links
// used in src/github-docs-links.lib.mjs can be checked against the live page.
// Usage: node experiments/issue-2998/list-docs-anchors.mjs <locale> <path> [<path>...]
const [locale, ...paths] = process.argv.slice(2);
for (const p of paths) {
  const url = `https://docs.github.com/${locale}${p}`;
  const res = await fetch(url, { redirect: 'follow' });
  const html = await res.text();
  const ids = [...html.matchAll(/<h[23][^>]*\sid="([^"]+)"[^>]*>(.*?)<\/h[23]>/gs)].map(m => `${m[1]}  |  ${m[2].replace(/<[^>]+>/g, '').trim()}`);
  console.log(`\n## ${res.status} ${res.url}\n${ids.join('\n')}`);
}
