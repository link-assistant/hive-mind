#!/usr/bin/env node
// Test that CLI options in code are documented in CONFIGURATION.md and vice versa.
// This prevents documentation drift where new options are added to code but not docs,
// or options are removed from code but remain in docs.
//
// See issue #1518: ensures docs stay in sync with code at all times.

import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDocPath = join(__dirname, '..', 'docs', 'CONFIGURATION.md');

console.log('Testing documentation-code options sync...\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

// Read CONFIGURATION.md and extract options from the solve section
const configDoc = readFileSync(configDocPath, 'utf8');

// Extract solve section (between "### solve Options" and "### hive Options")
const solveSectionMatch = configDoc.match(/### solve Options[\s\S]*?(?=### hive Options)/);
const solveSection = solveSectionMatch ? solveSectionMatch[0] : '';

// Extract all option names from the solve section (backtick-wrapped --option-name)
const docOptionPattern = /`--([a-z][a-z0-9-]*)`/g;
const docSolveOptions = new Set();
let match;
while ((match = docOptionPattern.exec(solveSection)) !== null) {
  docSolveOptions.add(match[1]);
}

// Get all non-hidden options from SOLVE_OPTION_DEFINITIONS
const codeOptions = new Map();
for (const [name, def] of Object.entries(SOLVE_OPTION_DEFINITIONS)) {
  codeOptions.set(name, def);
}
const codeNonHiddenOptions = new Set([...codeOptions.entries()].filter(([, def]) => !def.hidden).map(([name]) => name));
const codeHiddenOptions = new Set([...codeOptions.entries()].filter(([, def]) => def.hidden).map(([name]) => name));

// Known exceptions: options documented in docs but not in SOLVE_OPTION_DEFINITIONS
// 'model' has a dynamic default function and is defined inline in createYargsConfig
// 'no-*' prefixed options are yargs boolean negation forms, not separate definitions
const docOnlyExceptions = new Set(['model']);
const negationPrefix = 'no-';

// Test 1: All non-hidden code options should be in docs
runTest('all non-hidden solve options are documented in CONFIGURATION.md', () => {
  const missing = [];
  for (const opt of codeNonHiddenOptions) {
    if (!docSolveOptions.has(opt)) {
      missing.push(opt);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Options in code but NOT in docs/CONFIGURATION.md:\n` + missing.map(o => `  --${o}`).join('\n') + `\nAdd these options to the "solve Options" table in docs/CONFIGURATION.md`);
  }
});

// Test 2: All documented solve options should exist in code (or be a known exception)
runTest('all documented solve options exist in code', () => {
  const orphaned = [];
  for (const opt of docSolveOptions) {
    // Skip known exceptions
    if (docOnlyExceptions.has(opt)) continue;
    // Skip negation forms (no-*)
    if (opt.startsWith(negationPrefix)) continue;
    // Must exist in code (hidden or not)
    if (!codeOptions.has(opt)) {
      orphaned.push(opt);
    }
  }
  if (orphaned.length > 0) {
    throw new Error(`Options in docs but NOT in code:\n` + orphaned.map(o => `  --${o}`).join('\n') + `\nRemove these from docs/CONFIGURATION.md or add them to SOLVE_OPTION_DEFINITIONS`);
  }
});

// Test 3: Hidden options should NOT be in docs (they are internal/deprecated)
runTest('hidden options are not documented (internal/deprecated)', () => {
  const leaked = [];
  for (const opt of codeHiddenOptions) {
    if (docSolveOptions.has(opt)) {
      leaked.push(opt);
    }
  }
  if (leaked.length > 0) {
    throw new Error(`Hidden/deprecated options should not be in docs:\n` + leaked.map(o => `  --${o}`).join('\n') + `\nRemove these from docs/CONFIGURATION.md (they are hidden: true in code)`);
  }
});

// Test 4: Docs should have a reasonable number of solve options
runTest('docs have reasonable number of solve options', () => {
  if (docSolveOptions.size < 30) {
    throw new Error(`Expected at least 30 solve options in docs, got ${docSolveOptions.size}. ` + `Docs parsing may be broken.`);
  }
});

// Test 5: Code should have a reasonable number of non-hidden options
runTest('code has reasonable number of non-hidden options', () => {
  if (codeNonHiddenOptions.size < 30) {
    throw new Error(`Expected at least 30 non-hidden solve options in code, got ${codeNonHiddenOptions.size}. ` + `Import may be broken.`);
  }
});

// Test 6: Verify the specific option from issue #1518 is documented
runTest('--allow-force-non-fork-repository-deletion is documented', () => {
  if (!docSolveOptions.has('allow-force-non-fork-repository-deletion')) {
    throw new Error('allow-force-non-fork-repository-deletion not found in docs');
  }
});

// Summary
console.log(`\n=== Test Summary ===`);
console.log(`Total: ${testsPassed + testsFailed} | ✅ Passed: ${testsPassed} | ❌ Failed: ${testsFailed}`);
console.log(`\nStats: ${codeNonHiddenOptions.size} non-hidden code options, ${docSolveOptions.size} documented solve options`);

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 All documentation-code sync tests passed!');
  process.exit(0);
}
