#!/usr/bin/env node

const { use } = eval(await fetch('https://unpkg.com/use-m/use.js').then(u => u.text()));

const { $ } = await use('command-stream');
const { makeConfig } = await use('lino-arguments');
const fs = await import('node:fs');

const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .version(false)
      .help(false)
      .option('image-variant', {
        choices: ['dind', 'plain'],
        // Default is 'dind' (konard/hive-mind-dind:1.74.3+ on box-dind 2.1.4+),
        // which gives the bot access to a nested Docker daemon for isolated
        // workloads while keeping docker-exec UX parity with the plain image
        // (link-foundation/box#88 and link-assistant/hive-mind#1850 shipped).
        default: getenv('HIVE_MIND_IMAGE_VARIANT') || 'dind',
        description: 'Image flavor: "dind" (konard/hive-mind-dind, default, needs --privileged) or "plain" (konard/hive-mind)',
      })
      .option('image', {
        type: 'string',
        default: getenv('HIVE_MIND_IMAGE') || '',
        description: 'Override the image reference; takes precedence over --image-variant',
      })
      .option('reset-docker', {
        type: 'boolean',
        default: false,
        description: 'DANGEROUS: remove ALL Docker containers, images, volumes, networks, and build cache on the host before deploying. Use this for a full clean slate.',
      })
      .option('keep-inactive-variant', {
        type: 'boolean',
        default: false,
        description: "Skip the default behavior of removing the other hive-mind variant's image(s). Off by default; the script removes konard/hive-mind* tags that do not match the active variant to reclaim disk.",
      })
      .option('verbose', { type: 'boolean', default: false, description: 'Enable verbose debug output' })
      .option('dangerously-show-secrets', { type: 'boolean', default: false, description: 'Show secret values in debug output' }),
});

const VERBOSE = config.verbose;
const SHOW_SECRETS = config.dangerouslyShowSecrets;

const log = (...args) => {
  if (VERBOSE) console.log('[DEBUG]', ...args);
};

const CONTAINER = 'hive-mind';

// Per-variant settings. Both images default USER to box and run user-level
// tools out of /home/box. The dind image additionally runs an inner dockerd
// (launched by /usr/local/bin/dind-entrypoint.sh via scoped NOPASSWD sudo)
// and so needs --privileged on `docker run`.
const VARIANTS = {
  dind: {
    image: 'konard/hive-mind-dind:latest',
    runFlags: '--privileged',
    // Suppress dockerd inside the setup container. The committed image is
    // built off this container's filesystem; we do not want a running dockerd
    // writing partial state to /var/lib/docker before commit.
    tempEnvFlags: '-e DIND_SKIP_DAEMON=1',
    // -e DIND_SKIP_DAEMON=0 is belt-and-suspenders: `docker commit` carries
    //   over container ENV, so DIND_SKIP_DAEMON=1 from the temp container
    //   would silently disable dockerd on the final container otherwise.
    //   We also pass --change "ENV DIND_SKIP_DAEMON=0" at commit time below.
    // DIND_STORAGE_DRIVER intentionally NOT set: since box 2.1.4 the
    //   entrypoint auto-picks the best available driver (overlay2 →
    //   fuse-overlayfs → vfs) and retries on dockerd-crash-during-startup,
    //   so on most hosts we get overlay2 (~5× less disk than vfs) without
    //   any risk of dockerd silently failing to start.
    // -e DIND_WAIT_SECONDS=180 keeps a generous internal wait so the
    //   driver-retry chain has time to converge even on slow disks.
    finalEnvFlags: '-e DIND_SKIP_DAEMON=0 -e DIND_WAIT_SECONDS=180',
    // No --user override needed: image defaults to box (since hive-mind 1.74.3
    // / box-dind 2.1.4). dind-entrypoint.sh runs as box and elevates to root
    // via /etc/sudoers.d/box-dind only for the dockerd launch.
    finalUserFlag: '',
    // execUserFlag is empty because the image defaults to USER=box, so plain
    // `docker exec hive-mind ...` already runs as box.
    execUserFlag: '',
    // Belt-and-suspenders: docker commit preserves ENTRYPOINT from the parent
    // image, but pinning it here defends against future commit-semantics or
    // base-image surprises.
    entrypointFlag: '--entrypoint /usr/local/bin/dind-entrypoint.sh',
    needsDockerd: true,
  },
  plain: {
    image: 'konard/hive-mind:latest',
    runFlags: '',
    tempEnvFlags: '',
    finalEnvFlags: '',
    finalUserFlag: '--user box',
    execUserFlag: '',
    entrypointFlag: '',
    needsDockerd: false,
  },
};

