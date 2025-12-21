#!/usr/bin/env node

// Test automatic extraction of known options for validation

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const testArg = process.argv[2] || '--invalid-option';
console.log(`Testing auto-check for unknown options: ${testArg}\n`);

// Helper function to create a check that validates against defined options
const createStrictOptionsCheck = yargsInstance => {
  return argv => {
    // Get the parsed options from yargs internal state
    const parsed = yargsInstance.parsed;

    // yargs stores aliases in parsed.aliases
    const aliases = parsed?.aliases || {};

    // Build set of all known option keys
    const knownOptions = new Set(['_', '$0']); // Always include special keys

    // Add all aliases and their variants
    Object.keys(aliases).forEach(key => {
      knownOptions.add(key);
      if (Array.isArray(aliases[key])) {
        aliases[key].forEach(alias => knownOptions.add(alias));
      }
    });

    // Check for unknown options in argv
    const unknownOptions = [];
    for (const key of Object.keys(argv)) {
      // Skip if it's a known option or special key
      if (knownOptions.has(key) || key === '_' || key === '$0') continue;

      // Skip if it starts with -- or - (these are alternate representations)
      if (key.startsWith('--') || key.startsWith('-')) {
        // Check if the option without dashes is known
        const withoutDashes = key.replace(/^-+/, '');
        if (knownOptions.has(withoutDashes)) continue;
      }

      unknownOptions.push(key);
    }

    if (unknownOptions.length > 0) {
      throw new Error(`Unknown option(s): ${unknownOptions.join(', ')}`);
    }

    return true;
  };
};

try {
  const yargsInstance = yargs([testArg])
    .option('fork', {
      type: 'boolean',
      description: 'Fork the repository',
      alias: 'f',
      default: false
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging',
      alias: 'v',
      default: false
    })
    .fail((msg, err, yargs) => {
      console.error('❌ Validation Error:');
      console.error(msg);
      process.exit(1);
    });

  // Parse first to populate internal state
  const argv = yargsInstance.argv;

  // Now run the check
  createStrictOptionsCheck(yargsInstance)(argv);

  console.log('✅ Parsing succeeded:');
  console.log('   fork:', argv.fork);
  console.log('   verbose:', argv.verbose);
  console.log('   _:', argv._);
} catch (error) {
  console.error('❌ Caught error:', error.message);
  process.exit(1);
}
