/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2082.
 *
 * `npm run lint` and eslint.config.mjs both scoped linting to src/, scripts/
 * and eslint-rules/. tests/ — the largest .mjs tree in the repo — was never
 * linted, so the lint job was green while the test suite carried real defects.
 *
 * Turning the glob on surfaced them: an `assert.match` whose regex contained
 * unescaped literal indentation, a `catch` that discarded the original error,
 * and a batch of unused bindings. None of these were hypothetical — they were
 * sitting in tests CI runs on every push, and the lint job reported success.
 * That is a false negative of exactly the kind issue #2082 is about.
 *
 * This test pins the coverage so it cannot silently narrow again. The two
 * definitions must also agree: `npm run lint` is what CI invokes, while the
 * config `files` entry is what editors and `--fix` resolve. If they drift, one
 * of the two lies about what is checked.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2082
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const eslintConfigSource = readFileSync(path.join(root, 'eslint.config.mjs'), 'utf8');

// The trees that must be linted. src/ ships, scripts/ runs in CI, eslint-rules/
// decides what the other three mean, and tests/ is the gate everything else
// depends on being honest.
const REQUIRED_TREES = ['src', 'scripts', 'eslint-rules', 'tests'];

// --- What CI invokes ------------------------------------------------------

{
  for (const script of ['lint', 'lint:fix']) {
    const command = packageJson.scripts[script];
    assert.ok(command, `package.json defines a "${script}" script`);

    for (const tree of REQUIRED_TREES) {
      assert.match(command, new RegExp(`'${tree}/\\*\\*/\\*\\.\\{js,mjs,cjs\\}'`), `"npm run ${script}" covers ${tree}/ — a tree left out of the glob is a tree CI never checks`);
    }
  }
}

// --- What the config resolves ---------------------------------------------

{
  for (const tree of REQUIRED_TREES) {
    assert.match(eslintConfigSource, new RegExp(`'${tree}/\\*\\*/\\*\\.\\{js,mjs,cjs\\}'`), `eslint.config.mjs applies the code-quality rules to ${tree}/ — otherwise --fix and editor integration disagree with CI`);
  }
}

// --- The glob is not vacuous ----------------------------------------------

{
  // A glob that matches nothing would satisfy every assertion above while
  // checking no code at all.
  const testFiles = readdirSync(path.join(root, 'tests')).filter(file => /\.(js|mjs|cjs)$/.test(file));
  assert.ok(testFiles.length > 0, 'tests/ contains lintable files — an empty tree would make this coverage meaningless');
}

console.log('lint-covers-tests-2082.test.mjs: all assertions passed');
