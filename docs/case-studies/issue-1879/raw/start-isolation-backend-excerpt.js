/** Isolation Runners for start-command (screen, tmux, docker, ssh) */

const { execSync, spawn, spawnSync } = require('child_process');
const path = require('path');
const { generateSessionName } = require('./args-parser');
const outputBlocks = require('./output-blocks');

// Debug mode from environment
const DEBUG = process.env.START_DEBUG === '1' || process.env.START_DEBUG === 'true';

const { getScreenVersion, supportsLogfileOption, runScreenWithLogCapture: _runScreenWithLogCapture, startDetachedScreenWithLogCapture, resetScreenVersionCache } = require('./screen-isolation');
const { appendLogFile, createShellLogFooterSnippet, shellQuote, wrapCommandWithLogFooter } = require('./isolation-log-utils');

/**
 * Check if a command is available on the system
 * @param {string} command - Command to check
 * @returns {boolean} True if command is available
 */
function isCommandAvailable(command) {
  try {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? 'where' : 'which';
    execSync(`${checkCmd} ${command}`, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/** Get the shell to use for command execution. */
function getShell() {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : process.env.SHELL || '/bin/sh';
  const shellArg = isWindows ? '/c' : '-c';
  return { shell, shellArg };
}

/**
 * Detect the best available shell in an isolation environment (docker/ssh)
 * Tries shells in order: bash, zsh, sh
 * @param {'docker'|'ssh'} environment - Isolation environment type
 * @param {object} options - Options for the isolation environment
 * @param {string} [shellPreference='auto'] - Shell preference: 'auto', 'bash', 'zsh', 'sh'
 * @returns {string} Shell path to use
 */
function detectShellInEnvironment(environment, options, shellPreference = 'auto') {
  // If a specific shell is requested (not auto), use it directly
  if (shellPreference && shellPreference !== 'auto') {
    if (DEBUG) {
      console.log(`[DEBUG] Using forced shell: ${shellPreference}`);
    }
    return shellPreference;
  }

  // In auto mode, try shells in order of preference
  const shellsToTry = ['bash', 'zsh', 'sh'];

  if (environment === 'docker') {
    const image = options.image;
    if (!image) {
      return 'sh';
    }

    for (const shell of shellsToTry) {
      try {
        const result = spawnSync('docker', ['run', '--rm', image, 'sh', '-c', `command -v ${shell}`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (result.status === 0 && result.stdout.trim()) {
          if (DEBUG) {
            console.log(`[DEBUG] Detected shell in docker image ${image}: ${result.stdout.trim()}`);
          }
          return result.stdout.trim();
        }
      } catch {
        // ignore; try next shell
      }
    }

    if (DEBUG) {
      console.log(`[DEBUG] Could not detect shell in docker image ${image}, falling back to sh`);
    }
    return 'sh';
  }

  if (environment === 'ssh') {
    const endpoint = options.endpoint;
    if (!endpoint) {
      return 'sh';
    }

    try {
      // Run a single SSH command to check for available shells in order
      const checkCmd = shellsToTry.map(s => `command -v ${s}`).join(' || ');
      const result = spawnSync('ssh', [endpoint, checkCmd], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (result.status === 0 && result.stdout.trim()) {
        const detected = result.stdout.trim();
        if (DEBUG) {
          console.log(`[DEBUG] Detected shell on SSH host ${endpoint}: ${detected}`);
        }
        return detected;
      }
    } catch {
      // Fall through to default
    }

    if (DEBUG) {
      console.log(`[DEBUG] Could not detect shell on SSH host ${endpoint}, falling back to sh`);
    }
    return 'sh';
  }

  return 'sh';
}

/** Returns "-i" for bash/zsh (enables .bashrc sourcing), null otherwise. */
function getShellInteractiveFlag(shellPath) {
  const shellName = shellPath.split('/').pop();
  return shellName === 'bash' || shellName === 'zsh' ? '-i' : null;
}
const { isInteractiveShellCommand, isShellInvocationWithArgs, buildShellWithArgsCmdArgs, buildDisplayCommand } = require('./shell-utils');

/** Returns true if the current process has a TTY attached. */
function hasTTY() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Wraps command with sudo -u if user is specified; returns command unchanged otherwise. */
function wrapCommandWithUser(command, user) {
  if (!user) {
    return command;
  }
  // sudo -n: non-interactive (fails if password required); -u: run as user
  return `sudo -n -u ${user} sh -c '${command.replace(/'/g, "'\\''")}'`;
}

/**
 * Run command in GNU Screen using detached mode with log capture.
 * Supports screen >= 4.5.1 (native -Logfile) and older versions (tee fallback).
 * @param {string} command - Command to execute
 * @param {string} sessionName - Session name
 * @param {object} shellInfo - Shell info from getShell()
 * @param {string|null} user - Username to run command as (optional)
 * @returns {Promise<{success: boolean, sessionName: string, message: string, output: string}>}
 */
function runScreenWithLogCapture(command, sessionName, shellInfo, user = null, logPath = null) {
  return _runScreenWithLogCapture(command, sessionName, shellInfo, user, wrapCommandWithUser, isInteractiveShellCommand, logPath);
}

/**
 * Run command in GNU Screen
 * @param {string} command - Command to execute
 * @param {object} options - Options (session, detached, user, keepAlive)
 * @returns {Promise<{success: boolean, sessionName: string, message: string}>}
 */
function runInScreen(command, options = {}) {
  if (!isCommandAvailable('screen')) {
    return Promise.resolve({
      success: false,
      sessionName: null,
      message: 'screen is not installed. Install it with: sudo apt-get install screen (Debian/Ubuntu) or brew install screen (macOS)',
    });
  }

  const sessionName = options.session || generateSessionName('screen');
  const shellInfo = getShell();

  try {
    if (options.detached) {
      return Promise.resolve(
        startDetachedScreenWithLogCapture(command, sessionName, shellInfo, {
          user: options.user,
          keepAlive: options.keepAlive,
          logPath: options.logPath,
          wrapCommandWithUser,
        })
      );
    } else {
      return runScreenWithLogCapture(command, sessionName, shellInfo, options.user, options.logPath);
    }
  } catch (err) {
    return Promise.resolve({
      success: false,
      sessionName,
      message: `Failed to run in screen: ${err.message}`,
    });
  }
}

/**
 * Run command in tmux
 * @param {string} command - Command to execute
 * @param {object} options - Options (session, detached, user, keepAlive)
 * @returns {Promise<{success: boolean, sessionName: string, message: string}>}
 */
function runInTmux(command, options = {}) {
  if (!isCommandAvailable('tmux')) {
    return Promise.resolve({
      success: false,
      sessionName: null,
      message: 'tmux is not installed. Install it with: sudo apt-get install tmux (Debian/Ubuntu) or brew install tmux (macOS)',
    });
  }

  const sessionName = options.session || generateSessionName('tmux');
  const shellInfo = getShell();
  const { shell } = shellInfo;

  // Wrap command with user switch if specified
  let effectiveCommand = wrapCommandWithUser(command, options.user);

  try {
    if (options.detached) {
      if (options.keepAlive) {
        effectiveCommand = `${effectiveCommand}; exec ${shell}`;
      }

      if (DEBUG) {
        console.log(`[DEBUG] Running: tmux new-session -d -s "${sessionName}" "${effectiveCommand}"`);
        console.log(`[DEBUG] keepAlive: ${options.keepAlive || false}`);
      }

      if (options.logPath) {
        const loggedCommand = wrapCommandWithLogFooter(effectiveCommand, {
          shell,
          keepAlive: options.keepAlive,
        });
        spawnSync('tmux', ['new-session', '-d', '-s', sessionName, shell], {
          stdio: 'inherit',
        });
        spawnSync('tmux', ['pipe-pane', '-t', sessionName, '-o', `cat >> ${shellQuote(options.logPath)}`], { stdio: 'inherit' });
        spawnSync('tmux', ['send-keys', '-t', sessionName, loggedCommand, 'C-m'], {
          stdio: 'inherit',
        });
      } else {
        execSync(`tmux new-session -d -s "${sessionName}" "${effectiveCommand}"`, {
          stdio: 'inherit',
        });
      }

      let message = `Command started in detached tmux session: ${sessionName}`;
      if (options.keepAlive) {
        message += `\nSession will stay alive after command completes.`;
      } else {
        message += `\nSession will exit automatically after command completes.`;
      }
      message += `\nReattach with: tmux attach -t ${sessionName}`;

      return Promise.resolve({
        success: true,
        sessionName,
        message,
      });
    } else {
      if (DEBUG) {
        console.log(`[DEBUG] Running: tmux new-session -s "${sessionName}" "${effectiveCommand}"`);
      }

      return new Promise(resolve => {
        const child = spawn('tmux', ['new-session', '-s', sessionName, effectiveCommand], {
          stdio: 'inherit',
        });

        child.on('exit', code => {
          resolve({
            success: code === 0,
            sessionName,
            message: `Tmux session "${sessionName}" exited with code ${code}`,
            exitCode: code,
          });
        });

        child.on('error', err => {
          resolve({
            success: false,
            sessionName,
            message: `Failed to start tmux: ${err.message}`,
          });
        });
      });
    }
  } catch (err) {
    return Promise.resolve({
      success: false,
      sessionName,
      message: `Failed to run in tmux: ${err.message}`,
    });
  }
}

/**
 * Run command over SSH on a remote server
 * @param {string} command - Command to execute
 * @param {object} options - Options (endpoint, session, detached)
 * @returns {Promise<{success: boolean, sessionName: string, message: string}>}
 */
function runInSsh(command, options = {}) {
  if (!isCommandAvailable('ssh')) {
    return Promise.resolve({
      success: false,
      sessionName: null,
      message: 'ssh is not installed. Install it with: sudo apt-get install openssh-client (Debian/Ubuntu) or brew install openssh (macOS)',
    });
  }

  if (!options.endpoint) {
    return Promise.resolve({
      success: false,
      sessionName: null,
      message: 'SSH isolation requires --endpoint option to specify the remote server (e.g., user@host)',
    });
  }

  const sessionName = options.session || generateSessionName('ssh');
  const sshTarget = options.endpoint;

  const shellToUse = detectShellInEnvironment('ssh', options, options.shell);
  // In auto mode, SSH login shells already source startup files (.bashrc etc.);
  // only wrap with an explicit shell when user requests one.
  const useExplicitShell = options.shell && options.shell !== 'auto' ? shellToUse : null;
  const shellInteractiveFlag = useExplicitShell ? getShellInteractiveFlag(useExplicitShell) : null;

  try {
    if (options.detached) {
      const remoteShell = useExplicitShell || shellToUse;
      const shellInvocation = shellInteractiveFlag ? `${remoteShell} ${shellInteractiveFlag}` : remoteShell;
      const remoteCommand = isInteractiveShellCommand(command) ? `mkdir -p /tmp/start-command/logs/isolation/ssh && nohup ${command} > /tmp/start-command/logs/isolation/ssh/${sessionName}.log 2>&1 &` : `mkdir -p /tmp/start-command/logs/isolation/ssh && nohup ${shellInvocation} -c ${JSON.stringify(command)} > /tmp/start-command/logs/isolation/ssh/${sessionName}.log 2>&1 &`;
      const sshArgs = [sshTarget, remoteCommand];

      if (DEBUG) {
        console.log(`[DEBUG] Running: ssh ${sshArgs.join(' ')}`);
        console.log(`[DEBUG] shell: ${shellInvocation}`);
      }

      const result = spawnSync('ssh', sshArgs, { stdio: 'inherit' });

      if (result.error) {
        throw result.error;
      }

      return Promise.resolve({
        success: true,
        sessionName,
        message: `Command started in detached SSH session on ${sshTarget}\nSession: ${sessionName}\nView logs: ssh ${sshTarget} "tail -f /tmp/start-command/logs/isolation/ssh/${sessionName}.log"`,
      });
    } else {
      const extraFlags = shellInteractiveFlag ? [shellInteractiveFlag] : [];
      const sshArgs = isInteractiveShellCommand(command) ? [sshTarget, ...command.trim().split(/\s+/)] : useExplicitShell ? [sshTarget, useExplicitShell, ...extraFlags, '-c', command] : [sshTarget, command];

      if (DEBUG) {
        console.log(`[DEBUG] Running: ssh ${sshArgs.join(' ')}`);
        console.log(`[DEBUG] shell: ${shellToUse}`);
      }

      return new Promise(resolve => {
        const child = spawn('ssh', sshArgs, {
          stdio: 'inherit',
        });

        child.on('exit', code => {
          resolve({
            success: code === 0,
            sessionName,
            message: `SSH session "${sessionName}" on ${sshTarget} exited with code ${code}`,
            exitCode: code,
          });
        });

        child.on('error', err => {
          resolve({
            success: false,
            sessionName,
            message: `Failed to start SSH: ${err.message}`,
          });
        });
      });
    }
  } catch (err) {
    return Promise.resolve({
      success: false,
      sessionName,
      message: `Failed to run over SSH: ${err.message}`,
    });
  }
}

const { dockerImageExists, dockerPullImage, isDockerAvailable, getDefaultDockerImage, canRunLinuxDockerImages } = require('./docker-utils');

/**
 * Build the docker run runtime argument list contributed by configurable
 * container options: privileged mode, environment variables, volumes/bind
 * mounts, and --mount specs. Returned in a stable order so they can be spliced
 * into the `docker run` argv before the image name.
 * @param {object} options - Options (privileged, env, volumes, mounts)
 * @returns {string[]} Docker CLI arguments
 */
function buildDockerRuntimeArgs(options = {}) {
  const args = [];
  if (options.privileged) {
    args.push('--privileged');
  }
  for (const envVar of options.env || []) {
    args.push('-e', envVar);
  }
  for (const volume of options.volumes || []) {
    args.push('-v', volume);
  }
  for (const mount of options.mounts || []) {
    args.push('--mount', mount);
  }
  return args;
}

/**
 * Build the human-readable `[Isolation]` status lines for docker runtime
 * options (volumes, mounts, env, privileged). Empty collections and a falsy
 * privileged flag contribute no lines.
 * @param {object} options - Options (volumes, mounts, env, privileged)
 * @returns {string[]} Status lines for the start block / log header
 */
function buildDockerRuntimeStatusLines(options = {}) {
  const lines = [];
  if (options.volumes && options.volumes.length > 0) {
    lines.push(`[Isolation] Volumes: ${options.volumes.join(', ')}`);
  }
  if (options.mounts && options.mounts.length > 0) {
    lines.push(`[Isolation] Mounts: ${options.mounts.join(', ')}`);
  }
  if (options.env && options.env.length > 0) {
    lines.push(`[Isolation] Env: ${options.env.join(', ')}`);
  }
  if (options.privileged) {
    lines.push(`[Isolation] Privileged: true`);
  }
  return lines;
}

/**
 * Build the execution-record metadata for docker runtime options, normalizing
 * empty collections and a falsy privileged flag to `null`.
 * @param {object} options - Options (volumes, mounts, env, privileged)
 * @returns {{volumes: ?string[], mounts: ?string[], env: ?string[], privileged: ?boolean}}
 */
function buildDockerRuntimeMetadata(options = {}) {
  return {
    volumes: options.volumes && options.volumes.length > 0 ? options.volumes : null,
    mounts: options.mounts && options.mounts.length > 0 ? options.mounts : null,
    env: options.env && options.env.length > 0 ? options.env : null,
    privileged: options.privileged || null,
  };
}

/**
 * Run command in Docker container
 * @param {string} command - Command to execute
 * @param {object} options - Options (image, session/name, detached, user, keepAlive, autoRemoveDockerContainer, volumes, mounts, env, privileged)
 * @returns {Promise<{success: boolean, containerName: string, message: string}>}
 */
function runInDocker(command, options = {}) {
  const dockerNotAvailableError = !isCommandAvailable('docker') ? 'Docker is not installed. Install Docker from https://docs.docker.com/get-docker/' : !isDockerAvailable() ? 'Docker is installed but not running. Please start Docker Desktop or the Docker daemon, then try again.' : null;

  if (dockerNotAvailableError) {
    if (options.image) {
      const pullCmd = `docker pull ${options.image}`;
      console.log(outputBlocks.createVirtualCommandBlock(pullCmd));
      console.log();
      // ✗ and │ come from createFinishBlock() AFTER the error message (issue #89)
    }
    return Promise.resolve({
      success: false,
      containerName: null,
      message: dockerNotAvailableError,
    });
  }

  if (!options.image) {
    return Promise.resolve({
      success: false,
      containerName: null,
      message: 'Docker isolation requires --image option',
    });
  }

  const containerName = options.session || generateSessionName('docker');
  if (!dockerImageExists(options.image)) {
    const pullResult = dockerPullImage(options.image);
    if (!pullResult.success) {
      return Promise.resolve({
        success: false,
        containerName: null,
        message: `Failed to pull Docker image: ${options.image}`,
        exitCode: 1,
      });
    }
  }

  const isBareShell = isInteractiveShellCommand(command);
  const shellToUse = isBareShell ? 'sh' : detectShellInEnvironment('docker', options, options.shell);
  const shellInteractiveFlag = getShellInteractiveFlag(shellToUse);

  console.log(outputBlocks.createCommandLine(buildDisplayCommand(command)));
  console.log();

  try {
    if (options.detached) {
      const dockerArgs = ['run', '-d'];
      if (options.keepAlive) {
        dockerArgs.push('-i', '-t');
      }
      dockerArgs.push('--name', containerName);
      if (options.autoRemoveDockerContainer) {
        dockerArgs.push('--rm');
      }

      if (options.user) {
        dockerArgs.push('--user', options.user);
      }

      dockerArgs.push(...buildDockerRuntimeArgs(options));

      const effectiveCommand = options.keepAlive ? `${command}; exec ${shellToUse}` : command;
      const shellArgs = shellInteractiveFlag ? [shellToUse, shellInteractiveFlag] : [shellToUse];
      const cmdArgs = isBareShell ? command.trim().split(/\s+/) : isShellInvocationWithArgs(command) ? buildShellWithArgsCmdArgs(effectiveCommand) : [...shellArgs, '-c', effectiveCommand];
      dockerArgs.push(options.image, ...cmdArgs);

      if (DEBUG) {
        console.log(`[DEBUG] Running: docker ${dockerArgs.join(' ')}`);
        console.log(`[DEBUG] shell: ${shellToUse}`);
        console.log(`[DEBUG] keepAlive: ${options.keepAlive || false}`);
        console.log(`[DEBUG] autoRemoveDockerContainer: ${options.autoRemoveDockerContainer || false}`);
      }

      const dockerResult = spawnSync('docker', dockerArgs, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (dockerResult.error) {
        throw dockerResult.error;
      }
      if (dockerResult.status !== 0) {
        const dockerError = dockerResult.stderr.trim() || dockerResult.stdout.trim() || `docker exited with code ${dockerResult.status}`;
        throw new Error(dockerError);
      }

      const containerId = dockerResult.stdout.trim();

      if (options.logPath) {
        const loggerScript = [`docker logs -f ${shellQuote(containerName)} >> ${shellQuote(options.logPath)} 2>&1`, `__start_command_exit=$(docker inspect -f '{{.State.ExitCode}}' ${shellQuote(containerName)} 2>/dev/null || printf '%s' '-1')`, `${createShellLogFooterSnippet()} >> ${shellQuote(options.logPath)}`].join('; ');
        const logger = spawn('sh', ['-c', loggerScript], {
          detached: true,
          stdio: 'ignore',
        });
        logger.unref();
      }

      let message = `Command started in detached docker container: ${containerName}`;
      message += `\nContainer ID: ${containerId.substring(0, 12)}`;
      if (options.keepAlive) {
        message += `\nContainer will stay alive after command completes.`;
      } else {
        message += `\nContainer will exit automatically after command completes.`;
      }
      if (options.autoRemoveDockerContainer) {
        message += `\nContainer will be automatically removed after exit.`;
      } else {
        message += `\nContainer filesystem will be preserved after exit.`;
      }
      message += `\nAttach with: docker attach ${containerName}`;
      message += `\nView logs: docker logs ${containerName}`;
      if (options.logPath) {
        message += `\nLive log: ${options.logPath}`;
      }

      return Promise.resolve({
        success: true,
        containerName,
        containerId,
        message,
      });
    } else {
      const dockerArgs = ['run', '-it', '--rm', '--name', containerName];
      if (options.user) {
        dockerArgs.push('--user', options.user);
      }
      dockerArgs.push(...buildDockerRuntimeArgs(options));
      if (DEBUG) {
        console.log(`[DEBUG] shell: ${shellToUse}`);
      }
      const shellCmdArgs = shellInteractiveFlag ? [shellToUse, shellInteractiveFlag] : [shellToUse];
      // Bare shell: pass directly with -i (avoids bash-inside-bash, issue #84; -i ensures interactive).
      // Shell with -c: pass directly as argv (avoids double-wrapping and quote-stripping, issue #91).
      let attachedCmdArgs;
      if (isBareShell) {
        const parts = command.trim().split(/\s+/);
        const bareFlag = getShellInteractiveFlag(parts[0]);
        attachedCmdArgs = bareFlag && !parts.includes(bareFlag) ? [parts[0], bareFlag, ...parts.slice(1)] : parts;
      } else if (isShellInvocationWithArgs(command)) {
        attachedCmdArgs = buildShellWithArgsCmdArgs(command);
      } else {
        attachedCmdArgs = [...shellCmdArgs, '-c', command];
      }
      dockerArgs.push(options.image, ...attachedCmdArgs);

      if (DEBUG) {
        console.log(`[DEBUG] Running: docker ${dockerArgs.join(' ')}`);
      }

      return new Promise(resolve => {
        const startTime = Date.now();
        const child = spawn('docker', dockerArgs, { stdio: 'inherit' });

        child.on('exit', code => {
          const durationMs = Date.now() - startTime;
          let message = `Docker container "${containerName}" exited with code ${code}`;
          // Bare shell exited non-zero quickly → startup file error; suggest --norc (issue #84).
          if (isBareShell && code !== 0 && durationMs < 3000) {
            const shell0 = command.trim().split(/\s+/)[0];
            // prettier-ignore
            const norc = path.basename(shell0) === 'zsh' ? '--no-rcs' : '--norc';
            const hint = `Hint: The shell exited immediately — its startup file (.bashrc/.zshrc) may have errors.\nTry skipping startup files: ${shell0} ${norc}`;
            console.log(hint);
            message += `\n${hint}`;
          }
          resolve({
            success: code === 0,
            containerName,
            message,
            exitCode: code,
          });
        });

        child.on('error', err => {
          resolve({
            success: false,
            containerName,
            message: `Failed to start docker: ${err.message}`,
          });
        });
      });
    }
  } catch (err) {
    return Promise.resolve({
      success: false,
      containerName,
      message: `Failed to run in docker: ${err.message}`,
    });
  }
}

/**
 * Run command in the specified isolation environment
 * Supports stacked isolation where each level calls $ with remaining levels
 * @param {string} backend - Isolation environment (screen, tmux, docker, ssh)
 * @param {string} command - Command to execute
 * @param {object} options - Options
 * @returns {Promise<{success: boolean, message: string}>}
 */
function runIsolated(backend, command, options = {}) {
  // If stacked isolation, build the command for next level
  let effectiveCommand = command;

  if (options.isolatedStack && options.isolatedStack.length > 1) {
    // Lazy load to avoid circular dependency
    const { buildNextLevelCommand } = require('./command-builder');
    effectiveCommand = buildNextLevelCommand(options, command);

    if (DEBUG) {
      console.log(`[DEBUG] Stacked isolation - level command: ${effectiveCommand}`);
    }
  }

  // Get current level option values
  const currentOptions = {
    ...options,
    // Use current level values from stacks
    image: options.imageStack ? options.imageStack[0] : options.image,
    endpoint: options.endpointStack ? options.endpointStack[0] : options.endpoint,
    session: options.sessionStack ? options.sessionStack[0] : options.session,
    logPath: options.logPath,
  };

  switch (backend) {
    case 'screen':
      return runInScreen(effectiveCommand, currentOptions);
    case 'tmux':
      return runInTmux(effectiveCommand, currentOptions);
    case 'docker':
      return runInDocker(effectiveCommand, currentOptions);
    case 'ssh':
      return runInSsh(effectiveCommand, currentOptions);
    default:
      return Promise.resolve({
        success: false,
        message: `Unknown isolation environment: ${backend}`,
      });
  }
}

const { getTimestamp, generateLogFilename, createLogHeader, createLogFooter, writeLogFile, getLogDir, createLogPath, runAsIsolatedUser } = require('./isolation-log-utils');

module.exports = {
  isCommandAvailable,
  hasTTY,
  isInteractiveShellCommand,
  isShellInvocationWithArgs,
  buildShellWithArgsCmdArgs,
  buildDisplayCommand,
  detectShellInEnvironment,
  runInScreen,
  runInTmux,
  runInDocker,
  buildDockerRuntimeArgs,
  buildDockerRuntimeStatusLines,
  buildDockerRuntimeMetadata,
  runInSsh,
  runIsolated,
  runAsIsolatedUser,
  wrapCommandWithUser,
  getTimestamp,
  generateLogFilename,
  createLogHeader,
  createLogFooter,
  writeLogFile,
  appendLogFile,
  getLogDir,
  createLogPath,
  getScreenVersion,
  supportsLogfileOption,
  resetScreenVersionCache,
  canRunLinuxDockerImages,
  getDefaultDockerImage,
  dockerImageExists,
  dockerPullImage,
};
