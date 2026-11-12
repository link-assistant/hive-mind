/**
 * @hive-mind-test-suite default
 *
 * Issue #4050. npm refused the 249,485,829-byte 2.40.0 and 2.40.1 tarballs with
 * E413 after every build had passed, so no release, image or Formal AI draft
 * could follow. Principle 16 records the lesson in every language; commands,
 * error texts, sizes and file names are the same anchors in each file.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4050
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const guidePaths = ['docs/CI-CD-BEST-PRACTICES.md', 'docs/CI-CD-BEST-PRACTICES.hi.md', 'docs/CI-CD-BEST-PRACTICES.ru.md', 'docs/CI-CD-BEST-PRACTICES.zh.md'];

for (const guidePath of guidePaths) {
  const publish = readFileSync(guidePath, 'utf8').match(/### 16\.([\s\S]*?)\n### 17\./)?.[1];
  assert.ok(publish, `${guidePath} has principle 16`);
  assert.match(publish, /#4050/, `${guidePath} links the evidence`);
  assert.match(publish, /E413 Payload Too Large/, `${guidePath} quotes the refusal`);
  assert.match(publish, /249,485,829/, `${guidePath} quotes the refused size`);
  assert.match(publish, /165,142,849/, `${guidePath} quotes the largest accepted size`);
  assert.match(publish, /npm pack --dry-run --json \| node scripts\/check-npm-tarball-size\.mjs --stdin/, `${guidePath} says how to measure`);
  assert.match(publish, /optionalDependencies/, `${guidePath} names the fix`);
  assert.match(publish, /src\/native-codex\/PACKAGES\.md/, `${guidePath} links the design`);
}

for (const file of ['scripts/check-npm-tarball-size.mjs', 'scripts/native-codex-packages.mjs', 'src/native-codex/PACKAGES.md', 'tests/native-codex-packages-4050.test.mjs']) {
  assert.ok(existsSync(file), `${file} pins the fix the guide describes`);
}

console.log('CI/CD best practices record the npm tarball budget lesson in every language.');
