import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

async function findStartScreenCommand() {
  try {
    const { stdout } = await exec('which start-screen');
    return stdout.trim();
  } catch {
    return null;
  }
}

function executeWithCommand(startScreenCmd, command, args, verbose = false) {
  return new Promise(resolve => {
    const allArgs = [command, ...args];

    if (verbose) {
      console.log(`[VERBOSE] Executing: ${startScreenCmd} ${allArgs.join(' ')}`);
    } else {
      console.log(`Executing: ${startScreenCmd} ${allArgs.join(' ')}`);
    }

    const child = spawn(startScreenCmd, allArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
    });

    child.on('error', error => {
      resolve({
        success: false,
        output: stdout,
        error: error.message,
      });
    });

    child.on('close', code => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout,
        });
      } else {
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Command exited with code ${code}`,
        });
      }
    });
  });
}

export async function executeStartScreen(command, args, options = {}) {
  const { verbose = false } = options;

  try {
    const whichPath = await findStartScreenCommand();

    if (!whichPath) {
      const warningMsg = '⚠️  WARNING: start-screen command not found in PATH\n' + 'Please ensure @link-assistant/hive-mind is properly installed\n' + 'You may need to run: npm install -g @link-assistant/hive-mind';
      console.warn(warningMsg);

      return {
        success: false,
        warning: warningMsg,
        error: 'start-screen command not found in PATH',
      };
    }

    if (verbose) {
      console.log(`[VERBOSE] Found start-screen at: ${whichPath}`);
    }

    return await executeWithCommand(whichPath, command, args, verbose);
  } catch (error) {
    console.error('Error executing start-screen:', error);
    return {
      success: false,
      output: '',
      error: error.message,
    };
  }
}
