#!/usr/bin/env node

// Final test: Check for unknown options AND positional args that look like options

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const testArgs = process.argv.slice(2);
console.log(`Testing strict validation: ${testArgs.join(' ')}\n`);

// Helper to check if a string looks like it was meant to be an option
const looksLikeOption = str => {
  // Check for various dash characters (hyphen-minus, en-dash, em-dash, etc.)
  return /^[\u002D\u2010\u2011\u2012\u2013\u2014]+[a-zA-Z]/.test(str);
};

// Helper function to validate options strictly
const createStrictOptionsCheck = yargsInstance => {
  return argv => {
    // Get the parsed options from yargs internal state
    const parsed = yargsInstance.parsed;
    const aliases = parsed?.aliases || {};

    // Build set of all known option keys
    const knownOptions = new Set(['_', '$0']);

    // Add all aliases and their variants
    Object.keys(aliases).forEach(key => {
      knownOptions.add(key);
      if (Array.isArray(aliases[key])) {
        aliases[key].forEach(alias => knownOptions.add(alias));
      }
    });

    const errors = [];

    // Check for unknown options in argv keys
    for (const key of Object.keys(argv)) {
      // Skip special keys
      if (key === '_' || key === '$0') continue;

      // If it's not in known options, it's unknown
      if (!knownOptions.has(key)) {
        // Skip if it starts with -- or - and the base is known
        if (key.startsWith('--') || key.startsWith('-')) {
          const withoutDashes = key.replace(/^-+/, '');
          if (knownOptions.has(withoutDashes)) continue;
        }

        errors.push(`Unknown option: ${key}`);
      }
    }

    // Check for positional arguments that look like options
    if (argv._ && Array.isArray(argv._)) {
      for (const arg of argv._) {
        if (typeof arg === 'string' && looksLikeOption(arg)) {
          errors.push(`Unrecognized option: ${arg}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }

    return true;
  };
};

try {
  const yargsInstance = yargs(testArgs)
    .option('fork', {
      type: 'boolean',
      description: 'Fork the repository',
      alias: 'f',
      default: false,
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging',
      alias: 'v',
      default: false,
    })
    .fail((msg, err, yargs) => {
      console.error('❌ Validation Error:');
      console.error(msg);
      process.exit(1);
    });

  const argv = yargsInstance.argv;
  createStrictOptionsCheck(yargsInstance)(argv);

  console.log('✅ Parsing succeeded:');
  console.log('   fork:', argv.fork);
  console.log('   verbose:', argv.verbose);
  console.log('   _:', argv._);
} catch (error) {
  console.error('❌ Caught error:', error.message);
  process.exit(1);
}
