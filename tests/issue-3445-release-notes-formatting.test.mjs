/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #3445 (broken bullet list in the v2.37.1
 * release notes).
 *
 * The CI changeset rule produces one changeset per pull request, so a pull
 * request with several changes becomes one list item with several paragraphs.
 * Changesets indents those continuation paragraphs (and any nested list) by two
 * spaces. `format-release-notes.mjs` trimmed every line, which moved them out of
 * the list item: v2.37.1 rendered one bullet followed by loose paragraphs, and
 * 302 earlier releases lost indentation the same way. Older formatter versions
 * also dropped whole `### ... Changes` sections, cut the notes at the first
 * `---`, turned a literal `\n` into a line break and stripped trailing quotes.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3445
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildNpmBadge, buildPrLine, buildReleaseBody, buildReleaseDescription, extractChangelogSection, extractCommitHashes, extractPrNumbers, findFormattingDefects, formatChangelogListItem, hasGeneratedFooter, normalizeMarkdown, planReleaseRepair, stripGeneratedFooter } from '../scripts/format-release-notes.lib.mjs';

const MULTI_PARAGRAPH = ['### Patch Changes', '', '- 68f606a: First change (issue #2293).', '', '  Second change (issue #2303).', '', '  - nested bullet', '  - another nested bullet', '', '  Third change with `HIVE_MIND_X` and a literal `\\n` in code.'].join('\n');

// The formatter before issue #3445, reduced to its line handling.
const trimEveryLine = text =>
  text
    .split('\n')
    .map(line => line.trim())
    .join('\n');

// --- 1. Continuation paragraphs and nested lists keep their indentation -----

{
  const { description, sections, commitHashes } = buildReleaseDescription(MULTI_PARAGRAPH);
  assert.equal(sections.length, 1);
  assert.deepEqual(commitHashes, ['68f606a']);
  assert.ok(!description.startsWith('### '), 'a single section is published without its heading, as before');
  assert.ok(description.includes('\n\n  Second change (issue #2303).'), 'the second paragraph stays inside the list item');
  assert.ok(description.includes('\n  - nested bullet\n  - another nested bullet'), 'nested bullets stay nested');
  assert.ok(description.includes('a literal `\\n` in code'), 'a literal \\n in a code span is not turned into a line break');

  const oldDescription = trimEveryLine(description);
  assert.deepEqual(findFormattingDefects({ changelogSection: MULTI_PARAGRAPH, releaseBody: oldDescription }), ['lost-indentation'], 'the old trimming is detected as lost indentation');
  assert.deepEqual(findFormattingDefects({ changelogSection: MULTI_PARAGRAPH, releaseBody: buildReleaseBody({ description, version: '2.37.1', prNumbers: [3390] }) }), []);
}

// --- 2. The real v2.37.1 section and its published body ----------------------

{
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const section = extractChangelogSection(changelog, 'v2.37.1');
  assert.ok(section.startsWith('### Patch Changes'), 'the v2.37.1 section is found');
  const { description } = buildReleaseDescription(section);
  const paragraphs = description.split('\n\n');
  assert.ok(paragraphs.length > 5, 'v2.37.1 is one changeset with many paragraphs');
  assert.ok(paragraphs[0].startsWith('- 68f606a: '));
  for (const paragraph of paragraphs.slice(1)) assert.ok(paragraph.startsWith('  '), `continuation paragraph is indented: ${paragraph.slice(0, 60)}`);

  const published = JSON.parse(readFileSync(new URL('../docs/case-studies/issue-3445/data/release-v2.37.1.json', import.meta.url), 'utf8')).body;
  assert.ok(findFormattingDefects({ changelogSection: section, releaseBody: published }).includes('lost-indentation'), 'the published v2.37.1 body is the broken one');
  assert.deepEqual(extractPrNumbers(published), [3390]);
}

// --- 3. Several sections, Major, and headings or rules inside the text -------

{
  const body = ['### Major Changes', '', '- 1111111: Breaking change.', '', '### Minor Changes', '', '- 2222222: New feature.', '', '  ---', '', '  ### Not a section heading', '', '### Patch Changes', '', '- 3333333: Fix "quoted"'].join('\n');
  const { description, sections, commitHashes } = buildReleaseDescription(body);
  assert.deepEqual(
    sections.map(section => section.type),
    ['Major', 'Minor', 'Patch']
  );
  assert.deepEqual(commitHashes, ['1111111', '2222222', '3333333']);
  assert.ok(description.startsWith('### Major Changes\n\n- 1111111: Breaking change.'), 'every section keeps its heading when there are several');
  assert.ok(description.includes('  ---\n\n  ### Not a section heading'), 'a rule or heading inside a changeset does not cut the notes');
  assert.ok(description.endsWith('- 3333333: Fix "quoted"'), 'trailing quotes are kept');
}

// --- 4. Bodies without a section, CRLF and blank lines -----------------------

{
  assert.equal(buildReleaseDescription('Release 1.2.3').description, 'Release 1.2.3');
  assert.equal(normalizeMarkdown('\r\n\r\n- a  \r\n\r\n\r\n\r\n  b\t\r\n'), '- a\n\n  b');
}

