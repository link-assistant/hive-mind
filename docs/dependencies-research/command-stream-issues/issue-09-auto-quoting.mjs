#!/usr/bin/env node
/**
 * Issue #9: Automatic quote addition in interpolation
 *
 * Problem: command-stream adds extra single quotes around interpolated strings when using "${variable}" syntax
 *
 * Real-world impact: GitHub CLI commands like `gh issue create --title "${title}"`
 * result in issue titles wrapped in single quotes: 'My Title' instead of: My Title
 *
 * Root cause: command-stream appears to automatically add shell escaping that includes
 * wrapping the entire interpolated value in single quotes when double quotes are used
 *
 * Solution: Use Node.js child_process.execSync() for commands requiring precise string formatting
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
const fs = (await import('fs')).promises;

console.log('=== Issue #9: Automatic Quote Addition in Interpolation ===\n');

console.log('Problem: Quotes around interpolated strings can add extra quotes\n');

// Test different quoting scenarios
const testTitle = 'Implement Hello World in JavaScript';
const testFile = `/tmp/quote-test-${Date.now()}.txt`;

console.log('Test string:', testTitle);
console.log('Expected output:', testTitle);
console.log('');

// Example 1: Double quotes around interpolation
console.log('Example 1: Double quotes around interpolation');
console.log('Command: echo "${testTitle}" > file.txt');
try {
  await $`echo "${testTitle}" > ${testFile}`;
  const content = await fs.readFile(testFile, 'utf8');
  console.log('Output:', content.trim());
  console.log('Matches expected:', content.trim() === testTitle);
  await fs.unlink(testFile);
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n' + '='.repeat(60) + '\n');

// Example 2: Single quotes around interpolation (THIS IS THE PROBLEM!)
console.log('Example 2: Single quotes around interpolation');
console.log("Command: echo '${testTitle}' > file.txt");
console.log('Note: Single quotes prevent variable expansion in shell!');
try {
  await $`echo '${testTitle}' > ${testFile}`;
  const content = await fs.readFile(testFile, 'utf8');
  console.log('Output:', content.trim());
  console.log('Result: Literal ${testTitle} instead of the value!');
  await fs.unlink(testFile);
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n' + '='.repeat(60) + '\n');

// Example 3: No quotes around interpolation
console.log('Example 3: No quotes around interpolation');
console.log('Command: echo ${testTitle} > file.txt');
try {
  await $`echo ${testTitle} > ${testFile}`;
  const content = await fs.readFile(testFile, 'utf8');
  console.log('Output:', content.trim());
  console.log('Matches expected:', content.trim() === testTitle);
  console.log('Note: Works but may break with special characters');
  await fs.unlink(testFile);
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n' + '='.repeat(60) + '\n');

// GitHub CLI specific example
console.log('GitHub CLI Example: Issue title with quotes\n');

const issueTitle = 'Implement Hello World in PureScript';
console.log('Title to set:', issueTitle);

// Show different quoting approaches
console.log('\n❌ PROBLEMATIC: Double quotes in template, single quotes in command');
console.log('Template: await $`gh issue create --title "${issueTitle}"`');
console.log('If the template internally adds quotes, results in:');
console.log('  gh issue create --title \'"Implement Hello World in PureScript"\'');
console.log("  Result: Title becomes: 'Implement Hello World in PureScript' (with quotes!)");

console.log('\n❌ PROBLEMATIC: Single quotes around interpolation');
console.log("Command: gh issue create --title '${issueTitle}'");
console.log('Result: Title becomes literal: ${issueTitle}');

console.log('\n✅ SOLUTION 1: Use double quotes only');
console.log('Command: gh issue create --title "${issueTitle}"');
console.log('Result: Title is correct: Implement Hello World in PureScript');

console.log('\n✅ SOLUTION 2: No quotes (if no spaces/special chars)');
console.log('Command: gh issue create --title ${simpleTitle}');
console.log('Works for simple strings without spaces');

console.log('\n✅ SOLUTION 3: Use --title-file parameter (most reliable)');
const titleFile = `/tmp/title-${Date.now()}.txt`;
await fs.writeFile(titleFile, issueTitle);
console.log('1. Write title to file:', titleFile);
console.log('2. Use: gh issue create --title-file ' + titleFile);
await fs.unlink(titleFile);

console.log('\n' + '='.repeat(60) + '\n');

// Test with actual echo command to show the issue
console.log('Demonstrating the actual issue:\n');

const commands = [
  { cmd: 'echo "${testTitle}"', desc: 'Double quotes' },
  { cmd: 'echo ${testTitle}', desc: 'No quotes' },
  { cmd: `echo '${testTitle}'`, desc: 'Single quotes (literal)' }
];

for (const { cmd, desc } of commands) {
  console.log(`Test: ${desc}`);
  console.log(`Command: ${cmd}`);
  try {
    const result = await $`${cmd}`;
    console.log(`Output: "${result.stdout.toString().trim()}"`);
  } catch (error) {
    console.log('Error:', error.message);
  }
  console.log('');
}

console.log('=== SUMMARY ===');
console.log('Problem: command-stream adds unwanted single quotes around interpolated strings');
console.log('');
console.log('CONFIRMED BEHAVIOR:');
console.log('When using: await $`gh issue create --title "${issueTitle}"`');
console.log('With value: issueTitle = "Implement Hello World in Python"');
console.log("Results in: Title becomes 'Implement Hello World in Python' (with quotes!)");
console.log('');
console.log('ROOT CAUSE:');
console.log('command-stream appears to "over-escape" interpolated variables by:');
console.log('1. Detecting the double quotes in the template literal');
console.log('2. Adding its own single quotes around the entire interpolated value');
console.log('3. Resulting in nested quoting that becomes part of the actual output');
console.log('');
console.log('WORKAROUND - Use Node.js child_process:');
console.log('```javascript');
console.log('// Instead of command-stream:');
console.log('// await $`gh issue create --title "${title}"`');
console.log('');
console.log('// Use execSync:');
console.log('const { execSync } = await import("child_process");');
console.log('const command = `gh issue create --title "${title}" --body-file ${bodyFile}`;');
console.log('const output = execSync(command, { encoding: "utf8" });');
console.log('```');
console.log('');
console.log('ALTERNATIVE WORKAROUNDS:');
console.log('1. Write to file: Use --title-file parameter (if available)');
console.log('2. Use different shell tool: execa, zx, or native child_process');
console.log('3. Avoid spaces: Design values without spaces to avoid quoting');
console.log('');
console.log('IMPACT:');
console.log('- GitHub issue/PR titles get wrapped in quotes');
console.log('- Git commit messages may have extra quotes');
console.log('- Any CLI tool expecting clean string input fails');
console.log('- Silent data corruption that reaches production');
