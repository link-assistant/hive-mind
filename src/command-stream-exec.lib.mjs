/**
 * command-stream-backed compatibility helpers for old child_process.exec call
 * sites that still need a raw shell command string and { stdout, stderr }.
 *
 * Issue #1864: keep the command-stream bootstrap in one place so production
 * modules can move off native exec without adding top-level use-m fetches.
 */

let commandStreamPromise = null;

async function getUse() {
  if (typeof globalThis.use !== 'undefined') return globalThis.use;
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
  return globalThis.use;
}

export async function loadCommandStreamDollar() {
  if (!commandStreamPromise) {
    commandStreamPromise = (async () => {
      const use = await getUse();
      const { $ } = await use('command-stream');
      return $;
    })();
  }
  return commandStreamPromise;
}

function normalizeOutput(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

function makeExecError(command, result) {
  const stderr = normalizeOutput(result?.stderr);
  const message = stderr ? `Command failed: ${command}\n${stderr}` : `Command failed: ${command}`;
  const error = new Error(message);
  error.code = result?.code ?? 1;
  error.cmd = command;
  error.stdout = normalizeOutput(result?.stdout);
  error.stderr = stderr;
  return error;
}

/**
 * Execute a shell command through command-stream with child_process.exec-like
 * return/error shape. Only the exec options this codebase currently relies on
 * are forwarded; unsupported timeout/signal handling remains a documented
 * command-stream gap.
 *
 * @param {string} command
 * @param {object} [execOptions]
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export async function commandStreamExec(command, execOptions = {}) {
  const $ = await loadCommandStreamDollar();
  const runOptions = {
    mirror: false,
    capture: true,
  };

  if (execOptions.cwd) runOptions.cwd = execOptions.cwd;
  if (execOptions.env) runOptions.env = execOptions.env;
  if (Object.hasOwn(execOptions, 'input')) runOptions.stdin = execOptions.input;

  const $silent = $(runOptions);
  const result = await $silent(command);
  const normalized = {
    stdout: normalizeOutput(result?.stdout),
    stderr: normalizeOutput(result?.stderr),
  };

  if (result?.code && result.code !== 0) {
    throw makeExecError(command, { ...result, ...normalized });
  }

  return normalized;
}
