#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

const read = async filePath => fs.readFile(path.join(repoRoot, filePath), 'utf-8');

const assertIncludes = (content, expected, filePath) => {
  assert.ok(content.includes(expected), `${filePath} should include ${expected}`);
};

const assertExcludes = (content, unexpected, filePath) => {
  assert.ok(!content.includes(unexpected), `${filePath} should not include ${unexpected}`);
};

const dockerfiles = ['Dockerfile', 'coolify/Dockerfile'];

for (const filePath of dockerfiles) {
  const content = await read(filePath);

  assertIncludes(content, 'FROM konard/box:2.0.1', filePath);
  assertIncludes(content, 'USER box', filePath);
  assertIncludes(content, 'WORKDIR /home/box', filePath);
  assertIncludes(content, '/home/box/.local/bin', filePath);
  assertIncludes(content, '/home/box/.node-bin', filePath);

  assertExcludes(content, 'konard/sandbox', filePath);
  assertExcludes(content, 'USER sandbox', filePath);
  assertExcludes(content, 'WORKDIR /workspace', filePath);
  assertExcludes(content, '/workspace', filePath);
}

const runtimePathFiles = ['coolify/start.sh', 'coolify/docker-compose.yml', 'docker-compose.yml', 'docker-restore-auth.sh', 'docker-solve.sh', 'scripts/verify-docker-image.sh', 'helm/hive-mind/templates/deployment.yaml'];

for (const filePath of runtimePathFiles) {
  const content = await read(filePath);

  assertIncludes(content, '/home/box', filePath);
  assertExcludes(content, '/workspace', filePath);
}

const coolifyStart = await read('coolify/start.sh');
assertIncludes(coolifyStart, 'box:box', 'coolify/start.sh');
assertIncludes(coolifyStart, 'su -p -s /bin/bash box', 'coolify/start.sh');
assertExcludes(coolifyStart, 'sandbox:sandbox', 'coolify/start.sh');
assertExcludes(coolifyStart, ' su -s /bin/bash sandbox', 'coolify/start.sh');

const verifyScript = await read('scripts/verify-docker-image.sh');
assertIncludes(verifyScript, 'Expected user box', 'scripts/verify-docker-image.sh');
assertIncludes(verifyScript, 'id -nG box', 'scripts/verify-docker-image.sh');
assertExcludes(verifyScript, 'Expected user sandbox', 'scripts/verify-docker-image.sh');
assertExcludes(verifyScript, 'id -nG sandbox', 'scripts/verify-docker-image.sh');

const releaseWorkflow = await read('.github/workflows/release.yml');
assertIncludes(releaseWorkflow, 'konard/box:', '.github/workflows/release.yml');
assertExcludes(releaseWorkflow, 'konard/sandbox', '.github/workflows/release.yml');
assertExcludes(releaseWorkflow, 'SANDBOX_VERSION', '.github/workflows/release.yml');

console.log('Docker Box migration checks passed');
