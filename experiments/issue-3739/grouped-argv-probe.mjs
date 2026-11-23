// Finite synthetic probe: yargs accepts grouped short credential options.
import { getLinoYargsFactory } from '../../src/cli-arguments.lib.mjs';
import { createYargsConfig } from '../../src/telegram.config.lib.mjs';
const yargs = getLinoYargsFactory();
const value = 'synthetic-private-value';
for (const args of [
  ['-vt', value],
  ['-vc', value],
]) {
  const config = createYargsConfig(yargs(args)).exitProcess(false).parse();
  console.log(JSON.stringify({ groupedToken: config.token === value, groupedConfiguration: config.configuration === value, verbose: config.verbose }));
}