const VARIANT = VARIANTS[config.imageVariant];
const IMAGE = config.image || VARIANT.image;
console.log(`>>> Image variant: ${config.imageVariant} (image: ${IMAGE})`);

// Repository names (without tag) for each variant, used for inactive-variant
// cleanup so all tags of the *other* variant get removed when we switch.
const stripTag = ref => ref.replace(/:[^/:]+$/, '');
const ACTIVE_REPO = stripTag(IMAGE);
const INACTIVE_REPOS = Object.entries(VARIANTS)
  .filter(([name]) => name !== config.imageVariant)
  .map(([, v]) => stripTag(v.image))
  .filter(repo => repo !== ACTIVE_REPO);

// Workaround: lino-env does not support multi-line quoted values (" or ').
// Until https://github.com/link-foundation/lino-env supports multi-line
// quoted strings (see links-notation MultilineQuotedString.test.js), we
// parse HIVE_TELEGRAM_BOT_CONFIGURATION directly from .lenv.
const readMultilineQuoted = (filePath, key) => {
  const text = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp(`^${key}:\\s*(["'])([\\s\\S]*?)\\1`, 'm');
  const m = text.match(re);
  return m ? m[2] : null;
};

const BOT_CONFIG = readMultilineQuoted('.lenv', 'HIVE_TELEGRAM_BOT_CONFIGURATION');

if (!BOT_CONFIG) {
  console.error('>>> ERROR: Missing required .lenv value: HIVE_TELEGRAM_BOT_CONFIGURATION');
  process.exit(1);
}
const tokenMatch = BOT_CONFIG.match(/TELEGRAM_BOT_TOKEN:\s*'([^']+)'/);
const telegramBotToken = tokenMatch ? tokenMatch[1] : null;

const redact = str => (SHOW_SECRETS || !telegramBotToken ? str : str.replaceAll(telegramBotToken, '***'));

log('BOT_CONFIG:\n' + redact(BOT_CONFIG));

// Helper function to sleep
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper to run local shell commands and print them
const run = async (command, { silent = false, ignoreErrors = false } = {}) => {
  if (!silent) {
    console.log(`>>> ${command}`);
  }
  try {
    const result = await $`bash -c ${command}`;
    log(`Exit code: ${result.code}`);
    return result;
  } catch (error) {
    log(`Command failed (code ${error.code}):`, error.message || error);
    if (!ignoreErrors) throw error;
  }
};

// Helper to run a command inside the container as the box user via bash.
// Both variants default USER to box (since hive-mind 1.74.3 / box-dind 2.1.4),
// so execUserFlag is empty for both. Kept variant-driven in case a future
// image variant needs an explicit -u override again. The .replace collapses
// the double space we'd otherwise emit when execUserFlag is empty.
const dockerSh = (command, opts) => run(`docker exec ${VARIANT.execUserFlag} ${CONTAINER} bash -l -c '${command}'`.replace(/  +/g, ' '), opts);

// Helper to get container status
const getContainerStatus = async () => {
  try {
    const result = await $({ mirror: false })`docker inspect -f {{.State.Status}} ${CONTAINER}`;
    return result.stdout.trim() || 'not_found';
  } catch {
    return 'not_found';
  }
};

// Main execution
let step = 0;
const nextStep = msg => console.log(`>>> Step ${++step}: ${msg}`);

if (config.resetDocker) {
  nextStep('FULL Docker reset (--reset-docker)');
  console.log('>>> WARNING: stopping ALL containers, removing ALL images, volumes, networks, and build cache on this host.');
  // Stop and remove every container. `docker ps -aq` is empty-safe via the
  // inner `[ -n "$ids" ]` guard so the script never invokes rm with no args.
  await run(`bash -c 'ids=$(docker ps -aq); if [ -n "$ids" ]; then docker stop $ids; docker rm -f $ids; else echo "(no containers)"; fi'`, { ignoreErrors: true });
  // Nuke images, volumes, networks, build cache.
  await run(`bash -c 'ids=$(docker images -aq); if [ -n "$ids" ]; then docker rmi -f $ids; else echo "(no images)"; fi'`, { ignoreErrors: true });
  await run(`docker volume prune -af`, { ignoreErrors: true });
  await run(`docker network prune -f`, { ignoreErrors: true });
  await run(`docker builder prune -af`, { ignoreErrors: true });
  await run(`docker system prune -af --volumes`, { ignoreErrors: true });
  console.log('>>> Full Docker reset complete');
  await run(`docker system df`);
}

