// Start native browser challenges with a clean home and no TTY. Cancel after
// seeing the prompt so this probe requires no account and saves no credential.
import { spawn } from 'node:child_process';
import console from 'node:console';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const manager = fileURLToPath(new URL('../../src/hive-manager/cli.sh', import.meta.url));
const challenges = {
  claude: /https:\/\/[^\s]+\s+Paste code here/i,
  codex: /https:\/\/auth\.openai\.com\/codex\/device\b[\s\S]*?\b[A-Z0-9]{3,}-[A-Z0-9]{3,}\b/u,
  github: /one-time code:\s*[\s\S]*?\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/i,
};

const providers = process.argv.slice(2);
for (const provider of providers.length ? providers : Object.keys(challenges)) {
  if (!Object.hasOwn(challenges, provider)) throw new Error('Choose claude, codex or github');
  const home = mkdtempSync(join(tmpdir(), 'hive-login-probe-'));
  try {
    const env = {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CODEX_HOME: join(home, '.codex'),
      GH_CONFIG_DIR: join(home, '.config', 'gh'),
      GIT_CONFIG_GLOBAL: join(home, '.gitconfig'),
      XDG_CONFIG_HOME: join(home, '.config'),
      BROWSER: '/bin/false',
    };
    for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_DEBUG', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OPENAI_API_KEY', 'CODEX_ACCESS_TOKEN']) {
      delete env[key];
    }
    mkdirSync(env.CODEX_HOME, { mode: 0o700 });
    const child = spawn(manager, ['auth', provider], { env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let tail = '';
    let reached = false;
    const stop = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const deadline = setTimeout(stop, 25000);
    const inspect = chunk => {
      // Keep the URL and one-time code in memory only.
      tail = (tail + chunk).slice(-16384);
      if (!reached && challenges[provider].test(stripVTControlCharacters(tail))) {
        reached = true;
        stop();
      }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    try {
      const code = await new Promise((resolve, reject) => {
        child.once('close', resolve);
        child.once('error', reject);
      });
      if (!reached) {
        const refused = tail.match(/\b(?:device code login|device auth(?:entication|orization))\b.{0,100}\b(?:disabled|not enabled|not allowed)\b/i);
        const http = tail.match(/\b(?:403|429|502|503)\b/u);
        const error = refused ? 'device authorization unavailable' : http ? 'HTTP ' + http[0] : 'exit ' + (code ?? 'after cancellation or deadline');
        console.error(provider + ': did not receive a browser challenge (' + error + ')');
        if (provider === 'codex') {
          console.error('codex markers: device URL=' + tail.includes('auth.openai.com/codex/device') + ', device instructions=' + /one.time code|device code/i.test(tail) + ', network error=' + /network|connection|timed out/i.test(tail));
        }
        process.exitCode = 1;
      } else {
        console.log(provider + ': showed the browser challenge without a TTY');
      }
    } finally {
      clearTimeout(deadline);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
