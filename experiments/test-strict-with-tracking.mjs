#!/usr/bin/env node

// Track explicitly defined options to validate against unknown options

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const testArgs = process.argv.slice(2);
console.log(`Testing strict validation with tracking: ${testArgs.join(' ')}\n`);

// Helper to check if a string looks like it was meant to be an option
const looksLikeOption = str => {
  return /^[\u002D\u2010\u2011\u2012\u2013\u2014]+[a-zA-Z]/.test(str);
};

// Track explicitly defined options
const definedOptions = new Set(['help', 'version', '_', '$0']);

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
  });

// Add defined options and their aliases
definedOptions.add('fork');
definedOptions.add('f');
definedOptions.add('verbose');
definedOptions.add('v');

yargsInstance
  .check(argv => {
    const errors = [];

    // Get initial aliases before yargs adds auto-aliases for unknown options
    const aliases = yargsInstance.parsed?.aliases || {};

    // Check argv keys against our explicitly defined options
    for (const key of Object.keys(argv)) {
      if (key === '_' || key === '$0') continue;

      // Check if this key is in our defined options or is a variant (--key, etc.)
      const normalizedKey = key.replace(/^-+/, '');

      if (!definedOptions.has(key) && !definedOptions.has(normalizedKey)) {
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
  })
  .fail((msg, err, yargs) => {
    console.error('❌ Validation Error:');
    console.error(msg);
    process.exit(1);
  });

try {
  const argv = yargsInstance.argv;

  console.log('✅ Parsing succeeded:');
  console.log('   fork:', argv.fork);
  console.log('   verbose:', argv.verbose);
  console.log('   _:', argv._);
} catch (error) {
  console.error('❌ Caught error:', error.message);
  process.exit(1);
}
