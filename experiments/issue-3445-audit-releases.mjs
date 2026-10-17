// Audit every GitHub release body against its CHANGELOG.md section (issue #3445).
// Usage: node experiments/issue-3445-audit-releases.mjs <releases.json> [CHANGELOG.md]
import { readFileSync } from 'node:fs';
import { extractChangelogSection, findFormattingDefects, hasGeneratedFooter, buildReleaseDescription, normalizeMarkdown, stripGeneratedFooter } from '../scripts/format-release-notes.lib.mjs';
const releases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const changelog = readFileSync(process.argv[3] || 'CHANGELOG.md', 'utf8');
const stats = {};
const rows = [];
for (const r of releases) {
  const section = extractChangelogSection(changelog, r.tag_name);
  let status;
  if (!section) status = ['no-changelog-section'];
  else if (!hasGeneratedFooter(r.body)) status = ['unformatted'];
  else {
    const d = findFormattingDefects({ changelogSection: section, releaseBody: r.body });
    if (d.length) status = d;
    else status = buildReleaseDescription(section).description === normalizeMarkdown(stripGeneratedFooter(r.body)) ? ['ok'] : ['differs-other'];
  }
  for (const s of status) stats[s] = (stats[s] || 0) + 1;
  rows.push(`${r.tag_name}\t${r.published_at}\t${status.join(',')}`);
}
console.log(rows.join('\n'));
console.error(JSON.stringify(stats, null, 2));
