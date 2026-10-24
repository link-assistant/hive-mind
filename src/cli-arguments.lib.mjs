import { getenv, makeConfig, yargs as linoYargs } from 'lino-arguments';

import { normalizeCliArgs } from './argument-normalization.lib.mjs';
import { enhanceUnknownArgumentError } from './option-suggestions.lib.mjs';
import { enhanceArgumentError } from './input-diagnostics.lib.mjs';

export { getenv };
export { normalizeCliArgs, normalizeTypographicOptionDashes, splitJoinedGitHubLongOptionArg } from './argument-normalization.lib.mjs';

export const hideBin = argv => argv.slice(2);

export const getLinoYargsFactory = () => linoYargs;

const toKebabCase = key =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();

const toCamelCase = key => key.replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ''));

const ensureFullArgv = (argv, commandName) => {
  if (argv.length >= 2 && (argv[0].includes('/') || argv[0] === 'node' || argv[0].endsWith('node'))) {
    return argv;
  }
  return ['node', commandName, ...argv];
};

export function addCliCompatibilityAliases(parsed, { positionalAliases = [] } = {}) {
  const result = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined) continue;
    result[key] = value;
  }

  for (const [key, value] of Object.entries(result)) {
    const kebabKey = toKebabCase(key);
    if (kebabKey && result[kebabKey] === undefined) {
      result[kebabKey] = value;
    }
  }

  const positionalValues = [];
  for (const alias of positionalAliases) {
    const camelAlias = toCamelCase(alias);
    const value = result[alias] ?? result[camelAlias];
    if (value !== undefined) {
      result[alias] = value;
      result[camelAlias] = value;
      positionalValues.push(value);
    }
  }
  result._ = positionalValues;

  return result;
}

export function parseCliArgumentsWithLino({ argv = process.argv, commandName = 'cli', createYargsConfig, positionalAliases = [], lenv = { enabled: true }, env = { enabled: false }, getenv: getenvOptions = { enabled: true } } = {}) {
  const fullArgv = normalizeCliArgs(ensureFullArgv(argv, commandName));
  // lino-arguments reads -c as a configuration path before invoking our
  // schema. Hive has always used it for concurrency: expand it before that
  // first pass, preserving --configuration and arguments after --.
  if (commandName === 'hive') {
    for (let index = 2; index < fullArgv.length && fullArgv[index] !== '--'; index++) {
      if (fullArgv[index] === '-c') fullArgv[index] = '--concurrency';
      else if (/^-c=?[+-]?\d/.test(fullArgv[index])) fullArgv[index] = `--concurrency=${fullArgv[index].slice(2).replace(/^=/, '')}`;
    }
  }
  let configuredParser = null;
  let parsed;

  try {
    parsed = makeConfig({
      argv: fullArgv,
      lenv,
      env,
      getenv: getenvOptions,
      yargs: ({ yargs, getenv: getenvHelper }) => {
        const parser = yargs.exitProcess(false);
        configuredParser = createYargsConfig ? createYargsConfig(parser, getenvHelper) : parser;
        // lino-arguments supplies -c for configuration. Hive already owns -c
        // for concurrency; keep the application's alias and the explicit
        // --configuration option without registering two owners (0.4+).
        const options = configuredParser.getOptions();
        const aliases = options.alias;
        const owner = Object.entries(aliases).find(([key, names]) => key !== 'configuration' && names.includes('c'));
        if (owner) {
          aliases.configuration = (aliases.configuration || []).filter(name => name !== 'c');
          // yargs propagates the built-in string type to -c when registering
          // it. Drop that type too when the application owns a numeric flag.
          if (!options.string.includes(owner[0])) options.string = options.string.filter(name => name !== 'c');
        }
        return configuredParser.exitProcess(false);
      },
    });
  } catch (error) {
    throw enhanceArgumentError(enhanceUnknownArgumentError(error, configuredParser), fullArgv.slice(2));
  }

  return addCliCompatibilityAliases(parsed, { positionalAliases });
}
