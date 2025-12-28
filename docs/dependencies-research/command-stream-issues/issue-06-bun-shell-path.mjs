#!/usr/bin/env node
/**
 * Issue #6: Bun runtime shell path issues
 *
 * Problem: Bun has issues with /bin/sh path, especially when it's a symlink
 * Solution: Use Node.js for scripts that heavily rely on shell commands
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
const fs = (await import('fs')).promises;

console.log('=== Issue #6: Bun Runtime Shell Path Issues ===\n');

// Detect runtime
const runtime = process.versions.bun ? 'Bun' : 'Node.js';
const runtimeVersion = process.versions.bun || process.version;

console.log('Current Runtime:', runtime, runtimeVersion);
console.log('Platform:', process.platform);
console.log('');

// Check shell configuration
console.log('Shell Configuration:');
try {
  // Check /bin/sh
  const binShResult = await $`ls -la /bin/sh`;
  console.log('/bin/sh:', binShResult.stdout.toString().trim());
} catch (error) {
  console.log('/bin/sh: Not found or inaccessible');
}

try {
  // Check /usr/bin/sh
  const usrBinShResult = await $`ls -la /usr/bin/sh`;
  console.log('/usr/bin/sh:', usrBinShResult.stdout.toString().trim());
} catch (error) {
  console.log('/usr/bin/sh: Not found or inaccessible');
}

try {
  // Check SHELL environment variable
  console.log('$SHELL:', process.env.SHELL || '(not set)');
} catch (error) {
  console.log('Could not read SHELL env var');
}

console.log('\n' + '='.repeat(60) + '\n');

// Test basic shell command
console.log('Testing Basic Shell Commands:\n');

const testCommands = [
  { cmd: 'echo "Hello, World!"', desc: 'Simple echo' },
  { cmd: 'pwd', desc: 'Print working directory' },
  { cmd: 'date', desc: 'Current date' },
  { cmd: 'which sh', desc: 'Find sh location' },
];

for (const { cmd, desc } of testCommands) {
  console.log(`Test: ${desc}`);
  console.log(`Command: ${cmd}`);
  try {
    const result = await $`${cmd}`;
    console.log('✓ Success:', result.stdout.toString().trim());
  } catch (error) {
    console.log('✗ Failed:', error.message);
    if (error.code === 'ENOENT') {
      console.log('  Error: ENOENT - Shell not found');
      console.log('  This is the Bun shell path issue!');
    }
  }
  console.log('');
}

console.log('='.repeat(60) + '\n');

// Demonstrate the specific Bun issue
if (runtime === 'Bun') {
  console.log('❌ BUN-SPECIFIC ISSUE DETECTED\n');
  console.log('Error Details:');
  console.log('  - Bun.spawn fails with ENOENT for /bin/sh');
  console.log('  - This happens when /bin/sh is a symlink');
  console.log('  - Common on systems where /bin/sh -> dash or bash');
  console.log('');
  console.log('Error Message:');
  console.log("  ENOENT: no such file or directory, posix_spawn '/bin/sh'");
  console.log('');
} else {
  console.log('✅ Running with Node.js - No shell path issues\n');
}

console.log('='.repeat(60) + '\n');

// Solutions
console.log('✅ SOLUTIONS:\n');

console.log('SOLUTION 1: Force Node.js execution');
console.log('  Instead of: ./script.mjs');
console.log('  Use: node ./script.mjs');
console.log('');

console.log('SOLUTION 2: Modify shebang to prefer Node.js');
console.log('  Current shebang:');
console.log('    #!/usr/bin/env sh');
console.log('    \':\' //# ; exec "$(command -v bun || command -v node)" "$0" "$@"');
console.log('  Change to:');
console.log('    #!/usr/bin/env sh');
console.log('    \':\' //# ; exec "$(command -v node || command -v bun)" "$0" "$@"');
console.log('');

console.log('SOLUTION 3: Use fs operations instead of shell commands');
console.log('  Replace shell commands with Node.js fs/path operations');
console.log('  This avoids the shell entirely');
console.log('');

console.log('SOLUTION 4: Check runtime and handle accordingly');
console.log(`  if (process.versions.bun) {
    // Use fs operations or handle differently
    console.log('Running with Bun - using fs operations');
    await fs.writeFile(file, content);
  } else {
    // Safe to use shell commands with Node.js
    await $\`echo "\${content}" > \${file}\`;
  }`);

console.log('\n=== SUMMARY ===');
console.log("Problem: Bun has issues spawning /bin/sh when it's a symlink");
console.log('Impact: Shell commands fail with ENOENT error');
console.log('Best Practice: Use Node.js for shell-heavy scripts');
console.log('Alternative: Replace shell operations with fs operations');
console.log('Detection: Check process.versions.bun to detect runtime');
