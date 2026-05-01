import path from 'path';
import { constants as fsConstants, promises as fs } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function startAgentExecutableName() {
  return process.platform === 'win32' ? 'start-agent.cmd' : 'start-agent';
}

async function canExecute(filePath) {
  try {
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function getBundledStartAgentCandidate() {
  try {
    const entryPath = require.resolve('agent-commander');
    return path.join(path.dirname(path.dirname(entryPath)), 'bin', 'start-agent.mjs');
  } catch {
    return null;
  }
}

export async function resolveStartAgentCommand(options = {}) {
  const { cwd = process.cwd(), runCommand } = options;
  const candidates = [getBundledStartAgentCandidate(), path.join(cwd, 'node_modules', '.bin', startAgentExecutableName())].filter(Boolean);

  for (const candidate of candidates) {
    if (await canExecute(candidate)) return candidate;
  }

  if (!runCommand) return null;

  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const result = await runCommand(lookupCommand, ['start-agent']);
  if (result.code !== 0) return null;

  return (
    (result.stdout || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean) || null
  );
}

export function buildStartAgentArgs(options) {
  const { tool, workingDirectory, prompt, systemPrompt, model, isolation, screenName, verbose } = options;
  const args = ['--tool', tool, '--working-directory', workingDirectory, '--prompt', prompt, '--system-prompt', systemPrompt, '--model', model, '--isolation', isolation, '--read-only'];

  if (isolation === 'screen' && screenName) {
    args.push('--screen-name', screenName);
  }
  if (verbose) args.push('--verbose');

  return args;
}
