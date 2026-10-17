// Classify why published release notes miss text from their CHANGELOG.md section (issue #3445).
// Usage: node experiments/issue-3445-classify-missing-text.mjs <releases.json> [CHANGELOG.md]
import { readFileSync } from 'node:fs';
import { buildReleaseDescription, extractChangelogSection, findFormattingDefects, hasGeneratedFooter } from '../scripts/format-release-notes.lib.mjs';
const releases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const changelog = readFileSync(process.argv[3] || 'CHANGELOG.md', 'utf8');
const causes = {};
for (const r of releases) {
  const section = extractChangelogSection(changelog, r.tag_name);
  if (!section || !hasGeneratedFooter(r.body)) continue;
  if (!findFormattingDefects({ changelogSection: section, releaseBody: r.body }).includes('missing-text')) continue;
  const { sections } = buildReleaseDescription(section);
  const found = [];
  if (r.body.includes('[REDACTED]') || /\w…\w/.test(r.body)) found.push('sanitizer-mask');
  if (sections.length > 1) found.push('extra-sections-dropped');
  if (/^\s*---\s*$/m.test(section.replace(/\n---\n\n\[!\[npm[\s\S]*$/, ''))) found.push('rule-truncation');
  if (section.includes('\\n')) found.push('literal-backslash-n');
  if (/["']\s*$/.test(section.trim())) found.push('trailing-quote-stripped');
  if (/^- [a-f0-9]{7,40}: /m.test(section) && !/^- [a-f0-9]{7,40}: /m.test(r.body)) found.push('commit-hash-marker-dropped');
  const items = text => (text.match(/^- /gm) || []).length;
  if (items(section) > items(r.body)) found.push('later-list-items-dropped');
  if (found.length === 0) found.push('body-differs-from-changelog');
  for (const c of found) (causes[c] ||= []).push(r.tag_name);
}
for (const [c, tags] of Object.entries(causes)) console.log(`${c}: ${tags.length} (${tags.slice(0, 8).join(', ')}${tags.length > 8 ? ', …' : ''})`);
