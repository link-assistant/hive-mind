#!/usr/bin/env node
// Issue #2841: reproduce the sanitizer false positive on GitHub Actions YAML.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { findResidualCredentialBlock } from '../src/log-sanitize-stream.lib.mjs';

const samples = ['permissions:\n  id-token: write\n  token: ${{ secrets.GITHUB_TOKEN }}\n', '(`id-token: write` + `--provenance`)', 'token: ${{ secrets.NPM_TOKEN }}', 'GITHUB_TOKEN: ${{ github.token }}', 'password: ${{secrets.PASS}}', 'id-token: read', 'id-token: none', 'token: write-me-a-secret-value-123', `token=${'ghp_'}${'a'.repeat(36)}`];
for (const s of samples) {
  const out = sanitizeCredentialText(s, { includeEnvironmentCredentials: false });
  console.log(out === s ? 'UNCHANGED' : 'CHANGED  ', JSON.stringify(s), '->', JSON.stringify(out));
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2841-'));
const file = path.join(dir, 'f.yml');
await fs.writeFile(file, samples[0]);
console.log('findResidualCredentialBlock:', await findResidualCredentialBlock(file));
await fs.rm(dir, { recursive: true, force: true });
