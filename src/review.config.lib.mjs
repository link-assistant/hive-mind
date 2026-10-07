import { SOLVE_OPTION_DEFINITIONS, normalizeAndValidateThink, detectMalformedFlags } from './solve.config.lib.mjs';
import { defaultModels, buildModelOptionDescription, resolveDefaultFallbackModel, resolveRuntimeDefaultModel } from './models/index.mjs';
import { normalizeCliArgs, parseCliArgumentsWithLino } from './cli-arguments.lib.mjs';

// Share tool controls, without importing solve's code-writing workflow flags.
export const REVIEW_SHARED_OPTIONS = Object.freeze(['tool', 'resume', 'working-directory', 'verbose', 'log-dir', 'think', 'thinking-budget', 'max-thinking-budget', 'thinking-budget-claude-minimum-version', 'rollout-token-budget', 'sub-session-size', 'disable-1m-context', 'fallback-model', 'sub-agent-model', 'show-thinking-content', 'execute-tool-with-bun', 'use-agent-commander', 'use-router', 'playwright-mcp', 'useless-tools-disabled', 'agent-memory-disabled', 'auxiliary-model-calls-disabled', 'detect-repeated-tool-calls', 'repeated-tool-call-limit', 'language', 'ui-language', 'work-language', 'gemini-sandbox', 'gemini-extensions', 'gemini-include-directories', 'gemini-allowed-mcp-servers', 'require-codex-plugin']);

export const createYargsConfig = yargs => {
  let config = yargs.usage('Usage: review <pr-url> [options]').command('$0 <pr-url>', 'Review a GitHub pull request without coding', command => command.positional('pr-url', { type: 'string', description: 'GitHub pull request URL' }));
  for (const name of REVIEW_SHARED_OPTIONS) {
    if (name !== 'tool') config = config.option(name, SOLVE_OPTION_DEFINITIONS[name]);
  }
  return config
    .option('tool', { ...SOLVE_OPTION_DEFINITIONS.tool, description: 'AI tool to use for reviewing the pull request' })
    .option('model', { type: 'string', alias: 'm', description: buildModelOptionDescription() })
    .option('focus', { type: 'string', alias: 'f', default: 'all', description: 'Review focus: security, performance, logic, style, tests, or all' })
    .option('approve', { type: 'boolean', default: false, description: 'Approve when no blocking problems are found; otherwise submit a comment recommending approval' })
    .option('dry-run', { type: 'boolean', alias: 'n', default: false, description: 'Prepare the checkout and review prompts without running an AI tool or posting feedback' })
    .option('only-prepare-command', { type: 'boolean', description: 'Prepare the checkout and review prompts without executing the AI tool' })
    .check(argv => {
      argv.model ||= defaultModels[argv.tool] || defaultModels.claude;
      normalizeAndValidateThink(argv);
      return true;
    })
    .parserConfiguration({ 'boolean-negation': true })
    .strict()
    .help('h')
    .alias('h', 'help');
};

const hasOption = (args, names) => args.some(arg => names.some(name => arg === name || arg.startsWith(`${name}=`)));

export async function parseReviewArguments(args = process.argv.slice(2)) {
  const rawArgs = normalizeCliArgs(args);
  const malformed = detectMalformedFlags(rawArgs);
  if (malformed.malformed.length) throw new Error(malformed.errors.join('\n'));
  const argv = parseCliArgumentsWithLino({ argv: [process.execPath, 'review', ...rawArgs], commandName: 'review', createYargsConfig, positionalAliases: ['pr-url'] });
  if (!hasOption(rawArgs, ['--model', '-m'])) argv.model = await resolveRuntimeDefaultModel(argv.tool);
  if (!hasOption(rawArgs, ['--think']) && hasOption(rawArgs, ['--thinking-budget'])) argv.think = undefined;
  if (!hasOption(rawArgs, ['--fallback-model'])) argv.fallbackModel = resolveDefaultFallbackModel(argv.tool, argv.model);
  argv._fallbackModelExplicit = hasOption(rawArgs, ['--fallback-model']);
  argv.originalModel = argv.model;
  argv.url = argv['pr-url'] || argv.prUrl || argv._?.[0];
  return argv;
}
