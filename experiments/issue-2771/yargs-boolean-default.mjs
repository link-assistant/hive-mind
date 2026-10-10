// Shows how the solve parser reports boolean options that have no default
// (`show-thinking-content`) versus `disable-1m-context`: absent, --flag, --no-flag.
import { getLinoYargsFactory } from '../../src/cli-arguments.lib.mjs';
import { createYargsConfig } from '../../src/solve.config.lib.mjs';
import { parseArgsWithYargs } from '../../src/telegram-solve-command.lib.mjs';

const issueUrl = 'https://github.com/link-assistant/hive-mind/issues/2771';
const factory = getLinoYargsFactory();
for (const extra of [[], ['--disable-1m-context'], ['--no-disable-1m-context'], ['--disable-1m-context', 'false'], ['--show-thinking-content']]) {
  const argv = await parseArgsWithYargs([issueUrl, ...extra], factory, createYargsConfig);
  console.log(JSON.stringify(extra).padEnd(40), 'disable1mContext =', argv.disable1mContext, '| showThinkingContent =', argv.showThinkingContent);
}
