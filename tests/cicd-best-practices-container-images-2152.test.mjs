/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2152. Container releases need explicit
 * multi-architecture, native-runner, caching, and release-ordering guidance.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guidePaths = ['docs/CI-CD-BEST-PRACTICES.md', 'docs/CI-CD-BEST-PRACTICES.hi.md', 'docs/CI-CD-BEST-PRACTICES.ru.md', 'docs/CI-CD-BEST-PRACTICES.zh.md'];

for (const guidePath of guidePaths) {
  const guide = readFileSync(guidePath, 'utf8');

  assert.match(guide, /linux\/amd64/);
  assert.match(guide, /linux\/arm64/);
  assert.match(guide, /ubuntu-24\.04-arm/);
  assert.match(guide, /docker\/build-push-action@v7/);
  assert.match(guide, /cache-from: type=gha/);
  assert.match(guide, /cache-to: type=gha,mode=max/);
  assert.match(guide, /push-by-digest=true/);
  assert.match(guide, /docker buildx imagetools create/);
  assert.match(guide, /setup-qemu-action/);
}

const englishGuide = readFileSync(guidePaths[0], 'utf8');
const containerSection = englishGuide.match(/### 13\. Container Images(?<section>[\s\S]*?)## Quality Enforcement Strategy/)?.groups?.section;

assert.ok(containerSection, 'the English guide has a container-images section');
assert.match(containerSection, /each architecture[\s\S]*native runner/i);
assert.match(containerSection, /No `setup-qemu-action`/);
assert.match(containerSection, /every architecture your users run/i);
assert.match(containerSection, /Always cache/i);
assert.match(containerSection, /Never gate the release on the image push/i);
assert.match(containerSection, /GitHub Release[\s\S]*language-registry package first/i);
assert.match(containerSection, /manifest[\s\S]*every intended platform/i);
assert.match(containerSection, /tag[\s\S]*GitHub Release/i);
assert.match(containerSection, /link-foundation\/box/);
assert.match(containerSection, /link-assistant\/hive-mind/);

console.log('cicd-best-practices-container-images-2152.test.mjs: all assertions passed');
