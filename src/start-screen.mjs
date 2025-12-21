#!/usr/bin/env node
// start-screen.mjs - Launch solve or hive commands in GNU screen sessions

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Import the shared parseGitHubUrl function from github.lib.mjs
// This ensures consistent URL validation across all commands (hive, solve, start-screen)
const { parseGitHubUrl } = await import('./github.lib.mjs');

/**
 * Generate a screen session name based on the command and GitHub URL
 * @param {string} command - Either 'solve' or 'hive'
 * @param {string} githubUrl - GitHub repository or issue URL
 * @returns {string} The generated screen session name
 */
function generateScreenName(command, githubUrl) {
  const parsed = parseGitHubUrl(githubUrl);

  if (!parsed.valid) {
    // Fallback to simple naming if parsing fails
    const sanitized = githubUrl.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 30);
    return `${command}-${sanitized}`;
  }

  // Build name parts
  const parts = [command];

  if (parsed.owner) {
    parts.push(parsed.owner);
  }

  if (parsed.repo) {
    parts.push(parsed.repo);
  }

  if (parsed.number) {
    parts.push(parsed.number);
  }

  return parts.join('-');
}

/**
 * Check if a screen session exists
 * @param {string} sessionName - The name of the screen session
 * @returns {Promise<boolean>} Whether the session exists
 */
async function screenSessionExists(sessionName) {
  try {
    const { stdout } = await execAsync('screen -ls');
    return stdout.includes(sessionName);
  } catch {
    // screen -ls returns non-zero exit code when no sessions exist
    return false;
  }
}

/**
 * Wait for a screen session to be ready to accept commands
 * A session is considered ready when it can execute a test command
 * @param {string} sessionName - The name of the screen session
 * @param {number} maxWaitSeconds - Maximum time to wait in seconds (default: 5)
 * @returns {Promise<boolean>} Whether the session became ready
 */
async function waitForSessionReady(sessionName, maxWaitSeconds = 5) {
  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;

  // Use a unique marker file for this check to avoid conflicts
  const markerFile = `/tmp/screen-ready-${sessionName}-${Date.now()}.marker`;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Send a test command that creates a marker file
      // This command will only execute when the session is actually ready at a prompt
      await execAsync(`screen -S ${sessionName} -X stuff "touch ${markerFile} 2>/dev/null\n"`);

      // Wait for the marker file to appear
      const checkStartTime = Date.now();
      const checkTimeout = 1000; // 1 second to check if marker appears

      while (Date.now() - checkStartTime < checkTimeout) {
        try {
          const { code } = await execAsync(`test -f ${markerFile}`);
          if (code === 0) {
            // Marker file exists, session is ready!
            // Clean up the marker file
            await execAsync(`rm -f ${markerFile}`).catch(() => { });
            return true;
          }
        } catch {
          // Marker file doesn't exist yet
        }

        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Marker file didn't appear, session is still busy
      // Clean up any leftover marker file from the queued command
      await execAsync(`rm -f ${markerFile}`).catch(() => { });
    } catch {
      // Error sending test command or checking marker
    }

    // Wait before trying again
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Timeout reached, session is not ready
  return false;
}

/**
 * Create or enter a screen session with the given command
 * @param {string} sessionName - The name of the screen session
 * @param {string} command - The command to run ('solve' or 'hive')
 * @param {string[]} args - Arguments to pass to the command
 * @param {boolean} autoTerminate - If true, session terminates after command completes
 */
