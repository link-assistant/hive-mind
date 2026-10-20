// Does command-stream's `$` throw on a non-zero exit, or resolve with { code }?
// This decides whether ghWithRateLimitRetry (which only retries on a *throw*)
// can ever retry a `$\`gh ...\`` call made through wrapDollarWithGhRetry.
if (typeof globalThis.use === 'undefined') globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const { $ } = await use('command-stream@2.4.0');
try {
  const r = await $({ mirror: false })`sh -c 'echo boom >&2; exit 3'`;
  console.log('resolved', { code: r.code, stderr: String(r.stderr).trim() });
} catch (e) {
  console.log('threw', { code: e.code, message: e.message });
}
