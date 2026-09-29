// Reconstruct top-level JSON events from the solve log (pretty-printed JSON blocks after "[INFO] {").
import fs from 'fs';
import readline from 'readline';
const rl = readline.createInterface({ input: fs.createReadStream(process.argv[2]) });
let buf = null,
  ts = null;
const out = [];
for await (const line of rl) {
  const m = line.match(/^\[([^\]]+)\] \[INFO\] (.*)$/);
  if (!m) {
    if (buf) buf.push(line);
    continue;
  }
  const [, t, body] = m;
  if (buf === null && body === '{') {
    buf = ['{'];
    ts = t;
    continue;
  }
  if (buf) {
    buf.push(body);
    if (body === '}') {
      try {
        const d = JSON.parse(buf.join('\n'));
        d.__logTs = ts;
        out.push(d);
      } catch {}
      buf = null;
    }
  }
}
fs.writeFileSync(process.argv[3], out.map(d => JSON.stringify(d)).join('\n'));
console.log('events', out.length);