nextStep('Checking current container status');
const initialStatus = await getContainerStatus();
console.log(`>>> Container status: ${initialStatus}`);

nextStep('Cleaning up old container and committed image');
await run(`docker stop ${CONTAINER} && docker rm ${CONTAINER}`, { ignoreErrors: true });
await run(`docker images -q ${CONTAINER}-configured | grep -q . && docker rmi -f ${CONTAINER}-configured || true`, { ignoreErrors: true });

if (!config.keepInactiveVariant && INACTIVE_REPOS.length > 0) {
  nextStep('Removing inactive hive-mind variant image(s)');
  // Remove every tag of the other variant's repository so we don't keep
  // tens of GB of unused image layers. A full reset above would already
  // have cleared these; this step covers the common case (no --reset-docker).
  for (const repo of INACTIVE_REPOS) {
    await run(`bash -c 'ids=$(docker images -q ${repo}); if [ -n "$ids" ]; then docker rmi -f $ids; else echo "(no ${repo} images)"; fi'`, { ignoreErrors: true });
  }
}

nextStep('Verifying old container is gone');
const afterCleanupStatus = await getContainerStatus();
if (afterCleanupStatus !== 'not_found') {
  console.error(`>>> ERROR: Container still exists after cleanup (status: ${afterCleanupStatus})`);
  process.exit(1);
}
console.log('>>> Old container removed successfully');

nextStep('Pulling latest image');
const pullResult = await run(`docker pull ${IMAGE}`);
const pullOutput = pullResult.stdout;

// docker pull prints "Status: Image is up to date for ..." or "Status: Downloaded newer image for ..."
const imageUpToDate = pullOutput.includes('Image is up to date');
const imageDownloaded = pullOutput.includes('Downloaded newer image');

if (imageUpToDate) {
  console.log('>>> Image is already up to date (no download needed)');
} else if (imageDownloaded) {
  console.log('>>> Downloaded newer image');
} else {
  console.log('>>> Image pulled (could not determine if it was updated)');
}

// Show local image details for confirmation
await run(`docker images --digests ${IMAGE}`);

// Clean up old/dangling images and reclaim disk space
await run(`docker image prune -f`, { ignoreErrors: true });
await run(`docker system prune -f`, { ignoreErrors: true });

nextStep('Starting temporary container for setup');
// dind variant: --privileged so entrypoint can later start dockerd, but skip
// dockerd in the setup pass (we don't need it for package installs and it
// would pollute /var/lib/docker before docker commit).
await run(`docker run -dit ${VARIANT.runFlags} ${VARIANT.tempEnvFlags} --name ${CONTAINER} ${IMAGE}`);

nextStep('Verifying temporary container is running');
const tempStatus = await getContainerStatus();
if (tempStatus !== 'running') {
  console.error(`>>> ERROR: Temporary container failed to start (status: ${tempStatus})`);
  process.exit(1);
}
console.log('>>> Temporary container is running');

nextStep('Fixing /home/box/.local permissions for box user');
await run(`docker exec -u root ${CONTAINER} mkdir -p /home/box/.local/share /home/box/.local/state`);
await run(`docker exec -u root ${CONTAINER} chown -R box:box /home/box/.local`);

nextStep('Checking agent --version (first access, before update)');
await dockerSh('agent --version', { ignoreErrors: true });

nextStep('Updating hive-mind, agent, claude-code, and codex');
// await dockerSh('bun install -g @link-assistant/hive-mind@1.53.0');
await dockerSh('bun install -g @link-assistant/hive-mind@latest');
await dockerSh('bun install -g @link-assistant/agent@latest');
await run(`docker exec ${VARIANT.execUserFlag} ${CONTAINER} bash -l -c "curl -fsSL https://claude.ai/install.sh | bash"`.replace(/  +/g, ' '));
await dockerSh('bun install -g @openai/codex@latest');

nextStep('Verifying claude-code version after installation');
await dockerSh('claude --version');

