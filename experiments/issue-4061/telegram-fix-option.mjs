// Checks that Telegram /fix accepts --dependabot-wait-timeout with a value (issue #4061).
// Usage: node experiments/issue-4061/telegram-fix-option.mjs
import * as fix from '../../src/telegram-fix-command.lib.mjs';
const validate = Object.entries(fix).find(([name, value]) => typeof value === 'function' && /validate/i.test(name));
console.log('validator:', validate?.[0]);
for (const text of ['/fix https://github.com/o/r --update-all-dependencies --dependabot-wait-timeout 60', '/fix https://github.com/o/r --update-all-dependencies --dependabot-wait-timeout=0']) {
  const built = fix.buildFixCommandArgs(text);
  console.log(JSON.stringify(built.args ?? built), '=>', JSON.stringify(await validate?.[1](built.args ?? built)));
}
