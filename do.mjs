#!/usr/bin/env node
// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const yargs = (await use('yargs@latest')).default;

// Configure command line arguments - prompt as positional argument
const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 <prompt>')
  .positional('prompt', {
    type: 'string',
    description: 'The prompt to send to Claude'
  })
  .demandCommand(1, 'The prompt is required')
  .help('h')
  .alias('h', 'help').argv;

const prompt = argv._[0];

const claudePath = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

try {
  const result =
    await $`${claudePath} -p "${prompt}" --output-format stream-json --verbose --dangerously-skip-permissions --append-system-prompt "Code changes should be tested before finishing the work, preferably with automated tests." --model sonnet | jq`;
  console.log(result.text());
} catch (error) {
  console.error('Error executing command:', error.message);
  process.exit(1);
}
