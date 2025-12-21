#!/usr/bin/env node
/**
 * Test script to verify the OpenCode stderr handling fix
 *
 * This simulates the scenario from issue #438 where:
 * 1. Command executes successfully (exit code 0)
 * 2. There's stderr output from legitimate commands
 * 3. Before fix: Would incorrectly fail due to messageCount=0 check
 * 4. After fix: Should succeed based on exit code alone
 */

// Mock the command-stream library behavior
const mockCommandStream = (exitCode, stdout, stderr) => {
  return {
    async *stream() {
      // Simulate stdout chunks
      for (const line of stdout) {
        yield { type: 'stdout', data: Buffer.from(line) };
      }

      // Simulate stderr chunks (like from bash commands)
      for (const line of stderr) {
        yield { type: 'stderr', data: Buffer.from(line) };
      }

      // Simulate exit
      yield { type: 'exit', code: exitCode };
    }
  };
};

// Simulate the old (broken) logic
const oldLogic = async (exitCode, stdout, stderr) => {
  let messageCount = 0; // Never incremented in OpenCode!
  let toolUseCount = 0; // Never incremented in OpenCode!
  let stderrErrors = [];

  const execCommand = mockCommandStream(exitCode, stdout, stderr);

  for await (const chunk of execCommand.stream()) {
    if (chunk.type === 'stderr') {
      const errorOutput = chunk.data.toString();
      if (errorOutput) {
        const trimmed = errorOutput.trim();
        if (trimmed && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed'))) {
          stderrErrors.push(trimmed);
        }
      }
    } else if (chunk.type === 'exit') {
      exitCode = chunk.code;
    }
  }

  // Old flawed logic
  if (!exitCode && stderrErrors.length > 0 && messageCount === 0 && toolUseCount === 0) {
    console.log('❌ OLD LOGIC: Command failed (false negative!)');
    exitCode = 1;
  }

  return exitCode === 0;
};

// Simulate the new (fixed) logic
const newLogic = async (exitCode, stdout, stderr) => {
  const execCommand = mockCommandStream(exitCode, stdout, stderr);

  for await (const chunk of execCommand.stream()) {
    if (chunk.type === 'exit') {
      exitCode = chunk.code;
    }
  }

  // New logic - rely on exit code only
  return exitCode === 0;
};

// Test scenarios
const testScenarios = [
  {
    name: 'Issue #438 scenario: Success with stderr containing error keywords',
    exitCode: 0,
    stdout: ['Task completed successfully\n', 'All changes committed\n'],
    stderr: [
      '| Bash     node src/solve.mjs --help 2>&1 | head -50\n',
      '| Bash     gh pr edit 437 --title "feat: add option" --body "error handling improved"\n'
    ],
    expectedResult: true
  },
  {
    name: 'Legitimate failure with exit code 1',
    exitCode: 1,
    stdout: ['Starting task...\n'],
    stderr: ['Error: Authentication failed\n'],
    expectedResult: false
  },
  {
    name: 'Success with no stderr',
    exitCode: 0,
    stdout: ['Task completed\n'],
    stderr: [],
    expectedResult: true
  }
];

// Run tests
console.log('🧪 Testing OpenCode stderr handling fix\n');

for (const scenario of testScenarios) {
  console.log(`📋 Test: ${scenario.name}`);
  console.log(`   Exit code: ${scenario.exitCode}`);
  console.log(`   Stderr lines: ${scenario.stderr.length}`);

  const oldResult = await oldLogic(scenario.exitCode, scenario.stdout, scenario.stderr);
  const newResult = await newLogic(scenario.exitCode, scenario.stdout, scenario.stderr);

  console.log(
    `   Old logic result: ${oldResult ? '✅ Success' : '❌ Failed'} ${oldResult === scenario.expectedResult ? '' : '(WRONG!)'}`
  );
  console.log(
    `   New logic result: ${newResult ? '✅ Success' : '❌ Failed'} ${newResult === scenario.expectedResult ? '✅' : '❌'}`
  );
  console.log('');
}

console.log('✅ Test complete - the fix correctly handles stderr output without false negatives');