nextStep('Checking agent --version (after update)');
await dockerSh('agent --version', { ignoreErrors: true });

nextStep('Initializing Gemini CLI');
await dockerSh('gemini --version', { ignoreErrors: true });

nextStep('Writing bot start script');
const botStartScript = `#!/bin/bash
source ~/.bashrc
# export HIVE_MIND_CLAUDE_5_HOUR_SESSION_THRESHOLD=0.99
while true; do
  echo ">>> Starting hive-telegram-bot..."
  hive-telegram-bot --configuration "
${BOT_CONFIG}
" 2>&1 | tee hive-telegram-bot.log
  echo ">>> Bot exited, restarting in 3s..."
  sleep 3
done
`;
log('botStartScript:\n' + redact(botStartScript));
const base64Script = Buffer.from(botStartScript).toString('base64');
log('base64Script length:', base64Script.length);
// Write script to tmp, copy into container, fix ownership
await run(`echo ${base64Script} | base64 -d > /tmp/start-bot.sh`);
await run(`docker cp /tmp/start-bot.sh ${CONTAINER}:/home/box/start-bot.sh`);
await run(`rm /tmp/start-bot.sh`);
await run(`docker exec -u root ${CONTAINER} chown box:box /home/box/start-bot.sh`);

nextStep('Checking agent --version (after configuration)');
await dockerSh('agent --version', { ignoreErrors: true });

if (VARIANT.needsDockerd) {
  nextStep('Cleaning /var/lib/docker before commit (dind variant)');
  // We started the temp container with DIND_SKIP_DAEMON=1, but the directory
  // may still contain Docker base files from the image. Wipe it so the final
  // container's dind-entrypoint.sh starts dockerd from a clean state.
  // Using `find -delete` instead of a glob with hidden-file patterns avoids
  // shell quoting issues with `.??*` going through multiple layers of -c.
  await run(`docker exec -u root ${CONTAINER} sh -c "find /var/lib/docker -mindepth 1 -delete"`, { ignoreErrors: true });
}

nextStep('Committing container');
// For dind: strip temp-only env vars from the committed image. `docker commit`
// otherwise persists DIND_SKIP_DAEMON=1 (set on the temp container so we did
// not pollute /var/lib/docker), which would cause the final container's
// dind-entrypoint.sh to skip starting dockerd. The -e flags on `docker run`
// also override this, but baking a clean image is more robust.
const commitChangeFlags = VARIANT.needsDockerd ? `--change "ENV DIND_SKIP_DAEMON=0"` : '';
await run(`docker commit ${commitChangeFlags} ${CONTAINER} ${CONTAINER}-configured`);
await run(`docker stop ${CONTAINER}`);
await run(`docker rm ${CONTAINER}`);

nextStep('Ensuring host mount directories exist');
await run(`mkdir -p /root/.hive-mind/claude /root/.hive-mind/codex /root/.hive-mind/gh`);
await run(`touch -a /root/.hive-mind/claude.json`);

nextStep('Starting final container with bot');
// Using -dit so docker attach works with Ctrl+P, Ctrl+Q to detach
// Volume mounts persist claude config, codex config, claude.json, and gh auth across restarts
const MOUNTS = ['-v /root/.hive-mind/claude:/home/box/.claude', '-v /root/.hive-mind/codex:/home/box/.codex', '-v /root/.hive-mind/claude.json:/home/box/.claude.json', '-v /root/.hive-mind/gh:/home/box/.config/gh'].join(' ');
// dind variant: --privileged for nested dockerd; entrypoint drops to box.
// plain variant: pass --user box explicitly.
await run(`docker run -dit ${VARIANT.runFlags} ${VARIANT.finalEnvFlags} ${VARIANT.finalUserFlag} ${VARIANT.entrypointFlag} --name ${CONTAINER} --restart unless-stopped ${MOUNTS} ${CONTAINER}-configured bash -l -c 'bash /home/box/start-bot.sh'`);

nextStep('Verifying final container is running');
const finalStatus = await getContainerStatus();
if (finalStatus !== 'running') {
  console.error(`>>> ERROR: Final container failed to start (status: ${finalStatus})`);
  process.exit(1);
}
console.log('>>> Final container is running');

