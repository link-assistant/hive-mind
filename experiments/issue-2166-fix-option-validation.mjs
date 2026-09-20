import { buildFixCommandArgs, validateFixCommandOptions } from '../src/telegram-fix-command.lib.mjs';
for (const text of ['/fix https://github.com/o/r --ci-cd', '/fix o/r —ci-de', '/fix o/r --think medium', '/fix o/r —think medium', '/fix o/r --tool codex --model gpt-5.5', '/fix o/r --no-solve --dry-run', '/fix o/r --verbose --attach-logs']) {
  const built = buildFixCommandArgs(text);
  console.log(JSON.stringify(text), '->', JSON.stringify(built.args), '=>', await validateFixCommandOptions(built.args));
}
