#!/usr/bin/env node

/**
 * Reproduce, against the real registries, the measurement that decides the
 * shape of the release preflight (issue #2221).
 *
 * Run it:
 *   node experiments/issue-2221-registry-probe-live.mjs
 *   DOCKERHUB_USERNAME=... DOCKERHUB_TOKEN=... node experiments/issue-2221-registry-probe-live.mjs
 *
 * It prints, for ghcr.io and docker.io:
 *
 *   1. what the token endpoint answers to a `pull,push` scope request made
 *      *anonymously* -- the answer the cheap version of this check would trust;
 *   2. what an attempted write answers -- the only thing that settles it;
 *   3. what an anonymous consumer sees for the images this repo publishes.
 *
 * Measured with no credentials on 2026-09-06 (dev/log/issues/2221/live-probe.log):
 *
 *   ghcr.io    token pull,push  -> 403  (anonymous push scope is refused outright)
 *   docker.io  token pull,push  -> 200  with access=[{"actions":["pull"], ...}]
 *
 * That second line is the point: a check that reads "HTTP 200" as "I can push"
 * passes with no credentials at all. With a credential, ghcr.io answers 200 too
 * and hands back the credential base64-encoded (link-foundation/box#117), so
 * neither registry's token endpoint settles the question. Nothing
 * is published by this script -- an upload session with no bytes and no commit
 * creates no blob, no manifest, no tag and no package version, and it is
 * cancelled immediately anyway.
 */

import { probeAnonymousPull, probeRegistryWrite, registryEndpoints, request } from '../scripts/registry-probe.lib.mjs';

const PUSH_TARGETS = [
  { registry: 'ghcr.io', repository: 'link-assistant/hive-mind' },
  { registry: 'docker.io', repository: 'konard/hive-mind' },
];

const PULL_TARGETS = ['docker.io/konard/hive-mind:latest', 'docker.io/konard/hive-mind-dind:latest', 'ghcr.io/link-assistant/hive-mind:latest', 'docker.io/konard/there-is-no-such-image-2221:latest'];

console.log('# 1. The token endpoint, asked anonymously for a push scope\n');
for (const { registry, repository } of PUSH_TARGETS) {
  const endpoints = registryEndpoints(registry);
  const response = await request({ url: `${endpoints.token}&scope=repository:${repository}:pull,push` });
  let access = '(no access claim)';
  try {
    const token = JSON.parse(response.body).token || '';
    const claims = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'));
    access = JSON.stringify(claims.access);
  } catch {
    // ghcr.io does not return a JWT here: the "token" is the credential itself,
    // base64-encoded, which is exactly why this step proves nothing.
  }
  console.log(`${registry.padEnd(10)} HTTP ${response.status}  access=${access}`);
}

console.log('\n# 2. An attempted write, with whatever credentials this shell has\n');
for (const { registry, repository } of PUSH_TARGETS) {
  const credentials = registry === 'ghcr.io' ? { username: process.env.GITHUB_ACTOR, secret: process.env.GITHUB_TOKEN } : { username: process.env.DOCKERHUB_USERNAME, secret: process.env.DOCKERHUB_TOKEN };
  const result = await probeRegistryWrite({ registry, repository, ...credentials });
  console.log(`${registry.padEnd(10)} ${result.state.padEnd(20)} ${result.detail}`);
}

console.log('\n# 3. What an anonymous consumer sees\n');
for (const reference of PULL_TARGETS) {
  const result = await probeAnonymousPull({ reference });
  console.log(`${result.state.padEnd(12)} ${reference}\n             ${result.detail}`);
}
