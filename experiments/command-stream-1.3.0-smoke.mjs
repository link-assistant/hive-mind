// Smoke check: the pinned command-stream loads through use-m (as src/ does) and runs a quoted command.
import { useWithRetry } from '../src/use-with-retry.lib.mjs';
if (typeof globalThis.use === 'undefined') globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const { $ } = await useWithRetry(globalThis.use, 'command-stream');
const arg = 'it\'s a "quoted" $HOME value';
const result = await $({ mirror: false })`printf '%s' ${arg}`;
console.log(typeof result.stdout, JSON.stringify(String(result.stdout)), String(result.stdout) === arg ? 'OK' : 'MISMATCH');
