// Does a failing execFile put its argv — and therefore any secret in it — into
// the error message that callers propagate? (issue #2202 review)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
try {
  await execFileAsync('sh', ['-c', 'exit 3'], { env: { ...process.env, SECRET: 'router-token-abc123' } });
} catch (error) {
  console.log('message:', JSON.stringify(error.message));
}
try {
  await execFileAsync('sh', ['-c', 'echo boom >&2; exit 3'], { encoding: 'utf8' });
} catch (error) {
  console.log('with stderr:', JSON.stringify(error.message));
}
try {
  await execFileAsync('docker', ['exec', '--env', 'ROUTER_CATALOGUE_TOKEN=router-token-abc123', 'nope', 'bun', '-e', '1'], { encoding: 'utf8' });
} catch (error) {
  console.log('docker-shaped:', JSON.stringify(String(error.message).slice(0, 400)));
}
