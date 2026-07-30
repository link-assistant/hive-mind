#!/usr/bin/env node

/**
 * Regression tests for issue #2119: quoted interpolations in `$` templates.
 *
 * The three reproduction pull requests were opened with the title
 * `'Implement Hello World in Scala'` - single quotes included, as literal
 * characters. For example:
 * https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2
 *
 * Root cause: `command-stream` shell-escapes every interpolated value, quoting
 * it when it contains characters the shell would otherwise split on (a space is
 * enough). Writing `$`gh pr edit ... --title "${title}"`` therefore produces
 * `--title "'Implement Hello World in Scala'"`, and the extra quotes end up
 * inside the title. Values without spaces slipped through unnoticed, which is
 * why this survived so long.
 *
 * The fix is to never wrap a placeholder in quotes: interpolate bare, and when
 * the quotes belong to an inner language (jq, GraphQL) build that expression in
 * JS and interpolate the finished string as one argument.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const { $: $raw } = await use('command-stream');
// Do not mirror probe output into the test log; only the captured value matters.
const $ = $raw({ mirror: false, capture: true });

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- the behaviour that caused the bug --------------------------------------
// This is the executable version of the root cause: it must keep holding, or
// the static guard below is guarding against the wrong thing.
const title = 'Implement Hello World in Scala';

const doubleQuoted = await $`echo "${title}"`;
assert.equal(doubleQuoted.stdout.toString().trim(), `'${title}'`, 'wrapping a placeholder in double quotes leaks literal quotes - exactly the published PR title');

const bare = await $`echo ${title}`;
assert.equal(bare.stdout.toString().trim(), title, 'a bare placeholder passes the value through unchanged');

// Bare interpolation is also the safe form: command-stream still quotes values
// that need it, so arguments with spaces stay a single argument.
const spacedPath = path.join('/tmp', 'hive-mind-2119 quoting probe.txt');
await $`rm -f ${spacedPath}`;
await $`touch ${spacedPath}`;
const listed = await $`ls -1 ${spacedPath}`;
assert.equal(listed.code, 0, 'a bare placeholder handles paths containing spaces');
assert.ok(listed.stdout.toString().includes('hive-mind-2119 quoting probe.txt'));

const listedQuoted = await $`ls -1 "${spacedPath}"`;
assert.notEqual(listedQuoted.code, 0, 'the same path wrapped in quotes is not found - the leaked quotes become part of the name');
await $`rm -f ${spacedPath}`;

// --- the codebase must not reintroduce the pattern --------------------------
// Issue #2119 asks to "fully apply requirements to entire codebase", so this is
// a static guard rather than a check of the single site that was reported.
const TEMPLATE = /\$`(?:[^`\\]|\\.)*`/gs;
const QUOTED_PLACEHOLDER = /(["'])\$\{[^}]*\}\1/g;

const sourceFiles = [];
const walk = async dir => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(entryPath);
    else if (entry.name.endsWith('.mjs')) sourceFiles.push(entryPath);
  }
};
await walk(path.join(repoRoot, 'src'));
await walk(path.join(repoRoot, 'scripts'));

const offenders = [];
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  for (const template of source.matchAll(TEMPLATE)) {
    for (const hit of template[0].matchAll(QUOTED_PLACEHOLDER)) {
      const line = source.slice(0, template.index).split('\n').length;
      offenders.push(`${path.relative(repoRoot, file)}:${line} ${hit[0]}`);
    }
  }
}

assert.deepEqual(offenders, [], `command-stream already escapes interpolated values; remove the quotes around these placeholders (or build the jq/GraphQL expression in JS):\n${offenders.join('\n')}`);

// The specific site from the issue must use the bare form.
const resultsSource = await readFile(path.join(repoRoot, 'src', 'solve.results.lib.mjs'), 'utf8');
assert.ok(resultsSource.includes('--title ${updatedTitle}`'), 'the PR title is set with a bare placeholder');

console.log(`PASS: issue #2119 shell quoting - bare placeholders, ${sourceFiles.length} source files clean`);
