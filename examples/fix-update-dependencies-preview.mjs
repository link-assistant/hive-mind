#!/usr/bin/env node

/**
 * Issue #2184 — preview what `/fix --update-all-dependencies` would say about a
 * local checkout, without touching GitHub.
 *
 * Run: node examples/fix-update-dependencies-preview.mjs [path]   (default: .)
 *
 * The real mode reads the repository through the GitHub API: its Linguist
 * language stats plus its file tree. This example feeds the same two detection
 * functions from a local `git ls-files`, so it answers the question the mode
 * exists to answer — which dependency ecosystems are in this repository, which
 * command actually brings each to latest, and what `.github/dependabot.yml`
 * would keep them there — against a working copy, offline and instantly.
 *
 * Language stats are unavailable offline, so detection here is by file path
 * only. That is deliberate: it shows the path signal on its own, which is what
 * catches the ecosystems GitHub's language stats never name (this repository is
 * reported as JavaScript/Shell/Dockerfile/Go Template — neither npm nor GitHub
 * Actions appears, yet both are present).
 *
 * Requires `git` and a git repository at `path`.
 */

import { execFileSync } from 'child_process';
import { buildAutomationSection, buildEcosystemsSection, mapRepositoryToEcosystems, resolveDependabotEntries } from '../src/fix.update-dependencies.lib.mjs';

const root = process.argv[2] || '.';

let files;
try {
  files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);
} catch (error) {
  console.error(`Cannot list files in ${root}: ${error.message}`);
  console.error('This preview needs a git repository. Pass its path as the first argument.');
  process.exit(1);
}

const { detected, unmatchedLanguages } = mapRepositoryToEcosystems({ files });

console.log(`Scanned ${files.length} tracked file(s) in ${root}`);
console.log(`Ecosystems detected: ${detected.length}${detected.length > 0 ? ` — ${detected.map(entry => entry.ecosystem.label).join(', ')}` : ''}`);
if (unmatchedLanguages.length > 0) console.log(`Languages with no manifest of their own: ${unmatchedLanguages.join(', ')}`);

if (detected.length === 0) {
  console.log('');
  console.log('No dependency manifest was recognised, so the mode would refuse to open an issue.');
  process.exit(0);
}

console.log('');
console.log('--- the ecosystem inventory the generated issue would carry ---');
console.log('');
console.log(buildEcosystemsSection({ files }));

console.log('');
console.log('--- and the automation section ---');
console.log('');
console.log(buildAutomationSection({ files }));

const entries = resolveDependabotEntries({ files });
console.log('');
console.log(`${entries.length} \`package-ecosystem\` value(s) are declared, one per manifest actually committed here.`);
console.log('Nothing was created by this preview; run `fix.mjs <repo> --update-all-dependencies --dry-run` for the full issue body.');
