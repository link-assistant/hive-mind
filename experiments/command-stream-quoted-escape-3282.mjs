// Issue #3282: what argv does a child get from command-stream when a value
// already escaped with \" is interpolated inside "..."? (claude.lib.mjs:393)
import { $ } from 'command-stream';
const show = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
for (const raw of ['plain', 'say "hi"', 'a\\b', 'cost $5', 'end\\']) {
  const escaped = raw.replace(/"/g, '\\"');
  const r = await $({ mirror: false })`node -e ${show} -- -p "${escaped}"`;
  console.log(JSON.stringify(raw), '->', r.stdout.trim());
}
