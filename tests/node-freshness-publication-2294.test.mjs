/**
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2294
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as freshness from '../scripts/dependency-freshness.lib.mjs';

const linuxFiles = ['linux-x64', 'linux-arm64'];
const registry = releases => ({
  fetchImpl: async url => {
    assert.equal(url, 'https://nodejs.org/dist/index.json');
    return { ok: true, json: async () => releases };
  },
});

test('an unpublished Node tag cannot reject installable Docker pins', async () => {
  const records = ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile'].flatMap(file => freshness.parseDockerDependencyPins('ARG HIVE_MIND_NODE_VERSION=26.11.0\n', file));
  const result = await freshness.checkDependencyRecords(records, {
    resolveGitHubLatest: async () => 'v26.11.1',
    resolveNodeLatest: async () => 'v26.11.0',
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.stale, []);
  assert.equal(result.current.length, 3);
});

test('Node freshness selects stable releases with both image architectures published', async () => {
  const latest = await freshness.resolveNodeLatest(
    'nodejs/node',
    {},
    registry([
      { version: 'v26.11.1', files: ['src', 'headers'] },
      { version: 'v26.10.0', files: linuxFiles },
      { version: 'v27.0.0-rc.1', files: linuxFiles },
      { version: 'v26.11.2', files: ['linux-x64'] },
      { version: 'v26.11.0', files: linuxFiles },
    ])
  );
  assert.equal(latest, 'v26.11.0');
});

test('a fully published Node release still makes an older exact pin stale', async () => {
  const latest = await freshness.resolveNodeLatest(
    'nodejs/node',
    {},
    registry([
      { version: 'v26.11.0', files: linuxFiles },
      { version: 'v26.11.1', files: linuxFiles },
    ])
  );
  assert.equal(latest, 'v26.11.1');
  assert.equal(freshness.assessVersionPin({ current: '26.11.0', latest }).current, false);
});

test('a Node download index without usable releases fails closed', async () => {
  await assert.rejects(freshness.resolveNodeLatest('nodejs/node', {}, registry([{ version: 'v26.11.1', files: ['src'] }])), /no published Linux/);
});