if (VARIANT.needsDockerd) {
  nextStep('Waiting for nested dockerd to be ready');
  // Dockerd with the vfs storage driver can take a while to initialize on
  // first start, especially on slower disks. Be generous with the timeout.
  const dockerdTimeoutMs = 180000;
  const dockerdDeadline = Date.now() + dockerdTimeoutMs;
  let dockerdReady = false;
  let lastLogged = 0;
  let lastLogTail = '';
  while (Date.now() < dockerdDeadline) {
    // No -u override: the dind image defaults USER to box (hive-mind 1.74.3+),
    // and box is in the docker group so it can talk to /var/run/docker.sock.
    const probe = await $({ mirror: false })`docker exec ${CONTAINER} docker info`;
    if (probe.code === 0) {
      dockerdReady = true;
      break;
    }
    const elapsedMs = dockerdTimeoutMs - (dockerdDeadline - Date.now());
    if (elapsedMs - lastLogged >= 15000) {
      // Peek at dockerd.log so the operator can see WHY it's not ready,
      // not just that it isn't. Only print the tail when it changes.
      // The entrypoint may fall back from /var/log/dockerd.log to
      // /tmp/dockerd.log to /dev/null, so try both real paths.
      const logProbe = await $({ mirror: false })`docker exec -u root ${CONTAINER} sh -c "tail -5 /var/log/dockerd.log 2>/dev/null || tail -5 /tmp/dockerd.log 2>/dev/null"`;
      const logTail = (logProbe.stdout || '').trim();
      const procProbe = await $({ mirror: false })`docker exec -u root ${CONTAINER} sh -c "pgrep -a dockerd 2>/dev/null || echo NO_DOCKERD_PROCESS"`;
      const procInfo = (procProbe.stdout || '').trim();
      console.log(`>>> still waiting for dockerd... (${Math.round(elapsedMs / 1000)}s elapsed)`);
      console.log(`>>>   dockerd process: ${procInfo}`);
      if (logTail && logTail !== lastLogTail) {
        console.log(`>>>   dockerd.log tail:`);
        for (const line of logTail.split('\n')) console.log(`>>>     ${line}`);
        lastLogTail = logTail;
      }
      lastLogged = elapsedMs;
    }
    await sleep(3000);
  }
  if (!dockerdReady) {
    console.error(`>>> ERROR: Nested dockerd did not become ready in ${dockerdTimeoutMs / 1000}s`);
    console.error('>>> --- diagnostics ---');
    await run(`docker inspect --format 'Privileged={{.HostConfig.Privileged}} Entrypoint={{.Config.Entrypoint}} Cmd={{.Config.Cmd}}' ${CONTAINER}`, { ignoreErrors: true });
    await run(`docker exec -u root ${CONTAINER} sh -c 'ls -la /usr/local/bin/dind-entrypoint.sh 2>&1 || echo "ENTRYPOINT MISSING"'`, { ignoreErrors: true });
    await run(`docker exec -u root ${CONTAINER} sh -c 'ls -la /var/run/docker.sock 2>&1 || echo "docker.sock not present"'`, { ignoreErrors: true });
    await run(`docker exec -u root ${CONTAINER} sh -c 'pgrep -a dockerd 2>&1 || echo "dockerd process not running"'`, { ignoreErrors: true });
    await run(`docker exec -u root ${CONTAINER} sh -c 'for f in /var/log/dockerd.log /tmp/dockerd.log; do if [ -s "$f" ]; then echo "--- $f ---"; tail -50 "$f"; fi; done; [ -s /var/log/dockerd.log ] || [ -s /tmp/dockerd.log ] || echo "no dockerd.log at /var/log or /tmp"'`, { ignoreErrors: true });
    await run(`docker logs --tail 80 ${CONTAINER}`, { ignoreErrors: true });
    process.exit(1);
  }
  console.log('>>> Nested dockerd is ready');
}

nextStep('Fixing mount permissions');
// Detect the actual UID of the box user from the running container
const idResult = await run(`docker exec ${CONTAINER} id -u box`);
const uidGid = idResult.stdout.trim();
log(`Detected UID: ${uidGid}`);
await run(`chown -R ${uidGid}:${uidGid} /root/.hive-mind/claude /root/.hive-mind/codex /root/.hive-mind/gh`);
await run(`chown ${uidGid}:${uidGid} /root/.hive-mind/claude.json`);

nextStep('Checking agent --version (final container)');
await dockerSh('agent --version');

