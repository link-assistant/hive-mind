import { parseCliArgumentsWithLino } from '../../src/cli-arguments.lib.mjs';
import { createYargsConfig } from '../../src/hive.config.lib.mjs';

const result = parseCliArgumentsWithLino({
  argv: ['node', 'hive', 'https://github.com/example/repo', '--concurrency', '3'],
  lenv: { enabled: false },
  env: { values: {} },
  createYargsConfig: parser => {
    const configured = createYargsConfig(parser);
    const options = configured.getOptions();
    console.log(JSON.stringify({ alias: options.alias, number: options.number, string: options.string }));
    return configured;
  },
});
console.log(JSON.stringify({ concurrency: result.concurrency, c: result.c, configuration: result.configuration }));
