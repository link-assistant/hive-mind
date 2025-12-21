#!/usr/bin/env node

// Test simpler detection based on command name
console.log('process.argv[1]:', process.argv[1]);

// Extract the actual command name from process.argv[1]
const commandPath = process.argv[1];
const commandName = commandPath.split('/').pop(); // Get last part of path

console.log('Command name:', commandName);

// Simple detection: if command ends with .mjs, it's a local script
// Otherwise it's a global command
const isLocalScript = commandName.endsWith('.mjs');
const solveCommand = isLocalScript ? './solve.mjs' : 'solve';

console.log('Is local script:', isLocalScript);
console.log('Solve command:', solveCommand);

// Additional test: check different command patterns
const testCommands = ['hive', 'hive.mjs', './hive.mjs', '/usr/local/bin/hive', '/home/user/.bun/bin/hive', '/tmp/gh-issue-solver-1758084054233/hive.mjs'];

console.log('\nTesting different command patterns:');
testCommands.forEach(cmd => {
  const name = cmd.split('/').pop();
  const isLocal = name.endsWith('.mjs');
  const solve = isLocal ? './solve.mjs' : 'solve';
  console.log(`  ${cmd} -> ${name} -> ${solve}`);
});
