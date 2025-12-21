#!/usr/bin/env node

/**
 * Detailed options verification script
 * Compares every single option in README with code implementation
 */

import fs from 'fs';

const readmeContent = fs.readFileSync('README.md', 'utf8');
const hiveContent = fs.readFileSync('src/hive.mjs', 'utf8');
const solveConfigContent = fs.readFileSync('src/solve.config.lib.mjs', 'utf8');

console.log('='.repeat(80));
console.log('DETAILED OPTIONS CHECK');
console.log('='.repeat(80));

// Extract all yargs options from code with full details
function extractYargsOptions(content, command) {
  const options = [];
  const optionRegex = /\.option\('([^']+)',\s*\{([^}]+)\}/g;
  let match;

  while ((match = optionRegex.exec(content)) !== null) {
    const name = match[1];
    const config = match[2];

    const descMatch = config.match(/description:\s*['"`]([^'"`]+)['"`]/);
    const defaultMatch = config.match(/default:\s*([^,\n}]+)/);
    const aliasMatch = config.match(/alias:\s*['"`]([^'"`]+)['"`]/);

    options.push({
      name,
      description: descMatch ? descMatch[1] : 'NO DESCRIPTION',
      default: defaultMatch ? defaultMatch[1].trim() : 'NO DEFAULT',
      alias: aliasMatch ? aliasMatch[1] : null
    });
  }

  return options;
}

// Extract options from README sections
function extractReadmeOptions(content, sectionName) {
  const sectionRegex = new RegExp(`## ${sectionName}\\s*\`\`\`bash\\s*([\\s\\S]*?)\`\`\``);
  const sectionMatch = content.match(sectionRegex);

  if (!sectionMatch) {
    return [];
  }

  const lines = sectionMatch[1].split('\n');
  const options = [];

  for (const line of lines) {
    const optMatch = line.match(/^\s*(--[\w-]+)(?:,\s*-(\w))?\s+(.+?)\s*\[default:\s*([^\]]+)\]/);
    if (optMatch) {
      options.push({
        name: optMatch[1].replace('--', ''),
        alias: optMatch[2] || null,
        description: optMatch[3].trim(),
        default: optMatch[4].trim()
      });
    } else {
      const optMatchNoDefault = line.match(/^\s*(--[\w-]+)(?:,\s*-(\w))?\s+(.+?)$/);
      if (optMatchNoDefault) {
        options.push({
          name: optMatchNoDefault[1].replace('--', ''),
          alias: optMatchNoDefault[2] || null,
          description: optMatchNoDefault[3].trim(),
          default: 'NO DEFAULT'
        });
      }
    }
  }

  return options;
}

// Get options
const solveCodeOptions = extractYargsOptions(solveConfigContent, 'solve');
const hiveCodeOptions = extractYargsOptions(hiveContent, 'hive');
const solveReadmeOptions = extractReadmeOptions(readmeContent, '🚀 solve Options');
const hiveReadmeOptions = extractReadmeOptions(readmeContent, '🔧 hive Options');

console.log('\n📊 SOLVE COMMAND COMPARISON');
console.log('='.repeat(80));

const allSolveNames = new Set([...solveCodeOptions.map(o => o.name), ...solveReadmeOptions.map(o => o.name)]);

for (const name of allSolveNames) {
  const codeOpt = solveCodeOptions.find(o => o.name === name);
  const readmeOpt = solveReadmeOptions.find(o => o.name === name);

  console.log(`\n--${name}`);

  if (!codeOpt) {
    console.log('  ❌ NOT IN CODE!');
  }

  if (!readmeOpt) {
    console.log('  ❌ NOT IN README!');
  }

  if (codeOpt && readmeOpt) {
    if (codeOpt.description !== readmeOpt.description) {
      console.log('  ⚠️  DESCRIPTION MISMATCH:');
      console.log(`      README: "${readmeOpt.description}"`);
      console.log(`      CODE:   "${codeOpt.description}"`);
    }

    // Normalize defaults for comparison
    const normalizeDefault = val => {
      if (!val) return 'NO DEFAULT';
      return val.replace(/['"]/g, '').trim();
    };

    if (normalizeDefault(codeOpt.default) !== normalizeDefault(readmeOpt.default)) {
      console.log('  ⚠️  DEFAULT MISMATCH:');
      console.log(`      README: ${readmeOpt.default}`);
      console.log(`      CODE:   ${codeOpt.default}`);
    }

    if (codeOpt.alias !== readmeOpt.alias) {
      console.log('  ⚠️  ALIAS MISMATCH:');
      console.log(`      README: ${readmeOpt.alias || 'none'}`);
      console.log(`      CODE:   ${codeOpt.alias || 'none'}`);
    }

    // If all match
    if (
      codeOpt.description === readmeOpt.description &&
      normalizeDefault(codeOpt.default) === normalizeDefault(readmeOpt.default) &&
      codeOpt.alias === readmeOpt.alias
    ) {
      console.log('  ✅ OK');
    }
  }
}

console.log('\n\n📊 HIVE COMMAND COMPARISON');
console.log('='.repeat(80));

const allHiveNames = new Set([...hiveCodeOptions.map(o => o.name), ...hiveReadmeOptions.map(o => o.name)]);

for (const name of allHiveNames) {
  const codeOpt = hiveCodeOptions.find(o => o.name === name);
  const readmeOpt = hiveReadmeOptions.find(o => o.name === name);

  console.log(`\n--${name}`);

  if (!codeOpt) {
    console.log('  ❌ NOT IN CODE!');
  }

  if (!readmeOpt) {
    console.log('  ❌ NOT IN README!');
  }

  if (codeOpt && readmeOpt) {
    if (codeOpt.description !== readmeOpt.description) {
      console.log('  ⚠️  DESCRIPTION MISMATCH:');
      console.log(`      README: "${readmeOpt.description}"`);
      console.log(`      CODE:   "${codeOpt.description}"`);
    }

    const normalizeDefault = val => {
      if (!val) return 'NO DEFAULT';
      return val.replace(/['"]/g, '').trim();
    };

    if (normalizeDefault(codeOpt.default) !== normalizeDefault(readmeOpt.default)) {
      console.log('  ⚠️  DEFAULT MISMATCH:');
      console.log(`      README: ${readmeOpt.default}`);
      console.log(`      CODE:   ${codeOpt.default}`);
    }

    if (codeOpt.alias !== readmeOpt.alias) {
      console.log('  ⚠️  ALIAS MISMATCH:');
      console.log(`      README: ${readmeOpt.alias || 'none'}`);
      console.log(`      CODE:   ${codeOpt.alias || 'none'}`);
    }

    // If all match
    if (
      codeOpt.description === readmeOpt.description &&
      normalizeDefault(codeOpt.default) === normalizeDefault(readmeOpt.default) &&
      codeOpt.alias === readmeOpt.alias
    ) {
      console.log('  ✅ OK');
    }
  }
}

console.log('\n' + '='.repeat(80));
console.log('✅ Verification complete');
console.log('='.repeat(80));
