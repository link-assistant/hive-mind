import { buildModelOptionDescription, defaultModels } from './models/index.mjs';

export const TASK_TOOL_CHOICES = ['claude', 'codex', 'opencode', 'agent'];

export function getDefaultTaskModel(tool) {
  return defaultModels[tool] || defaultModels.claude;
}

export const createYargsConfig = yargsInstance =>
  yargsInstance
    .usage('Usage: task.mjs <task-description> [options]')
    .command('$0 <task-input>', 'Clarify, decompose, or split a task', yargs => {
      yargs.positional('task-input', {
        type: 'string',
        description: 'GitHub issue URL for --split, or a task description for clarify/decompose mode',
      });
    })
    .option('clarify', {
      type: 'boolean',
      description: 'Enable clarification mode',
      default: true,
    })
    .option('decompose', {
      type: 'boolean',
      description: 'Enable decomposition mode',
      default: true,
    })
    .option('only-clarify', {
      type: 'boolean',
      description: 'Only run clarification mode',
      default: false,
    })
    .option('only-decompose', {
      type: 'boolean',
      description: 'Only run decomposition mode',
      default: false,
    })
    .option('split', {
      type: 'boolean',
      description: 'Split a GitHub issue into smaller GitHub issues',
      default: false,
    })
    .option('split-count', {
      type: 'number',
      description: 'Number of issues to split into',
      default: 2,
    })
    .option('tool', {
      type: 'string',
      description: 'AI tool to use through agent-commander read-only mode',
      choices: TASK_TOOL_CHOICES,
      default: 'claude',
    })
    .option('model', {
      type: 'string',
      description: buildModelOptionDescription(),
      alias: 'm',
    })
    .option('isolation', {
      type: 'string',
      description: 'agent-commander isolation mode',
      choices: ['screen', 'none', 'docker'],
      default: 'screen',
    })
    .option('screen-name', {
      type: 'string',
      description: 'Screen session name when --isolation screen is used',
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Print planned split issues without creating or linking GitHub issues',
      default: false,
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging',
      alias: 'v',
      default: false,
    })
    .option('output-format', {
      type: 'string',
      description: 'Output format',
      alias: 'o',
      choices: ['text', 'json'],
      default: 'text',
    })
    .check(argv => {
      if (!argv['task-input'] && !argv._[0]) {
        throw new Error('Please provide a GitHub issue URL or task description');
      }
      if (argv['only-clarify'] && argv['only-decompose']) {
        throw new Error('Cannot use both --only-clarify and --only-decompose at the same time');
      }
      if (argv.split && (argv['only-clarify'] || argv['only-decompose'])) {
        throw new Error('Cannot use --split with --only-clarify or --only-decompose');
      }
      if (argv.split && argv['split-count'] < 2) {
        throw new Error('--split-count must be at least 2');
      }
      if (argv['only-clarify']) argv.decompose = false;
      if (argv['only-decompose']) argv.clarify = false;
      if (argv.split) {
        argv.clarify = false;
        argv.decompose = false;
      }
      return true;
    })
    .parserConfiguration({
      'boolean-negation': true,
    })
    .strict()
    .help('h')
    .alias('h', 'help');
