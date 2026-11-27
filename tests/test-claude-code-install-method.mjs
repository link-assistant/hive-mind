#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const dockerfiles = ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile'];
const verifier = await fs.readFile(path.join(process.cwd(), 'src/verify-agent-runtime.mjs'), 'utf-8');
assert.match(verifier, /for \(const command of \[options\.claudeCommand \?\? 'claude',[^\n]+\) \{\s+const \{ stdout \} = await executeVersionProbe\(command,/u, 'the runtime checker should verify that the installed Claude Code binary runs');

for (const file of dockerfiles) {
  const content = await fs.readFile(path.join(process.cwd(), file), 'utf-8');

  assert.ok(content.includes('/home/box/.local/bin'), `${file} should keep ~/.local/bin on PATH for native Claude Code`);
  assert.ok(content.includes('https://claude.ai/install.sh'), `${file} should install Claude Code through the native installer`);
  assert.match(content, /^RUN --network=none .*\/verify-agent-runtime\.mjs"$/mu, `${file} should run the offline installed CLI verifier`);
  assert.doesNotMatch(content, /bun install(?: --backend=copyfile)? -g @anthropic-ai\/claude-code/u, `${file} should not install Claude Code through Bun`);
  assert.ok(content.includes('bun install --backend=copyfile -g @openai/codex'), `${file} should still use Bun for compatible AI CLI packages`);
}

console.log('Claude Code install method tests passed');
