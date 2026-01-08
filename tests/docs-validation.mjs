#!/usr/bin/env node

// Documentation validation test - rewritten from shell script to .mjs format
// Tests file size limits and README structure as required by CI

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const { $ } = await use('command-stream');

// Configuration
const MAX_LINES = 2500;
const REQUIRED_SECTIONS = ['Quick Start', 'Architecture', 'Configuration'];

let errorsFound = 0;

// Helper function to count lines in a file
const countLines = async filePath => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split('\n').length;
  } catch (error) {
    console.error(`❌ ERROR: Could not read ${filePath}: ${error.message}`);
    return 0;
  }
};

// Check file size limits for documentation files
const checkFileSizes = async () => {
  console.log('📏 Checking documentation file size limits...');

  // Check docs directory if it exists
  try {
    const docsDir = 'docs';
    const docsStat = await fs.stat(docsDir);
    if (docsStat.isDirectory()) {
      const files = await fs.readdir(docsDir);
      const markdownFiles = files.filter(file => file.endsWith('.md'));

      for (const file of markdownFiles) {
        const filePath = path.join(docsDir, file);
        const lineCount = await countLines(filePath);

        if (lineCount > MAX_LINES) {
          console.log(`❌ ERROR: ${filePath} has ${lineCount} lines (max ${MAX_LINES})`);
          errorsFound++;
        } else {
          console.log(`✅ OK: ${filePath} (${lineCount} lines)`);
        }
      }
    }
  } catch (error) {
    // docs directory doesn't exist, skip
    console.log('📁 No docs directory found, skipping...');
  }

  // Check README.md
  try {
    const readmePath = 'README.md';
    await fs.stat(readmePath);
    const readmeLines = await countLines(readmePath);

    if (readmeLines > MAX_LINES) {
      console.log(`❌ ERROR: README.md has ${readmeLines} lines (max ${MAX_LINES})`);
      errorsFound++;
    } else {
      console.log(`✅ OK: README.md (${readmeLines} lines)`);
    }
  } catch (error) {
    console.log(`❌ ERROR: README.md not found: ${error.message}`);
    errorsFound++;
  }
};

// Check README structure for required sections
const checkReadmeStructure = async () => {
  console.log('📋 Checking README structure...');

  try {
    const content = await fs.readFile('README.md', 'utf8');

    for (const section of REQUIRED_SECTIONS) {
      if (content.includes(section)) {
        console.log(`✅ ${section} section found`);
      } else {
        console.log(`❌ Missing ${section} section`);
        errorsFound++;
      }
    }
  } catch (error) {
    console.log(`❌ ERROR: Could not read README.md: ${error.message}`);
    errorsFound++;
  }
};

// Main test execution
const runTests = async () => {
  console.log('🚀 Starting documentation validation tests...');

  await checkFileSizes();
  await checkReadmeStructure();

  // Summary
  console.log('\n📊 Test Summary:');
  if (errorsFound === 0) {
    console.log('🎉 All documentation tests passed!');
    process.exit(0);
  } else {
    console.log(`💥 Found ${errorsFound} errors in documentation validation`);
    console.log('📝 Split large files into subdirectories as required');
    process.exit(1);
  }
};

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(error => {
    console.error(`❌ Test execution failed: ${error.message}`);
    process.exit(1);
  });
}

export { runTests, checkFileSizes, checkReadmeStructure };
