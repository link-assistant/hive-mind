/** Live reproducer: the Node version demanded by CI must have NVM checksums. */
import assert from 'node:assert/strict';
import { log } from 'node:console';
import * as freshness from '../scripts/dependency-freshness.lib.mjs';

const record = (await freshness.collectDependencyRecords()).find(candidate => candidate.name === 'nodejs/node');
assert.ok(record, 'Docker Node pin is inventoried');
const resolver = record.kind === 'node' ? freshness.resolveNodeLatest : freshness.resolveGitHubLatest;
const latest = await resolver(record.name, record);
const version = latest.replace(/^v/, '');
const url = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
const response = await globalThis.fetch(url);
log(`${record.kind} resolver selected ${latest}; ${url} returned ${response.status}`);
assert.equal(response.status, 200, 'The freshness gate must select a Node release NVM can verify');
const manifest = await response.text();
for (const arch of ['x64', 'arm64']) assert.ok(manifest.includes(`node-v${version}-linux-${arch}.tar.xz`), `${arch} checksum must be published`);
log('PASS: the selected Node release has both Linux checksum entries');