async function createOrEnterScreen(sessionName, command, args, autoTerminate = false) {
  const sessionExists = await screenSessionExists(sessionName);

  if (sessionExists) {
    console.log(`Screen session '${sessionName}' already exists.`);
    console.log('Checking if session is ready to accept commands...');

    // Wait for the session to be ready (at a prompt)
    const isReady = await waitForSessionReady(sessionName);

    if (isReady) {
      console.log('Session is ready.');
    } else {
      console.log('Session might still be running a command. Will attempt to send command anyway.');
      console.log('Note: The command will execute once the current operation completes.');
    }

    console.log('Sending command to existing session...');

    // Build the full command to send to the existing session
    const quotedArgs = args.map(arg => {
      // If arg contains spaces or special chars, wrap in single quotes
      if (arg.includes(' ') || arg.includes('&') || arg.includes('|') ||
          arg.includes(';') || arg.includes('$') || arg.includes('*') ||
          arg.includes('?') || arg.includes('(') || arg.includes(')')) {
        // Escape single quotes within the argument
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    }).join(' ');

    const fullCommand = `${command} ${quotedArgs}`;

    // Escape the command for screen's stuff command
    // We need to escape special characters for the shell
    const escapedCommand = fullCommand.replace(/'/g, "'\\''");

    try {
      // Send the command to the existing screen session
      // The \n at the end simulates pressing Enter
      await execAsync(`screen -S ${sessionName} -X stuff '${escapedCommand}\n'`);
      console.log(`Command sent to session '${sessionName}' successfully.`);
      console.log(`To attach and view the session, run: screen -r ${sessionName}`);
    } catch (error) {
      console.error('Failed to send command to existing screen session:', error.message);
      console.error('You may need to terminate the old session and try again.');
      process.exit(1);
    }
    return;
  }

  console.log(`Creating screen session: ${sessionName}`);

  // Create a detached session with the command
  // Quote arguments properly to preserve spaces and special characters
  const quotedArgs = args.map(arg => {
    // If arg contains spaces or special chars, wrap in single quotes
    if (arg.includes(' ') || arg.includes('&') || arg.includes('|') ||
        arg.includes(';') || arg.includes('$') || arg.includes('*') ||
        arg.includes('?') || arg.includes('(') || arg.includes(')')) {
      // Escape single quotes within the argument
      return `'${arg.replace(/'/g, "'\\''")}'`;
    }
    return arg;
  }).join(' ');

  let screenCommand;
  if (autoTerminate) {
    // Old behavior: session terminates after command completes
    const fullCommand = `${command} ${quotedArgs}`;
    screenCommand = `screen -dmS ${sessionName} ${fullCommand}`;
  } else {
    // New behavior: wrap the command in a bash shell that will stay alive after the command finishes
    // This allows the user to reattach to the screen session after the command completes
    const fullCommand = `${command} ${quotedArgs}`;
    const escapedCommand = fullCommand.replace(/'/g, "'\\''");
    screenCommand = `screen -dmS ${sessionName} bash -c '${escapedCommand}; exec bash'`;
  }

  try {
    await execAsync(screenCommand);
    console.log(`Started ${command} in detached screen session: ${sessionName}`);
    if (autoTerminate) {
      console.log('Note: Session will terminate after command completes (--auto-terminate mode)');
    } else {
      console.log('Session will remain active after command completes');
    }
    console.log(`To attach to this session, run: screen -r ${sessionName}`);
  } catch (error) {
    console.error('Failed to create screen session:', error.message);
    process.exit(1);
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: start-screen [--auto-terminate] <solve|hive> <github-url> [additional-args...]');
    console.error('');
    console.error('Options:');
    console.error('  --auto-terminate    Session terminates after command completes (old behavior)');
    console.error('                      By default, session stays alive for review and reattachment');
    console.error('');
    console.error('Examples:');
    console.error('  start-screen solve https://github.com/user/repo/issues/123 --dry-run');
    console.error('  start-screen --auto-terminate solve https://github.com/user/repo/issues/456');
    console.error('  start-screen hive https://github.com/user/repo --flag value');
    process.exit(1);
  }

  // Check for --auto-terminate flag at the beginning
  // Also validate that first arg is not an unrecognized option with em-dash or other invalid dash
  let autoTerminate = false;
  let argsOffset = 0;

  // Check for various dash characters in first argument (em-dash \u2014, en-dash \u2013, etc.)
  if (args[0] && /^[\u2010\u2011\u2012\u2013\u2014]/.test(args[0])) {
    console.error(`Unknown option: ${args[0]}`);
    console.error('Usage: start-screen [--auto-terminate] <solve|hive> <github-url> [additional-args...]');
    console.error('Note: Use regular hyphens (--) not em-dashes or en-dashes.');
    process.exit(1);
  }

  if (args[0] === '--auto-terminate') {
    autoTerminate = true;
    argsOffset = 1;

    if (args.length < 3) {
      console.error('Error: --auto-terminate requires a command and GitHub URL');
      console.error('Usage: start-screen [--auto-terminate] <solve|hive> <github-url> [additional-args...]');
      process.exit(1);
    }
  } else if (args[0] && args[0].startsWith('-') && args[0] !== '--help' && args[0] !== '-h') {
    // First arg is an unrecognized option
    console.error(`Unknown option: ${args[0]}`);
    console.error('Usage: start-screen [--auto-terminate] <solve|hive> <github-url> [additional-args...]');
    process.exit(1);
  }

  // Check if the next arg (after --auto-terminate if present) looks like an unrecognized option
  if (args[argsOffset] && args[argsOffset].startsWith('-')) {
    // Check for various dash characters (em-dash, en-dash, etc.)
    const firstArg = args[argsOffset];
    const hasInvalidDash = /^[\u2010\u2011\u2012\u2013\u2014]/.test(firstArg);
    if (hasInvalidDash || (firstArg.startsWith('-') && firstArg !== '--help' && firstArg !== '-h')) {
      console.error(`Unknown option: ${firstArg}`);
      console.error('Usage: start-screen [--auto-terminate] <solve|hive> <github-url> [additional-args...]');
      console.error('Expected command to be "solve" or "hive", not an option.');
      process.exit(1);
    }
  }

  const command = args[argsOffset];
  const githubUrl = args[argsOffset + 1];
  const commandArgs = args.slice(argsOffset + 2);

  // Validate command
  if (command !== 'solve' && command !== 'hive') {
    console.error(`Error: Invalid command '${command}'. Must be 'solve' or 'hive'.`);
    process.exit(1);
  }

  // Validate GitHub URL
  const parsed = parseGitHubUrl(githubUrl);
  if (!parsed.valid) {
    console.error(`Error: Invalid GitHub URL. ${parsed.error}`);
    console.error('Please provide a valid GitHub repository or issue URL.');
    process.exit(1);
  }

  // Generate screen session name
  const sessionName = generateScreenName(command, githubUrl);

  // Check for screen availability
  try {
    await execAsync('which screen');
  } catch {
    console.error('Error: GNU Screen is not installed or not in PATH.');
    console.error('Please install it using your package manager:');
    console.error('  Ubuntu/Debian: sudo apt-get install screen');
    console.error('  macOS: brew install screen');
    console.error('  RHEL/CentOS: sudo yum install screen');
    process.exit(1);
  }

  // Prepare full argument list for the command
  const fullArgs = [githubUrl, ...commandArgs];

  // Create or enter the screen session
  await createOrEnterScreen(sessionName, command, fullArgs, autoTerminate);
}

// Run the main function
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});