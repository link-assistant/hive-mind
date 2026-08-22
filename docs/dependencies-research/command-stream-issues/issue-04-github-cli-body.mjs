#!/usr/bin/env node
/**
 * Issue #4: GitHub CLI with complex markdown body
 *
 * Problem: gh issue create fails with complex markdown containing backticks and special chars
 * Solution: Use --body-file parameter instead of --body
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
const fs = (await import('fs')).promises;

console.log('=== Issue #4: GitHub CLI with Complex Markdown Body ===\n');

const complexIssueBody = `## Task
Please implement a "Hello World" program in JavaScript.

## Requirements
1. Create a file with appropriate extension
2. The program should print exactly: \`Hello, World!\`
3. Add clear comments explaining the code
4. Follow JavaScript best practices

## Code Example
\`\`\`javascript
// This is how the program should look:
function main() {
  const message = "Hello, World!";
  console.log(\`Output: \${message}\`);
}

main();
\`\`\`

## Expected Output
When running the program:
\`\`\`bash
$ node hello.js
Hello, World!
\`\`\`

## GitHub Actions Requirements
The CI/CD workflow should:
- Trigger on \`push\` to main and on \`pull_request\`
- Set up Node.js environment
- Run the program with: \`node hello.js\`
- Verify output contains "Hello, World!"

## Special Characters Test
- Dollar signs: $100, $\{variable\}
- Quotes: "double", 'single', \`backtick\`
- Escapes: \\n, \\t, \\\\
- Unicode: 你好世界 🌍 émojis

## Definition of Done
- [ ] Program file created
- [ ] Code prints "Hello, World!" exactly
- [ ] GitHub Actions workflow passing`;

console.log('Issue body preview (first 300 chars):');
console.log('---');
console.log(complexIssueBody.substring(0, 300) + '...');
console.log('---');
console.log('Total length:', complexIssueBody.length, 'characters\n');

// Demonstrate the problem
console.log('❌ PROBLEMATIC APPROACH: Using --body parameter directly');
console.log('Command would be: gh issue create --body "${complexIssueBody}"');
console.log('This would fail due to:');
console.log('  - Backticks in markdown code blocks');
console.log('  - Dollar signs with curly braces');
console.log('  - Mixed quote types');
console.log('  - Shell variable expansion attempts');
console.log('  - Multi-line content');

console.log('\n' + '='.repeat(60) + '\n');

// Solution: Use --body-file
console.log('✅ SOLUTION: Using --body-file parameter');

async function createIssueWithBodyFile(repoUrl, title, body) {
  try {
    // Step 1: Write body to temp file
    const bodyFile = `/tmp/issue-body-${Date.now()}.md`;
    console.log(`Step 1: Writing body to temp file: ${bodyFile}`);
    await fs.writeFile(bodyFile, body);

    // Step 2: Verify file was written correctly
    const verification = await fs.readFile(bodyFile, 'utf8');
    console.log(`Step 2: Verified file (${verification.length} chars written)`);

    // Step 3: Use gh issue create with --body-file
    console.log(`Step 3: Command: gh issue create --repo ${repoUrl} --title "${title}" --body-file ${bodyFile}`);

    // This would be the actual command (commented out to avoid creating real issues)
    // const result = await $`gh issue create --repo ${repoUrl} --title "${title}" --body-file ${bodyFile}`;

    console.log('Step 4: (Would execute gh command here)');

    // Step 5: Clean up temp file
    console.log(`Step 5: Cleaning up temp file`);
    await fs.unlink(bodyFile);

    console.log('✅ Success: Issue would be created without escaping issues');
    return true;
  } catch (error) {
    console.log('ERROR:', error.message);
    return false;
  }
}

// Demonstrate the solution
await createIssueWithBodyFile('https://github.com/owner/repo', 'Implement Hello World in JavaScript', complexIssueBody);

console.log('\n' + '='.repeat(60) + '\n');

// Alternative: Using stdin
console.log('✅ ALTERNATIVE: Using stdin (if supported)');
console.log('Some CLI tools accept stdin input:');
console.log('echo "${body}" | gh issue create --body-file -');
console.log('Note: The dash (-) tells the tool to read from stdin');

console.log('\n=== SUMMARY ===');
console.log('Problem: Complex markdown breaks --body parameter');
console.log('Solution: Always use --body-file with gh issue create');
console.log('Steps:');
console.log('  1. Write body content to temp file');
console.log('  2. Use --body-file parameter');
console.log('  3. Clean up temp file after use');
console.log('Benefits:');
console.log('  - No escaping issues');
console.log('  - Handles any content complexity');
console.log('  - Works with all special characters');
