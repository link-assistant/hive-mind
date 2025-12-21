#!/usr/bin/env node

// Script to add Sentry imports to solve lib files

import fs from 'fs/promises';
import path from 'path';

const libFiles = [
  'solve.branch-errors.lib.mjs',
  'solve.claude-execution.lib.mjs',
  'solve.error-handlers.lib.mjs',
  'solve.execution.lib.mjs',
  'solve.feedback.lib.mjs',
  'solve.repository.lib.mjs',
  'solve.results.lib.mjs',
  'solve.validation.lib.mjs',
  'solve.watch.lib.mjs'
];

const sentryImport = `
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;
`;

async function addSentryImport(filePath) {
  const content = await fs.readFile(filePath, 'utf8');

  // Check if already has reportError import
  if (content.includes('reportError')) {
    console.log(`✓ ${path.basename(filePath)} already has reportError`);
    return;
  }

  // Find the last import section (look for last import statement)
  const importRegex = /^(const .* = await import\(.*\);?)$/gm;
  let lastImportEnd = -1;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    lastImportEnd = match.index + match[0].length;
  }

  if (lastImportEnd === -1) {
    console.log(`⚠ ${path.basename(filePath)} - could not find imports`);
    return;
  }

  // Insert the Sentry import after the last import
  const newContent = content.slice(0, lastImportEnd) + sentryImport + content.slice(lastImportEnd);

  await fs.writeFile(filePath, newContent);
  console.log(`✓ Added Sentry import to ${path.basename(filePath)}`);
}

async function main() {
  for (const file of libFiles) {
    const filePath = path.join('src', file);
    try {
      await addSentryImport(filePath);
    } catch (error) {
      console.error(`✗ Error processing ${file}:`, error.message);
    }
  }
}

main().catch(console.error);
