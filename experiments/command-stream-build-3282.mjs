// Issue #3282: which prompt shapes does command-stream 0.17.2 pass through intact?
import { $ } from 'command-stream';
const show = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
const cases = [`it's \`touch /tmp/x\``, `Issue to solve: it's "quoted" $(echo X) \`touch /tmp/x\``, `a 'b' \`c\``, `no apostrophe \`c\``, `it's fine`];
for (const p of cases) {
  const r = await $({ mirror: false, stdin: '' })`node -e ${show} -- -p ${p} --resume abc`;
  const got = r.stdout ? JSON.parse(r.stdout)[1] : null;
  console.log(got === p ? 'OK  ' : 'FAIL', JSON.stringify(p), '->', JSON.stringify(got), r.stderr.trim());
}