nextStep('Restoring Playwright MCP for claude and codex (mounts shadow image config)');
// The host volume mounts for ~/.claude.json and ~/.codex/ shadow whatever was
// baked into the image, so playwright MCP registration must be re-applied
// inside the running final container so it persists on the host.
// Commands mirror those in the upstream Dockerfile:
//   https://raw.githubusercontent.com/link-assistant/hive-mind/refs/heads/main/Dockerfile
const PLAYWRIGHT_MCP_ARGS = '-y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080';

// Combine stdout+stderr from a dockerSh result. command-stream's exec may
// place mcp list output on either stream depending on the CLI.
const collectOutput = r => `${r?.stdout ?? ''}\n${r?.stderr ?? ''}`;

// Claude: check if 'playwright' MCP is connected; if not, (re)register it at user scope.
const claudeListResult = await dockerSh('claude mcp list', { ignoreErrors: true });
const claudeMcpList = collectOutput(claudeListResult);
const claudeHasPlaywright = /\bplaywright\b.*(?:[✓✔]\s*Connected|: connected)/im.test(claudeMcpList);
if (claudeHasPlaywright) {
  console.log('>>> Claude playwright MCP already connected');
} else {
  console.log('>>> Claude playwright MCP missing or broken, restoring...');
  await dockerSh('claude mcp remove playwright -s user', { ignoreErrors: true });
  await dockerSh(`claude mcp add playwright -s user -- npx ${PLAYWRIGHT_MCP_ARGS}`);
  const verifyResult = await dockerSh('claude mcp list', { ignoreErrors: true });
  const verifyOut = collectOutput(verifyResult);
  if (!/\bplaywright\b.*(?:[✓✔]\s*Connected|: connected)/im.test(verifyOut)) {
    console.error('>>> ERROR: Claude playwright MCP failed to connect after restore');
    console.error(verifyOut.trim() || '(no output)');
    process.exit(1);
  }
  console.log('>>> Claude playwright MCP restored');
}

// Codex: same pattern. `codex mcp list` prints registered servers; absence means it needs adding.
const codexListResult = await dockerSh('codex mcp list', { ignoreErrors: true });
const codexMcpList = collectOutput(codexListResult);
const codexHasPlaywright = /\bplaywright\b.*\benabled\b/im.test(codexMcpList);
if (codexHasPlaywright) {
  console.log('>>> Codex playwright MCP already registered');
} else {
  console.log('>>> Codex playwright MCP missing, restoring...');
  await dockerSh('codex mcp remove playwright', { ignoreErrors: true });
  await dockerSh(`codex mcp add playwright -- npx ${PLAYWRIGHT_MCP_ARGS}`);
  const verifyResult = await dockerSh('codex mcp list', { ignoreErrors: true });
  const verifyOut = collectOutput(verifyResult);
  if (!/\bplaywright\b.*\benabled\b/im.test(verifyOut)) {
    console.error('>>> ERROR: Codex playwright MCP not present after restore');
    console.error(verifyOut.trim() || '(no output)');
    process.exit(1);
  }
  console.log('>>> Codex playwright MCP restored');
}

nextStep('Verifying gh');
try {
  await dockerSh('gh api rate_limit --jq .resources.core');
  console.log('>>> gh is working');
} catch {
  console.error('>>> ERROR: gh verification failed');
  process.exit(1);
}

nextStep('Verifying claude');
// `claude -p` can return exit 0 even when it produced no model output —
// e.g. when the account hit a usage limit ("You've hit your weekly limit").
// Treat known quota messages as a soft warning (the deploy is not broken,
// the Anthropic account is rate-limited) and a real model reply as success.
{
  const claudeCmd = 'claude -p "reply with only the literal token OK_CLAUDE_PROBE" --model haiku';
  const claudeProbe = await $({ mirror: false })`docker exec ${CONTAINER} bash -l -c ${claudeCmd}`;
  const claudeOut = `${claudeProbe.stdout || ''}\n${claudeProbe.stderr || ''}`;
  log(`claude output:\n${claudeOut}`);
  const quotaExhausted = /weekly limit|usage limit|rate limit|quota/i.test(claudeOut);
  const modelReplied = /OK_CLAUDE_PROBE/.test(claudeOut);
  if (claudeProbe.code !== 0 && !quotaExhausted) {
    console.error('>>> ERROR: claude verification failed');
    console.error(`>>> exit=${claudeProbe.code}`);
    console.error(claudeOut.trim() || '(no output)');
    process.exit(1);
  }
  if (modelReplied) {
    console.log('>>> claude is working (model returned probe token)');
  } else if (quotaExhausted) {
    // Use console.log (stdout), not console.warn (stderr): SSH multiplexes
    // the two streams without ordering guarantees, so a stderr warning here
    // can appear AFTER the next step's header, confusing the log timeline.
    console.log('>>> WARNING: claude reached a quota/usage limit — CLI is installed and authenticated, but model did not reply');
    console.log(`>>> ${claudeOut.trim().split('\n')[0]}`);
  } else {
    console.error('>>> ERROR: claude returned exit 0 but no probe token and no quota signal');
    console.error(claudeOut.trim() || '(no output)');
    process.exit(1);
  }
}

