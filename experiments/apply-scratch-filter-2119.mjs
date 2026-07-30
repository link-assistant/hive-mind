#!/usr/bin/env node

// Issue #2119: wire the shared AI-tool-scratch filter into every per-tool
// `checkForUncommittedChanges`. The eight implementations are near-identical
// copies, so the same two edits apply to each; done as a script so no copy is
// silently skipped.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.join(import.meta.dirname, '..');

const IMPORT_LINE = "import { ensureAiToolScratchIgnored, filterAiToolScratchFromStatus } from './ai-tool-scratch.lib.mjs';\n";
const ENSURE_CALL = `  // Issue #2119: AI tools leave scratch state (.formal-ai/, .playwright-mcp/) in
  // the workspace. Ignoring it here keeps it out of both this check and 'git add -A'.
  await ensureAiToolScratchIgnored(tempDir, log);
`;

const files = ['qwen.lib.mjs', 'agent.lib.mjs', 'gemini.lib.mjs', 'opencode.lib.mjs', 'claude.lib.mjs', 'codex.lib.mjs', 'agent-commander.lib.mjs'];

const anchorLog = "  await log('\\n🔍 Checking for uncommitted changes...');\n";
const oldStatus = '      const statusOutput = gitStatusResult.stdout.toString().trim();\n';
const newStatus = '      const statusOutput = filterAiToolScratchFromStatus(gitStatusResult.stdout.toString().trim());\n';

for (const file of files) {
  const filePath = path.join(repoRoot, 'src', file);
  let source = await readFile(filePath, 'utf8');

  if (source.includes('./ai-tool-scratch.lib.mjs')) {
    console.log(`skip (already wired): ${file}`);
    continue;
  }

  // 1. import, placed after the last top-of-file static import
  const importMatches = [...source.matchAll(/^import .*;\n/gm)];
  const lastImport = importMatches[importMatches.length - 1];
  source = source.slice(0, lastImport.index + lastImport[0].length) + IMPORT_LINE + source.slice(lastImport.index + lastImport[0].length);

  // 2. ensure the exclude entries exist before reading git status
  const fnIndex = source.indexOf('export const checkForUncommittedChanges');
  if (fnIndex === -1) throw new Error(`no checkForUncommittedChanges in ${file}`);
  const logIndex = source.indexOf(anchorLog, fnIndex);
  if (logIndex === -1) throw new Error(`no log anchor in ${file}`);
  source = source.slice(0, logIndex + anchorLog.length) + ENSURE_CALL + source.slice(logIndex + anchorLog.length);

  // 3. filter the status output (fallback for workspaces cloned before the fix)
  const statusIndex = source.indexOf(oldStatus, fnIndex);
  if (statusIndex === -1) {
    // agent-commander uses a slightly different shape; handled below.
    const acOld = "  const statusOutput = gitStatusResult.stdout?.toString().trim() || '';\n";
    const acNew = "  const statusOutput = filterAiToolScratchFromStatus(gitStatusResult.stdout?.toString().trim() || '');\n";
    const acIndex = source.indexOf(acOld, fnIndex);
    if (acIndex === -1) throw new Error(`no statusOutput assignment in ${file}`);
    source = source.slice(0, acIndex) + acNew + source.slice(acIndex + acOld.length);
  } else {
    source = source.slice(0, statusIndex) + newStatus + source.slice(statusIndex + oldStatus.length);
  }

  await writeFile(filePath, source, 'utf8');
  console.log(`patched: ${file}`);
}
