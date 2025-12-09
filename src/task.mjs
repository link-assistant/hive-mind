#!/usr/bin/env node

// Early exit paths - handle these before loading all modules to speed up testing
const earlyArgs = process.argv.slice(2);

if (earlyArgs.includes('--version')) {
  const { getVersion } = await import('./version.lib.mjs');
  try {
    const version = await getVersion();
    console.log(version);
  } catch {
    console.error('Error: Unable to determine version');
    process.exit(1);
  }
  process.exit(0);
}

if (earlyArgs.includes('--help') || earlyArgs.includes('-h')) {
  // Show help and exit
  console.log('Usage: task.mjs <task-description> [options]');
  console.log('\nOptions:');
  console.log('  --version          Show version number');
  console.log('  --help, -h         Show help');
  console.log('  --clarify          Enable clarification mode [default: true]');
  console.log('  --decompose        Enable decomposition mode [default: true]');
  console.log('  --only-clarify     Only run clarification mode');
  console.log('  --only-decompose   Only run decomposition mode');
  console.log('  --model, -m        Model to use (opus, sonnet, or full model ID) [default: sonnet]');
  console.log('  --verbose, -v      Enable verbose logging');
  console.log('  --output-format    Output format (text or json) [default: text]');
  process.exit(0);
}

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

const yargs = (await use('yargs@latest')).default;
const path = (await use('path')).default;
const fs = (await use('fs')).promises;
const { spawn } = (await use('child_process')).default;

// Import Claude execution functions
import { mapModelToId } from './claude.lib.mjs';

// Global log file reference
let logFile = null;

// Helper function to log to both console and file
const log = async (message, options = {}) => {
  const { level = 'info', verbose = false } = options;
  
  // Skip verbose logs unless --verbose is enabled
  if (verbose && !global.verboseMode) {
    return;
  }
  
  // Write to file if log file is set
  if (logFile) {
    const logMessage = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    await fs.appendFile(logFile, logMessage + '\n').catch(() => {});
  }
  
  // Write to console based on level
  switch (level) {
    case 'error':
      console.error(message);
      break;
    case 'warning':
    case 'warn':
      console.warn(message);
      break;
    case 'info':
    default:
      console.log(message);
      break;
  }
};

// Configure command line arguments - task description as positional argument
// Use yargs().parse(args) instead of yargs(args).argv to ensure .strict() mode works
const argv = yargs()
  .usage('Usage: $0 <task-description> [options]')
  .positional('task-description', {
    type: 'string',
    description: 'The task to clarify and decompose'
  })
  .option('clarify', {
    type: 'boolean',
    description: 'Enable clarification mode (asks clarifying questions about the task)',
    default: true
  })
  .option('decompose', {
    type: 'boolean',
    description: 'Enable decomposition mode (breaks down the task into subtasks)',
    default: true
  })
  .option('only-clarify', {
    type: 'boolean',
    description: 'Only run clarification mode, skip decomposition',
    default: false
  })
  .option('only-decompose', {
    type: 'boolean',
    description: 'Only run decomposition mode, skip clarification',  
    default: false
  })
  .option('model', {
    type: 'string',
    description: 'Model to use (opus, sonnet, or full model ID like claude-sonnet-4-5-20250929)',
    alias: 'm',
    default: 'sonnet',
    choices: ['opus', 'sonnet', 'claude-sonnet-4-5-20250929', 'claude-opus-4-5-20251101']
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging for debugging',
    alias: 'v',
    default: false
  })
  .option('output-format', {
    type: 'string',
    description: 'Output format (text or json)',
    alias: 'o',
    default: 'text',
    choices: ['text', 'json']
  })
  .check((argv) => {
    if (!argv['task-description'] && !argv._[0]) {
      throw new Error('Please provide a task description');
    }
    
    // Handle mutual exclusivity of only-clarify and only-decompose
    if (argv['only-clarify'] && argv['only-decompose']) {
      throw new Error('Cannot use both --only-clarify and --only-decompose at the same time');
    }
    
    // If only-clarify is set, disable decompose
    if (argv['only-clarify']) {
      argv.decompose = false;
    }
    
    // If only-decompose is set, disable clarify
    if (argv['only-decompose']) {
      argv.clarify = false;
    }
    
    return true;
  })
  .parserConfiguration({
    'boolean-negation': true
  })
  .help()
  .alias('h', 'help')
  // Use yargs built-in strict mode to reject unrecognized options
  // This prevents issues like #453 and #482 where unknown options are silently ignored
  .strict()
  .parse(process.argv.slice(2));

