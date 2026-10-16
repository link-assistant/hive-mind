#!/usr/bin/env node

/**
 * Issue #3282: dependency freshness is demanded in every place a version is
 * declared. The gate used to miss the transitive lockfile, image refs held in
 * Dockerfile ARGs, digests and images pinned in code, read prose comments as
 * declarations, and resolved registry tags from the first page only.
 *
 * @hive-mind-test-suite default
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { collectDependencyRecords, imagePinRecord, lockfileLagRecords, parseDockerDependencyPins, parseGitHubActionPins, parseSourceImagePins, resolveContainerLatest } from '../scripts/dependency-freshness.lib.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

const lockfile = packages => ({ lockfileVersion: 3, packages: { '': { name: 'fixture' }, ...packages } });

test('a transitive lockfile entry behind what npm update would pick is stale', () => {
  const before = lockfile({ 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '2.0.0' }, 'node_modules/c/node_modules/a': { version: '0.9.0' } });
  const after = lockfile({ 'node_modules/a': { version: '1.0.1' }, 'node_modules/b': { version: '2.0.0' }, 'node_modules/c/node_modules/a': { version: '0.9.0' } });
  assert.deepEqual(lockfileLagRecords(before, after), [{ kind: 'lockfile', name: 'a', current: '0.9.0, 1.0.0', latest: '0.9.0, 1.0.1', policy: 'npm update', location: 'package-lock.json#a' }]);
});

test('another npm hoisting the same versions differently is not staleness', () => {
  const before = lockfile({ 'node_modules/a': { version: '1.0.0' }, 'node_modules/b/node_modules/a': { version: '2.0.0' } });
  const after = lockfile({ 'node_modules/a': { version: '2.0.0' }, 'node_modules/c/node_modules/a': { version: '1.0.0' }, 'node_modules/local': { link: true, resolved: 'packages/local' } });
  assert.deepEqual(lockfileLagRecords(before, after), []);
});

test('an image held in a Dockerfile ARG is checked where it is edited', () => {
  const source = ['# The base image is pinned below.', 'ARG BASE_IMAGE=ghcr.io/link-foundation/box-essentials-dind:2.10.4', 'FROM ${BASE_IMAGE}', ''].join('\n');
  const records = parseDockerDependencyPins(source, 'Dockerfile.fixture');
  assert.deepEqual(
    records.map(({ kind, name, current, location }) => ({ kind, name, current, location })),
    [{ kind: 'github', name: 'link-foundation/box', current: '2.10.4', location: 'Dockerfile.fixture:2' }]
  );
});

test('comment lines are prose, not declarations or build stages', () => {
  const source = ['# 0.26.14 broke tool errors; FROM line below pins the base.', '#   RUN bun install -g old-tool@1.0.0', 'FROM rust:1.99-slim AS builder', 'FROM ghcr.io/link-foundation/box:2.10.5@sha256:0123abcd', 'ARG LOCAL_IMAGE=hive-e2e:task', 'FROM ${LOCAL_IMAGE}', ''].join('\n');
  const records = parseDockerDependencyPins(source, 'Dockerfile.fixture');
  assert.deepEqual(
    records.map(({ kind, name, current, location }) => `${kind}:${name}@${current}:${location.split(':').pop()}`),
    ['docker:library/rust@1.99:3', 'github:link-foundation/box@2.10.5:4']
  );
});

test('images pinned in code are checked, examples in comments are not', () => {
  const source = ['/** e.g. `ghcr.io/link-assistant/router:1.2.0` */', "export const IMAGE = 'ghcr.io/link-assistant/router:0.125.4'; // https://github.com/link-assistant/hive-mind/issues/3395", "export const BASE = 'ghcr.io/link-foundation/box:2.10.5';", "const local = 'hive-e2e:task';", ''].join('\n');
  assert.deepEqual(
    parseSourceImagePins(source, 'src/fixture.lib.mjs').map(({ kind, name, current, location, exception }) => ({ kind, name, current, location, exception })),
    [
      { kind: 'container', name: 'ghcr.io/link-assistant/router', current: '0.125.4', location: 'src/fixture.lib.mjs:2', exception: 'https://github.com/link-assistant/hive-mind/issues/3395' },
      { kind: 'github', name: 'link-foundation/box', current: '2.10.5', location: 'src/fixture.lib.mjs:3', exception: undefined },
    ]
  );
  assert.equal(imagePinRecord('gitpod/workspace-full:latest'), null);
  assert.equal(imagePinRecord('localhost:5000/image'), null);
});

test('a commented-out workflow step is not a pin', () => {
  const source = ['steps:', '  # - uses: actions/old-thing@v1', '  - uses: actions/checkout@v7', ''].join('\n');
  // collectDependencyRecords blanks comment lines before parsing workflows.
  const blanked = source.replace(/^\s*#.*$/gm, '');
  assert.deepEqual(
    parseGitHubActionPins(blanked, 'w.yml').map(record => record.name),
    ['actions/checkout']
  );
});

test('the registry resolver reads every tag page and ignores date tags', async () => {
  const pages = {
    'https://ghcr.io/v2/org/image/tags/list?n=1000': { tags: ['0.82.0', '20260621', 'latest'], link: '</v2/org/image/tags/list?last=0.82.0&n=1000>; rel="next"' },
    'https://ghcr.io/v2/org/image/tags/list?last=0.82.0&n=1000': { tags: ['0.125.4', '1.24.1', '1.25.0-rc.1'] },
  };
  const fetchImpl = async url => {
    const page = pages[url];
    assert.ok(page, `unexpected ${url}`);
    return { ok: true, status: 200, headers: { get: name => (name === 'link' ? (page.link ?? null) : null) }, json: async () => ({ tags: page.tags }) };
  };
  assert.equal(await resolveContainerLatest('ghcr.io/org/image', { current: '0.125.4' }, { fetchImpl }), '1.24.1');
});

test('the repository inventory covers code image pins, coolify agent pins, example workflows and lockfile refresh', async () => {
  const records = await collectDependencyRecords({ root: repositoryRoot });
  const at = location => records.filter(record => record.location.startsWith(location));
  assert.ok(at('src/task-image-languages.lib.mjs').some(record => record.name === 'link-foundation/box'));
  const router = at('src/router-isolation.lib.mjs').find(record => record.name === 'ghcr.io/link-assistant/router');
  assert.match(router?.exception ?? '', /\/issues\/3395$/, 'the router 0.x hold must name its open follow-up issue');
  for (const name of ['@link-assistant/agent', 'start-command'])
    assert.ok(
      at('coolify/Dockerfile').some(record => record.name === name),
      `coolify/Dockerfile must pin ${name} like Dockerfile`
    );
  assert.ok(
    at('examples/workflows/close-linked-issues.yml').some(record => record.name === 'actions/setup-node'),
    'example workflows are copied as they are, so their action pins are checked'
  );
  const cli = fs.readFileSync(path.join(repositoryRoot, 'scripts', 'check-dependency-freshness.mjs'), 'utf8');
  assert.match(cli, /npm', \['update', '--package-lock-only'/);
  assert.match(cli, /lockfileLagRecords\(lock, await refreshedLockfile\(\)\)/);
});
