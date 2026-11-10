// Subprocess regression fixture: inspect the real OS command line after execve.
import { readFileSync } from 'node:fs';
import { moveTelegramSecretsOffArgv } from '../../src/telegram-private-configuration.lib.mjs';
moveTelegramSecretsOffArgv({ warn: () => {} });
const value = process.env.HIVE_MIND_TELEGRAM_CLI_CONFIGURATION || process.env.HIVE_MIND_TELEGRAM_CLI_TOKEN;
const cmdline = process.platform === 'linux' ? readFileSync('/proc/self/cmdline', 'utf8') : process.argv.join('\0');
console.log(JSON.stringify({ privateArgv: !!value && !cmdline.includes(value) && !cmdline.includes('ghp_') }));
