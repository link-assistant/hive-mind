// Issue #3282: bisect which -p / --append-system-prompt pair command-stream 0.17.2 mis-executes (fixed upstream: agent-commander 0.11.1 moved to command-stream 2.4.0).
// Usage: node experiments/command-stream-exec-bisect-3282.mjs [path to a command-stream src/$.mjs]
// (default: node_modules/agent-commander/node_modules/command-stream, the 0.17.2 copy agent-commander 0.11.0 installed; pass a path once it is gone).
const { $ } = await import(process.argv[2] || new URL('../node_modules/agent-commander/node_modules/command-stream/src/$.mjs', import.meta.url).href);
const show = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
const sys = `Use the 'file' command; a | b & c`;
const cases = [
  [`it's "quoted"`, 'sys'],
  [`it's "quoted"`, sys],
  [`it's`, sys],
  [`"quoted"`, sys],
  [`plain words`, sys],
  [`plain words`, `x 'y'`],
  [`it's`, `x 'y'`],
  [`it's`, `x y`],
];
for (const [p, s] of cases) {
  const r = await $({ mirror: false, stdin: '' })`node -e ${show} -- -p ${p} --append-system-prompt ${s}`;
  let got = null;
  try {
    got = JSON.parse(r.stdout);
  } catch {}
  const ok = got && got[1] === p && got[3] === s;
  console.log(ok ? 'OK  ' : 'FAIL', JSON.stringify([p, s]), ok ? '' : JSON.stringify(got) + ' ' + String(r.stderr).trim());
}
