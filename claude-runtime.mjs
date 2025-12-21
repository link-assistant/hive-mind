#!/usr/bin/env node
/**
 * Claude Runtime Switcher
 *
 * Experimental tool to switch Claude CLI between Node.js and Bun runtime.
 * This modifies the Claude CLI script's shebang line to use either node or bun.
 *
 * Usage:
 *   ./claude-runtime.mjs --to-bun    # Switch Claude to use Bun
 *   ./claude-runtime.mjs --to-node   # Switch Claude to use Node.js
 *   ./claude-runtime.mjs --status    # Check current runtime
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

// Import Claude library functions
const claudeLib = await import('./claude.lib.mjs');
const { handleClaudeRuntimeSwitch } = claudeLib;

// Configure command line arguments
const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [options]')
  .option('to-bun', {
    type: 'boolean',
    description: 'Switch Claude CLI to run with Bun instead of Node.js',
    conflicts: ['to-node']
  })
  .option('to-node', {
    type: 'boolean',
    description: 'Switch Claude CLI to run with Node.js instead of Bun',
    conflicts: ['to-bun']
  })
  .option('status', {
    type: 'boolean',
    description: 'Check current Claude runtime configuration'
  })
  .help('h')
  .alias('h', 'help')
  .strict().argv;

// Main execution
async function main() {
  // Translate options to match what handleClaudeRuntimeSwitch expects
  const options = {
    'force-claude-bun-run': argv.toBun,
    'force-claude-nodejs-run': argv.toNode
  };

  if (argv.status) {
    // Check current status
    const { execSync } = await import('child_process');
    const { $ } = await use('command-stream');

    try {
      // Find Claude CLI location
      const whichResult = await $`which claude`;
      let claudePath = '';
      for await (const chunk of whichResult.stream()) {
        if (chunk.type === 'stdout') {
          claudePath = chunk.data.toString().trim();
        }
      }

      if (!claudePath) {
        console.log('❌ Claude CLI not found in PATH');
        process.exit(1);
      }

      console.log(`📍 Claude CLI location: ${claudePath}`);

      // Read the shebang line
      const fs = (await use('fs')).promises;
      const content = await fs.readFile(claudePath, 'utf8');
      const firstLine = content.split('\n')[0];

      console.log(`📜 Shebang line: ${firstLine}`);

      if (firstLine.includes('bun')) {
        console.log('🚀 Current runtime: Bun');
      } else if (firstLine.includes('node')) {
        console.log('🟢 Current runtime: Node.js');
      } else {
        console.log('❓ Current runtime: Unknown');
      }

      // Check if runtimes are available
      try {
        execSync('which bun', { stdio: 'ignore' });
        console.log('✅ Bun is available');
      } catch {
        console.log('❌ Bun is not installed');
      }

      try {
        execSync('which node', { stdio: 'ignore' });
        console.log('✅ Node.js is available');
      } catch {
        console.log('❌ Node.js is not installed');
      }
    } catch (error) {
      console.error(`Error checking status: ${error.message}`);
      process.exit(1);
    }
  } else if (argv.toBun || argv.toNode) {
    // Perform runtime switch
    await handleClaudeRuntimeSwitch(options);

    if (argv.toBun) {
      console.log('\n✅ Claude CLI has been switched to Bun runtime');
      console.log('   You can now use Claude with improved performance');
      console.log('   To switch back, run: ./claude-runtime.mjs --to-node');
    } else {
      console.log('\n✅ Claude CLI has been restored to Node.js runtime');
      console.log('   This is the default and most compatible configuration');
      console.log('   To switch to Bun, run: ./claude-runtime.mjs --to-bun');
    }
  } else {
    // No action specified
    console.log('Claude Runtime Switcher - Experimental Tool\n');
    console.log('Usage:');
    console.log('  ./claude-runtime.mjs --to-bun    # Switch to Bun runtime');
    console.log('  ./claude-runtime.mjs --to-node   # Switch to Node.js runtime');
    console.log('  ./claude-runtime.mjs --status    # Check current runtime\n');
    console.log('⚠️  WARNING: This is experimental and may break Claude CLI');
    console.log('   Always keep a backup or know how to reinstall Claude');
  }
}

// Run main function
main().catch(error => {
  console.error(`❌ Error: ${error.message}`);
  process.exit(1);
});