nextStep('Verifying codex');
// `codex exec` has two known false-positive shapes we must defend against:
//
// 1. Trust-gate refusal: without --skip-git-repo-check or a trusted cwd, codex
//    prints "Not inside a trusted directory..." and exits 0. We pass
//    --skip-git-repo-check to clear that gate.
// 2. Echoed-prompt false success: codex prints the user prompt verbatim in a
//    `user\n<prompt>\n` block before any model reply, so a naive substring
//    check for the probe token matches the echo even when the model never
//    responded. We require the token to appear AFTER a model-reply section
//    marker (`codex\n` per codex's output format) OR for the token to occur
//    more than once (prompt echo + reply).
// 3. Quota / usage-limit exhaustion: codex exits non-zero with
//    "You've hit your usage limit". This is a billing condition, not a deploy
//    failure — auth works, CLI works. Treat as a soft warning, mirroring the
//    claude path.
{
  const codexCmd = 'codex exec --skip-git-repo-check --model gpt-5.4-mini "reply with only the literal token OK_CODEX_PROBE"';
  const codexProbe = await $({ mirror: false })`docker exec ${CONTAINER} bash -l -c ${codexCmd}`;
  const codexOut = `${codexProbe.stdout || ''}\n${codexProbe.stderr || ''}`;
  log(`codex output:\n${codexOut}`);
  const refusedTrust = /Not inside a trusted directory|--skip-git-repo-check was not specified/i.test(codexOut);
  const quotaExhausted = /usage limit|rate limit|quota|insufficient_quota|purchase more credits/i.test(codexOut);
  // Token must appear after a `codex\n` model-reply marker, OR appear at
  // least twice (once echoed in `user\n<prompt>\n`, once in a model reply).
  const tokenAfterCodexMarker = /\ncodex\s*\n[\s\S]*OK_CODEX_PROBE/.test(codexOut);
  const tokenCount = (codexOut.match(/OK_CODEX_PROBE/g) || []).length;
  const modelReplied = tokenAfterCodexMarker || tokenCount >= 2;

  if (refusedTrust) {
    console.error('>>> ERROR: codex refused to run (trust gate)');
    console.error(codexOut.trim() || '(no output)');
    process.exit(1);
  }
  if (modelReplied) {
    console.log('>>> codex is working (model returned probe token)');
  } else if (quotaExhausted) {
    // Use console.log (stdout), not console.warn (stderr): SSH multiplexes
    // the two streams without ordering guarantees.
    console.log('>>> WARNING: codex reached a usage/quota limit — CLI is installed and authenticated, but model did not reply');
    const quotaLine = (codexOut.match(/.*(?:usage limit|rate limit|quota|insufficient_quota|purchase more credits).*/i) || [])[0];
    if (quotaLine) console.log(`>>> ${quotaLine.trim()}`);
  } else if (codexProbe.code !== 0) {
    console.error('>>> ERROR: codex verification failed');
    console.error(`>>> exit=${codexProbe.code} refusedTrust=${refusedTrust} modelReplied=${modelReplied} quotaExhausted=${quotaExhausted}`);
    console.error('>>> codex output:');
    console.error(codexOut.trim() || '(no output)');
    process.exit(1);
  } else {
    console.error('>>> ERROR: codex returned exit 0 but no probe token after model-reply marker and no quota signal');
    console.error('>>> codex output:');
    console.error(codexOut.trim() || '(no output)');
    process.exit(1);
  }
}

