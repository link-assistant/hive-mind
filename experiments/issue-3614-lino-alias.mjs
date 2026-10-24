#!/usr/bin/env node
// Finite reproduction of the lino-arguments 0.4 bootstrap alias conflict.
import { parseCliArgumentsWithLino } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig } from '../src/hive.config.lib.mjs';

const parsed = parseCliArgumentsWithLino({
  argv: ['--concurrency', '6'],
  commandName: 'hive',
  lenv: { enabled: false },
  createYargsConfig(parser, getenv) {
    const result = createYargsConfig(parser, getenv);
    const { alias, string, number } = result.getOptions();
    console.log({ configurationAliases: alias.configuration, concurrencyAliases: alias.concurrency, stringAlias: string.includes('c'), numberAlias: number.includes('c') });
    return result;
  },
});
console.log({ concurrency: parsed.concurrency, concurrencyType: typeof parsed.concurrency, configuration: parsed.configuration });
