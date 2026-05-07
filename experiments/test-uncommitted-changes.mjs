#!/usr/bin/env node

// Test script to validate the uncommitted changes detection functionality

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
const fs = await use('fs');
const path = await use('path');

const formatAligned = (icon, label, value, indent = 0) => {
  const spacing = ' '.repeat(indent);
  const iconPart = icon ? `${icon} ` : '  ';
  const labelPart = label ? `${label}: ` : '';
  return `${spacing}${iconPart}${labelPart}${value}`;
};

const log = message => {
  console.log(message);
};

async function testUncommittedChanges() {
  console.log('🧪 Testing uncommitted changes detection...\n');

  // Create a temporary git repository
  const testDir = '/tmp/test-uncommitted-changes';

  try {
    // Clean up any existing test directory
    await $`rm -rf ${testDir}`.catch(() => {});

    // Create test directory and initialize git
    await $`mkdir -p ${testDir}`;
    await $`cd ${testDir} && git init`;
    await $`cd ${testDir} && git config user.name "Test User"`;
    await $`cd ${testDir} && git config user.email "test@example.com"`;

    // Create initial commit
    await fs.promises.writeFile(path.join(testDir, 'README.md'), '# Test Repository');
    await $`cd ${testDir} && git add README.md`;
    await $`cd ${testDir} && git commit -m "Initial commit"`;

    console.log('✅ Created test repository');

    // Create some uncommitted changes
    await fs.promises.writeFile(path.join(testDir, 'newfile.txt'), 'This is a new file');
    await fs.promises.writeFile(path.join(testDir, 'README.md'), '# Test Repository\n\nUpdated content');

    console.log('✅ Created uncommitted changes');

    // Test the detection logic (extracted from solve.mjs)
    console.log('\n🔍 Testing detection logic...');

    const tempDir = testDir; // Use our test directory
    const branchName = 'main'; // Use main branch for test

    // Check git status to see if there are any uncommitted changes
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;

    if (gitStatusResult.code === 0) {
      const statusOutput = gitStatusResult.stdout.toString().trim();

      if (statusOutput) {
        // There are uncommitted changes - log them and commit automatically
        await log(formatAligned('📝', 'Found changes', 'Uncommitted files detected'));

        // Show what files have changes
        const changedFiles = statusOutput
          .split('\n')
          .map(line => line.trim())
          .filter(line => line);
        for (const file of changedFiles) {
          await log(formatAligned('', '', `  ${file}`, 2));
        }

        // Stage all changes
        const gitAddResult = await $({ cwd: tempDir })`git add . 2>&1`;
        if (gitAddResult.code === 0) {
          await log(formatAligned('📦', 'Staged', 'All changes added to git'));

          // Commit with a descriptive message
          const commitMessage = `Auto-commit changes made by Claude

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>`;

          const gitCommitResult = await $({ cwd: tempDir })`git commit -m "${commitMessage}" 2>&1`;
          if (gitCommitResult.code === 0) {
            await log(formatAligned('✅', 'Committed', 'Changes automatically committed'));

            // Check final status
            const finalStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
            if (finalStatusResult.code === 0 && !finalStatusResult.stdout.toString().trim()) {
              await log(formatAligned('✅', 'Verified', 'Repository is now clean'));
            } else {
              await log(formatAligned('⚠️', 'Warning', 'Repository still has uncommitted changes'));
            }
          } else {
            await log(`⚠️ Warning: Could not commit changes: ${gitCommitResult.stderr.toString().trim()}`);
          }
        } else {
          await log(`⚠️ Warning: Could not stage changes: ${gitAddResult.stderr.toString().trim()}`);
        }
      } else {
        await log(formatAligned('✅', 'No changes', 'Repository is clean'));
      }
    } else {
      await log(`⚠️ Warning: Could not check git status: ${gitStatusResult.stderr.toString().trim()}`);
    }

    console.log('\n✅ Test completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    // Clean up
    await $`rm -rf ${testDir}`.catch(() => {});
  }
}

// Run the test
testUncommittedChanges();
