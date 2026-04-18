#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const dockerfiles = ['Dockerfile', 'coolify/Dockerfile'];

for (const file of dockerfiles) {
  const content = await fs.readFile(path.join(process.cwd(), file), 'utf-8');

  assert.ok(content.includes('/workspace/.local/bin'), `${file} should keep ~/.local/bin on PATH for native Claude Code`);
  assert.ok(content.includes('https://claude.ai/install.sh'), `${file} should install Claude Code through the native installer`);
  assert.ok(content.includes('claude --version'), `${file} should verify that the installed Claude Code binary runs`);
  assert.ok(!content.includes('bun install -g @anthropic-ai/claude-code'), `${file} should not install Claude Code through Bun`);
  assert.ok(content.includes('bun install -g @openai/codex'), `${file} should still use Bun for compatible AI CLI packages`);
}

console.log('Claude Code install method tests passed');
