#!/usr/bin/env node

/**
 * Regression coverage for issue #2247 (H9).
 *
 * `create-test-repo.mjs` picked a language at random from a pool of forty and
 * filed a Hello World issue for it. On 2026-09-13 it picked Scala, and the task
 * container answered:
 *
 *     /bin/sh: 1: scalac: not found        (Scala draft log, line 4367)
 *     /bin/sh: 1: scala: not found         (line 5548)
 *
 * The image is built `FROM ghcr.io/link-foundation/box:2.10.2` and box ships no
 * Scala toolchain - twenty-five other languages in that pool were in the same
 * position. The task was impossible before any AI tool was chosen.
 *
 * `experiments/verify-task-image-languages.sh` runs one probe per language
 * inside the image itself; this test keeps the published list and its consumer
 * in agreement without needing Docker.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { isLanguageSupportedByTaskImage, LANGUAGES_WITHOUT_TASK_IMAGE_TOOLCHAIN, listTaskImageLanguages, pickTaskImageLanguage, TASK_IMAGE_BASE, TASK_IMAGE_LANGUAGES } from '../src/task-image-languages.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// 1. The language that broke the run is gone, and cannot come back silently.
// ---------------------------------------------------------------------------

assert.equal(isLanguageSupportedByTaskImage('Scala'), false, 'the image has no scalac');
assert.ok(LANGUAGES_WITHOUT_TASK_IMAGE_TOOLCHAIN.includes('Scala'), 'and the omission is recorded, not forgotten');
assert.ok(!listTaskImageLanguages().includes('Scala'), 'so no new task can ask for it');

for (const missing of LANGUAGES_WITHOUT_TASK_IMAGE_TOOLCHAIN) {
  assert.equal(isLanguageSupportedByTaskImage(missing), false, `${missing} has no toolchain in ${TASK_IMAGE_BASE}`);
}

// The two lists are disjoint and neither repeats itself.
const supported = listTaskImageLanguages();
assert.equal(new Set(supported).size, supported.length, 'no language is listed twice');
assert.equal(new Set(LANGUAGES_WITHOUT_TASK_IMAGE_TOOLCHAIN).size, LANGUAGES_WITHOUT_TASK_IMAGE_TOOLCHAIN.length);
for (const name of supported) assert.ok(!LANGUAGES_WITHOUT_TASK_IMAGE_TOOLCHAIN.includes(name), `${name} cannot be both shipped and missing`);

// Every entry carries the command that proves the toolchain is there.
for (const language of TASK_IMAGE_LANGUAGES) {
  assert.ok(language.name && typeof language.name === 'string');
  assert.ok(language.probe && typeof language.probe === 'string', `${language.name} needs a probe command`);
}

// Languages box does ship, spot-checked against its own Dockerfile stages.
for (const shipped of ['Kotlin', 'Java', 'Rust', 'Go', 'Python', 'Swift', 'PHP', 'Perl', 'Ruby', 'C#']) {
  assert.equal(isLanguageSupportedByTaskImage(shipped), true, `box has a ${shipped} stage`);
}

// Matching is case- and whitespace-insensitive, since the name travels through
// issue titles and prompts.
assert.equal(isLanguageSupportedByTaskImage('  kotlin '), true);
assert.equal(isLanguageSupportedByTaskImage(''), false);
assert.equal(isLanguageSupportedByTaskImage(null), false);
assert.equal(isLanguageSupportedByTaskImage(undefined), false);

// ---------------------------------------------------------------------------
// 2. Picking stays inside the list, for every value a random source can give.
// ---------------------------------------------------------------------------

for (const value of [0, 0.5, 0.999999, 1, -1, Number.NaN]) {
  const picked = pickTaskImageLanguage({ random: () => value });
  assert.ok(supported.includes(picked), `random()=${value} produced ${picked}`);
}
assert.equal(pickTaskImageLanguage({ random: () => 0 }), supported[0]);

{
  // Over many draws every language is reachable, so the pool is not effectively
  // one language wide.
  const seen = new Set();
  for (let index = 0; index < supported.length * 200; index++) seen.add(pickTaskImageLanguage());
  assert.equal(seen.size, supported.length, 'every listed language can be drawn');
}

// ---------------------------------------------------------------------------
// 3. The list, the image it describes, and its consumer stay in agreement.
// ---------------------------------------------------------------------------

const dockerfile = await readFile(join(repoRoot, 'Dockerfile'), 'utf8');
assert.ok(dockerfile.includes(`FROM ${TASK_IMAGE_BASE}`), `Dockerfile must still build FROM ${TASK_IMAGE_BASE}; update the language list when the base image changes`);

const createTestRepo = await readFile(join(repoRoot, 'create-test-repo.mjs'), 'utf8');
assert.ok(createTestRepo.includes("from './src/task-image-languages.lib.mjs'"), 'create-test-repo reads the published list');
assert.ok(createTestRepo.includes('const randomLanguage = pickTaskImageLanguage();'), 'and picks from it');
assert.ok(!/const languages = \['Python'/.test(createTestRepo), 'the old 40-language pool is gone');
for (const missing of LANGUAGES_WITHOUT_TASK_IMAGE_TOOLCHAIN) {
  assert.ok(!new RegExp(`'${missing.replace(/[+#]/gu, character => `\\${character}`)}'`).test(createTestRepo), `${missing} is not hard-coded back into create-test-repo`);
}

const verifyScript = await readFile(join(repoRoot, 'experiments', 'verify-task-image-languages.sh'), 'utf8');
for (const language of TASK_IMAGE_LANGUAGES) {
  assert.ok(verifyScript.includes(`${language.name}|${language.probe}`), `${language.name} is probed by the verification script`);
}
assert.ok(verifyScript.includes('Scala|command -v scalac'), 'and the script re-checks that Scala is still absent');

console.log('PASS: issue #2247 (H9) task image language pool');
