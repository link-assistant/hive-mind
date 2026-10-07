// Stop at the bot's first dependency import, before network access or Telegram.
import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('/src/lib.mjs')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          import { readFileSync } from 'node:fs';
          export const maskToken = () => '';
          export const setupStdioLogInterceptor = () => {};
          let timer;
          if (process.env.HIVE_MIND_ARGV_PROBE_HOLD === 'true') {
            timer = setTimeout(() => process.exit(99), 5000);
            process.on('SIGTERM', () => { clearTimeout(timer); process.exit(23); });
          }
          console.log(JSON.stringify({
            pid: process.pid,
            argv: process.argv,
            execArgv: process.execArgv,
            cmdline: readFileSync('/proc/self/cmdline', 'utf8'),
            transportPresent: Object.keys(process.env).some(key => key.startsWith('HIVE_MIND_TELEGRAM_ARGV')),
          }));
          if (!timer) process.exit(Number(process.env.HIVE_MIND_ARGV_PROBE_EXIT_CODE || 0));
        `,
      };
    }
    return nextLoad(url, context);
  },
});