// --- 5. Footer, PR line and idempotence --------------------------------------

{
  const { description } = buildReleaseDescription(MULTI_PARAGRAPH);
  const body = buildReleaseBody({ description, version: 'v2.37.1', prNumbers: [12, 3390, 12] });
  assert.ok(hasGeneratedFooter(body));
  assert.ok(body.includes('**Related Pull Requests:** #12, #3390'));
  assert.ok(body.endsWith('[![npm version](https://img.shields.io/badge/npm-2.37.1-blue.svg)](https://www.npmjs.com/package/%40link-assistant%2Fhive-mind/v/2.37.1)'));
  assert.equal(stripGeneratedFooter(body).trim(), description);
  assert.equal(buildReleaseDescription(body).description, description, 'formatting a formatted body again changes nothing');
  assert.equal(buildPrLine([7]), '**Related Pull Request:** #7');
  assert.equal(buildPrLine([]), '');
  assert.ok(!hasGeneratedFooter('![badge](https://img.shields.io/badge/x-y-z.svg) in a changeset'), "a changeset's own shields.io image is not the footer");
  const spacedFooter = `- abc1234: Fix.\n\n---\n \n\t\n\n${buildNpmBadge('1.0.0')}`;
  assert.equal(stripGeneratedFooter(spacedFooter), '- abc1234: Fix.\n', 'blank and whitespace-only lines before the badge are part of the footer');
  const rule = `- abc1234: Text.\n\n---\n${'\n \n'.repeat(50000)}not a badge`;
  assert.equal(stripGeneratedFooter(rule), rule, 'a `---` rule followed by many blank lines and no badge is kept, without backtracking');
}

// --- 6. CHANGELOG section extraction -----------------------------------------

{
  const changelog = ['# Changelog', '', '## 2.3.10', '', '- aaaaaaa: ten', '', '## 2.3.1', '', '- bbbbbbb: one, see `## 2.3.0` below', '  ## not a heading', '', '## 2.3.0', '', '- ccccccc: zero'].join('\n');
  assert.equal(extractChangelogSection(changelog, '2.3.1'), '- bbbbbbb: one, see `## 2.3.0` below\n  ## not a heading', '2.3.1 never reads the 2.3.10 section and ends at the next heading line');
  assert.equal(extractChangelogSection(changelog, 'v2.3.10'), '- aaaaaaa: ten');
  assert.equal(extractChangelogSection(changelog, '9.9.9'), '');
  assert.deepEqual(extractCommitHashes('- abcdef1: x\n  - 1234567: nested\n- not-a-hash: y'), ['abcdef1', '1234567']);
}

// --- 7. Repair plan for published releases -----------------------------------

{
  const changelog = `# Changelog\n\n## 2.37.1\n\n${MULTI_PARAGRAPH}\n\n## 2.37.0\n`;
  const { description } = buildReleaseDescription(MULTI_PARAGRAPH);
  const good = buildReleaseBody({ description, version: '2.37.1', prNumbers: [3390] });
  const broken = buildReleaseBody({ description: trimEveryLine(description), version: '2.37.1', prNumbers: [3390] });

  const repair = await planReleaseRepair({ release: { tag_name: 'v2.37.1', body: broken }, changelog });
  assert.equal(repair.action, 'repair');
  assert.deepEqual(repair.defects, ['lost-indentation']);
  assert.equal(repair.body, good, 'the repair keeps the PR line and restores the structure');

  assert.equal((await planReleaseRepair({ release: { tag_name: 'v2.37.1', body: good }, changelog })).action, 'skip', 'a correct body is left alone');
  assert.equal((await planReleaseRepair({ release: { tag_name: 'v0.0.1', body: 'x' }, changelog })).reason, 'no CHANGELOG.md section');

  let askedFor;
  const unformatted = await planReleaseRepair({
    release: { tag_name: 'v2.37.1', body: MULTI_PARAGRAPH },
    changelog,
    lookupPrNumbers: async hashes => {
      askedFor = hashes;
      return [3390];
    },
  });
  assert.deepEqual(unformatted.defects, ['unformatted']);
  assert.deepEqual(askedFor, ['68f606a'], 'without a PR line the PRs are looked up from the commit hashes');
  assert.equal(unformatted.body, good);
}

// --- 8. Manual (instant) releases write CHANGELOG items like Changesets -------

{
  const item = formatChangelogListItem('First paragraph.  \r\n\r\nSecond paragraph.\n- nested\n');
  assert.equal(item, '- First paragraph.\n\n  Second paragraph.\n  - nested', 'later lines are indented into the list item');
  assert.equal(formatChangelogListItem('Manual patch release'), '- Manual patch release');
  const { description } = buildReleaseDescription(`### Patch Changes\n\n${item}`);
  assert.deepEqual(findFormattingDefects({ changelogSection: `### Patch Changes\n\n${item}`, releaseBody: buildReleaseBody({ description, version: '1.0.0' }) }), []);
}

console.log('issue-3445-release-notes-formatting.test.mjs: all assertions passed');
