/**
 * @hive-mind-test-suite default
 *
 * Issue #2198: another CI/CD false negative — nothing verified that the
 * repository's own documentation links resolve.
 *
 * `docs/FREE_MODELS.md` and its three translations had linked to
 * `./case-studies/issue-1391/README.md` since commit ff467191 (March 2026).
 * That commit updated the default agent model and added the "Case Study"
 * entry, but never wrote the case study — `docs/case-studies/issue-1391/` has
 * never existed in any commit on any branch. The link was broken on the day
 * it landed and stayed broken for six months, because no job looked.
 *
 * This test is the offline half of the fix: it walks every tracked Markdown
 * file, extracts relative links, and fails if any target is missing. It needs
 * no network, so it runs in the ordinary test suite and catches the common
 * case (a link to a file in this repository) immediately.
 *
 * The network half is `.github/workflows/links.yml` (lychee), which also
 * checks external URLs. The wiring for that is pinned at the bottom so the
 * workflow cannot be dropped without a failing test.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const tracked = spawnSync('git', ['ls-files', '-z', '*.md'], { cwd: repoRoot, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);

assert.ok(tracked.length > 50, `expected the repository to track many Markdown files, got ${tracked.length}`);

// Documents copied verbatim from other repositories, and archived evidence.
// Their relative links describe *their* source tree, not ours, so a missing
// target is the expected state rather than a defect. Same exclusions the
// lychee workflow uses — keep the two lists in step.
const EXCLUDED_PREFIXES = ['docs/case-studies/', 'dev/log/', 'experiments/issue-2102/corpus/', 'tests/fixtures/'];

const isExcluded = file => EXCLUDED_PREFIXES.some(prefix => file.startsWith(prefix));

// [text](target). Images are deliberately included: a broken image path is a
// broken link too.
const LINK = /\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+"[^"]*")?\s*\)/g;

// Markdown inside a code span or fence is prose *about* links, not a link.
// CHANGELOG.md is full of it (`[owner/repo#n](url)`, `![](…?raw=true)`), and
// treating those as targets is a false positive of exactly the kind this
// issue is about.
//
// Blanking has to run over the whole document rather than line by line: a
// code span may wrap across a soft line break, and CHANGELOG.md has one
// (`... the ▶️\n[owner/repo#n](url) ...`) whose closing backtick sits on the
// next line. Every masked character becomes a space and newlines survive, so
// reported line numbers stay accurate.
const blank = text => text.replace(/[^\n]/g, ' ');
const maskCode = text => text.replace(/^[ \t]{0,3}(```|~~~)[^\n]*\n[\s\S]*?^[ \t]{0,3}\1[^\n]*$/gm, blank).replace(/(`+)[\s\S]*?\1/g, blank);

const broken = [];

for (const file of tracked) {
  if (isExcluded(file)) continue;

  const source = maskCode(readFileSync(join(repoRoot, file), 'utf8'));
  const lines = source.split('\n');

  for (const [index, line] of lines.entries()) {
    LINK.lastIndex = 0;
    let match;
    while ((match = LINK.exec(line)) !== null) {
      const target = match[1];

      // Absolute URLs, protocol-relative URLs, mailto:, and pure anchors are
      // the network checker's job, not this one's.
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;

      // Strip the fragment: we verify the file exists, not that the heading does.
      const [pathPart] = target.split('#');
      if (!pathPart) continue;

      const decoded = decodeURIComponent(pathPart);
      const base = decoded.startsWith('/') ? repoRoot : dirname(join(repoRoot, file));
      const resolved = resolve(base, decoded.replace(/^\//, ''));

      // Never let a link escape the repository.
      if (!resolved.startsWith(repoRoot.replace(new RegExp(`${sep}$`), '') + sep)) {
        broken.push(`${file}:${index + 1} -> ${target} (resolves outside the repository)`);
        continue;
      }

      if (!existsSync(resolved)) {
        broken.push(`${file}:${index + 1} -> ${target}`);
      }
    }
  }
}

assert.deepEqual(broken, [], `broken relative links in tracked Markdown:\n  ${broken.join('\n  ')}`);

// --- the network checker is wired up --------------------------------------

const workflowPath = join(repoRoot, '.github/workflows/links.yml');
assert.ok(existsSync(workflowPath), '.github/workflows/links.yml exists');
const workflow = readFileSync(workflowPath, 'utf8').replaceAll('\r\n', '\n');

assert.match(workflow, /uses: lycheeverse\/lychee-action@/, 'the links workflow runs lychee');
assert.match(workflow, /^permissions:\n {2}contents: read$/m, 'the links workflow defaults to least privilege');
assert.match(workflow, /GIT_CONFIG_KEY_0:\s*init\.defaultBranch/, "the links workflow suppresses Git's obsolete default-branch warning");
assert.match(workflow, /timeout-minutes:/, 'the links job is bounded so a hanging host cannot report as cancelled');

// lychee is told to keep going so the Wayback lookup can run; the explicit
// failure step is what makes the job fail. Without it `fail: false` would
// turn every broken link into a silent pass — the exact false negative this
// whole file exists to prevent.
assert.match(workflow, /fail: false/, 'lychee defers failure to the reporting step');
assert.match(workflow, /exit 1/, 'the links workflow still fails when links are broken');
assert.match(workflow, /scripts\/check-web-archive\.mjs/, 'broken links are checked against the Wayback Machine');

for (const prefix of EXCLUDED_PREFIXES) {
  assert.ok(workflow.includes(`--exclude-path ${prefix.replace(/\/$/, '')}`), `the links workflow excludes ${prefix}, matching this test`);
}

assert.ok(existsSync(join(repoRoot, '.lycheeignore')), '.lycheeignore exists');
assert.ok(existsSync(join(repoRoot, 'scripts/check-web-archive.mjs')), 'scripts/check-web-archive.mjs exists');

// --- the repository this one was renamed from -----------------------------

// `deep-assistant/hive-mind` is this repository under its former name. The
// GitHub *API* reports it as `301 Moved Permanently` -> `link-assistant/
// hive-mind`, but the HTML URLs it redirects from answer 404 to a link
// checker, so every historical reference to the old name is a broken link.
// Rewriting the owner keeps the reference pointing at the same issue.
const renamedFrom = tracked.filter(file => readFileSync(join(repoRoot, file), 'utf8').includes('github.com/deep-assistant/hive-mind'));
assert.deepEqual(renamedFrom, [], `these files still link to this repository under its former owner (deep-assistant -> link-assistant):\n  ${renamedFrom.join('\n  ')}`);

// --- the ignore list matches the URLs it was written for -------------------

// Every entry here was checked by hand and found to fail for a reason no
// change to this repository can fix. The assertion is not that the URL is
// listed -- it is that some pattern in `.lycheeignore` actually *matches* it.
// The first version of that file carried `https://www\.npmjs\.com` while
// README.md links to the bare host, so the pattern was there and matched
// nothing: an ignore rule that ignores nothing is indistinguishable from a
// missing one until the checker runs.
const ignoredWithReason = [
  ['https://npmjs.com/@link-assistant/hive-mind', '403 to any client, bot protection'],
  ['https://www.npmjs.com/package/@link-assistant/hive-mind', '403 to any client, bot protection'],
  ['https://claude.ai/code', '403 to any client, bot protection'],
  ['https://github.com/link-assistant/hive-mind/stargazers', '404 unless signed in; GitHub gates the stargazers list behind login for every public repository'],
];

const ignorePatterns = readFileSync(join(repoRoot, '.lycheeignore'), 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(line => new RegExp(line));

for (const [url, why] of ignoredWithReason) {
  assert.ok(
    ignorePatterns.some(pattern => pattern.test(url)),
    `.lycheeignore has no pattern matching ${url} (${why}), so lychee will report it`
  );
}

console.log(`doc-links-2198.test.mjs: all assertions passed (${tracked.length} Markdown files scanned)`);