const taskDescription = argv['task-description'] || argv._[0];

// Set global verbose mode for log function
global.verboseMode = argv.verbose;

// Create permanent log file immediately with timestamp
const scriptDir = path.dirname(process.argv[1]);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
logFile = path.join(scriptDir, `task-${timestamp}.log`);

// Create the log file immediately
await fs.writeFile(logFile, `# Task.mjs Log - ${new Date().toISOString()}\n\n`);
await log(`📁 Log file: ${logFile}`);
await log('   (All output will be logged here)');

// Helper function to format aligned console output
const formatAligned = (icon, label, value, indent = 0) => {
  const spaces = ' '.repeat(indent);
  const labelWidth = 25 - indent;
  const paddedLabel = label.padEnd(labelWidth, ' ');
  return `${spaces}${icon} ${paddedLabel} ${value || ''}`;
};

await log('\n🎯 Task Processing Started');
await log(formatAligned('📝', 'Task description:', taskDescription));
await log(formatAligned('🤖', 'Model:', argv.model));
await log(formatAligned('💡', 'Clarify mode:', argv.clarify ? 'enabled' : 'disabled'));
await log(formatAligned('🔍', 'Decompose mode:', argv.decompose ? 'enabled' : 'disabled'));
await log(formatAligned('📄', 'Output format:', argv.outputFormat));

const claudePath = process.env.CLAUDE_PATH || 'claude';

// Helper function to execute Claude command
const executeClaude = (prompt, model) => {
  return new Promise((resolve, reject) => {
    // Map model alias to full ID
    const mappedModel = mapModelToId(model);

    const args = [
      '-p', prompt,
      '--output-format', 'text',
      '--dangerously-skip-permissions',
      '--model', mappedModel
    ];
    
    const child = spawn(claudePath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude exited with code ${code}: ${stderr}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
};

try {
  const results = {
    task: taskDescription,
    timestamp: new Date().toISOString(),
    clarification: null,
    decomposition: null
  };

  // Phase 1: Clarification
  if (argv.clarify) {
    await log('\n🤔 Phase 1: Task Clarification');
    await log('   Analyzing task and generating clarifying questions...');
    
    const clarifyPrompt = `Task: "${taskDescription}"

Please help clarify this task by:
1. Identifying any ambiguous aspects of the task
2. Asking 3-5 specific clarifying questions that would help someone implement this task more effectively
3. Suggesting potential assumptions that could be made if these questions aren't answered
4. Identifying any missing context or requirements

Provide your response in a clear, structured format that helps refine the task understanding.`;

    const clarificationOutput = await executeClaude(clarifyPrompt, argv.model);
    if (!argv.verbose) {
      console.log('\n📝 Clarification Results:');
      console.log(clarificationOutput);
    }
    
    results.clarification = clarificationOutput;
    await log('\n✅ Clarification phase completed');
  }

  // Phase 2: Decomposition
  if (argv.decompose) {
    await log('\n🔍 Phase 2: Task Decomposition');
    await log('   Breaking down task into manageable subtasks...');
    
    let decomposePrompt = `Task: "${taskDescription}"`;
    
    if (results.clarification) {
      decomposePrompt += `\n\nClarification analysis:\n${results.clarification}`;
    }
    
    decomposePrompt += `\n\nPlease decompose this task by:
1. Breaking it down into 3-8 specific, actionable subtasks
2. Ordering the subtasks logically (dependencies and sequence)
3. Estimating relative complexity/effort for each subtask (simple/medium/complex)
4. Identifying any potential risks or challenges for each subtask
5. Suggesting success criteria for each subtask

Provide your response as a structured breakdown that someone could use as a implementation roadmap.`;

    const decompositionOutput = await executeClaude(decomposePrompt, argv.model);
    if (!argv.verbose) {
      console.log('\n🔍 Decomposition Results:');
      console.log(decompositionOutput);
    }
    
    results.decomposition = decompositionOutput;
    await log('\n✅ Decomposition phase completed');
  }

  // Output results
  if (argv.outputFormat === 'json') {
    console.log('\n' + JSON.stringify(results, null, 2));
  }

  await log('\n🎉 Task processing completed successfully');
  await log(`💡 Review the session log for details: ${logFile}`);
  
} catch (error) {
  await log(`❌ Error processing task: ${error.message}`, { level: 'error' });
  process.exit(1);
}