nextStep('Verifying interactive shell behavior');
// Both variants must default `docker exec hive-mind ...` to the box user
// (matching parity since hive-mind 1.74.3 / box-dind 2.1.4 fixed the
// historical dind "exec lands as root" regression).
const defaultExecProbe = await $({ mirror: false })`docker exec ${CONTAINER} whoami`;
const defaultExecUser = (defaultExecProbe.stdout || '').trim();
console.log(`>>> docker exec ${CONTAINER} whoami -> ${defaultExecUser}`);
if (defaultExecUser !== 'box') {
  console.error(`>>> ERROR: 'docker exec ${CONTAINER} whoami' returned '${defaultExecUser}', expected 'box'`);
  if (config.imageVariant === 'dind') {
    console.error('>>> dind image must default USER to box since 1.74.3.');
    console.error('>>> If this is a pinned older image, bump to konard/hive-mind-dind:1.74.3+.');
  }
  process.exit(1);
}

// Host-side shim so the operator gets a one-word `hive-mind-shell` command
// in both variants. Now redundant for behavior (plain `docker exec -it hive-mind bash`
// also lands as box) but kept as a stable, variant-agnostic entrypoint.
// Falls back gracefully when no TTY is attached (e.g. CI / SSH non-tty).
nextStep('Installing host-side hive-mind-shell helper');
const shellHelper = `#!/usr/bin/env bash
# Auto-generated by deploy-docker.mjs. Opens an interactive shell in
# the hive-mind container as the box user. Use -it when stdin is a TTY;
# otherwise plain exec so the helper can also be used non-interactively
# (e.g. \`hive-mind-shell -c 'docker ps'\`).
if [ -t 0 ] && [ -t 1 ]; then
  exec docker exec -it ${CONTAINER} bash -l "$@"
else
  exec docker exec ${CONTAINER} bash -l "$@"
fi
`;
const helperPath = '/usr/local/bin/hive-mind-shell';
const helperB64 = Buffer.from(shellHelper).toString('base64');
await run(`echo ${helperB64} | base64 -d > ${helperPath}`);
await run(`chmod +x ${helperPath}`);
const helperVerify = await $({ mirror: false })`${helperPath} -c whoami`;
const helperUser = (helperVerify.stdout || '').trim();
if (helperUser !== 'box') {
  console.error(`>>> ERROR: ${helperPath} produced user '${helperUser}', expected 'box'`);
  console.error(helperVerify.stderr || '');
  process.exit(1);
}
console.log(`>>> ${helperPath} -c whoami -> ${helperUser}`);

if (VARIANT.needsDockerd) {
  nextStep('Verifying docker is usable inside the container (dind variant)');
  // Already gated on dockerd readiness above, but explicitly run a non-trivial
  // docker command as the box user to catch socket-permission regressions.
  try {
    await dockerSh('docker version');
    await dockerSh('docker ps');
    console.log('>>> Nested docker is working');
  } catch {
    console.error('>>> ERROR: docker inside the container is not usable as box');
    await run(`docker exec -u root ${CONTAINER} sh -c 'ls -la /var/run/docker.sock'`, { ignoreErrors: true });
    process.exit(1);
  }
}

nextStep('Setting up git identity');
await dockerSh('gh-setup-git-identity');

nextStep('Waiting for bot to start and verifying');
const maxWait = 60000;
const pollInterval = 5000;
let elapsed = 0;
let botStarted = false;
while (elapsed < maxWait) {
  await sleep(pollInterval);
  elapsed += pollInterval;
  try {
    const logsResult = await $({ mirror: false })`docker logs --tail 50 ${CONTAINER}`;
    const logs = logsResult.stdout;
    if (logs.includes('starting polling...')) {
      botStarted = true;
      break;
    }
  } catch {
    // ignore
  }
  console.log(`>>> Waiting for bot to start... (${elapsed / 1000}s)`);
}

if (botStarted) {
  console.log('>>> Bot confirmed started (found "starting polling..." in logs)');
} else {
  console.error('>>> ERROR: Bot did not produce "starting polling..." within 60s');
  process.exit(1);
}

nextStep('Verifying container is running');
await run('docker ps -a');

nextStep('Bot logs');
await run(`docker logs --tail 30 ${CONTAINER}`);

console.log('>>> Done');
console.log('>>> To attach to bot output: docker attach hive-mind');
console.log('>>> To detach without stopping: Ctrl+P, Ctrl+Q');
console.log('>>> To open a shell as the box user: hive-mind-shell');
console.log(`>>>   (equivalent: docker exec -it ${CONTAINER} bash -l)`);
