#!/usr/bin/env node
// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');
const { getLinoYargsFactory, hideBin, parseCliArgumentsWithLino } = await import('./src/cli-arguments.lib.mjs');

// Configure command line arguments - prompt as positional argument
const createDoYargsConfig = yargsInstance =>
  yargsInstance
    .usage('Usage: $0 <prompt>')
    .command('$0 <prompt>', 'Send a prompt to Claude', yargs =>
      yargs.positional('prompt', {
        type: 'string',
        description: 'The prompt to send to Claude',
      })
    )
    .demandCommand(1, 'The prompt is required')
    .help('h')
    .alias('h', 'help');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const helpYargs = createDoYargsConfig(getLinoYargsFactory()(hideBin(process.argv)));
  helpYargs.showHelp();
  process.exit(0);
}

const argv = parseCliArgumentsWithLino({
  argv: process.argv,
  commandName: 'do.mjs',
  createYargsConfig: createDoYargsConfig,
  positionalAliases: ['prompt'],
});

const prompt = argv.prompt || argv._[0];

const claudePath = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

try {
  const result = await $`${claudePath} -p "${prompt}" --output-format stream-json --verbose --dangerously-skip-permissions --append-system-prompt "Code changes should be tested before finishing the work, preferably with automated tests." --model sonnet | jq`;
  console.log(result.text());
} catch (error) {
  console.error('Error executing command:', error.message);
  process.exit(1);
}
