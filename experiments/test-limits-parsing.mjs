#!/usr/bin/env node
/**
 * Test script for /limits command parsing logic
 * Tests the regex patterns used to extract usage percentages and reset times
 */

// Sample output that mimics what claude /usage produces
const sampleOutput = `
Settings:  Status   Config   [Usage]     (tab to cycle)

Current session
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 53% used
Resets 6pm (UTC)

Current week (all models)
████████████████████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 80% used
Resets Dec 4, 6pm (UTC)

Current week (Sonnet only)
██████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 34% used
Resets Dec 4, 6pm (UTC)

Nov 24, 2025 update:
We've increased your limits and removed the Opus cap, so you can use Opus
4.5 up to your overall limit. Sonnet now has its own limit—it's set to
match your previous overall limit, so you can use just as much as before.
We may continue to adjust limits as we learn how usage patterns evolve
over time.

Esc to exit
`;

// Test parsing logic
function testParsing(output) {
  console.log('Testing percentage extraction...\n');

  // Extract percentages from output
  const percentageMatches = output.match(/(\d+)%\s*used/g);
  const percentages = percentageMatches
    ? percentageMatches.map(m => parseInt(m.match(/(\d+)/)[1]))
    : [];

  console.log('Percentages found:', percentages);
  console.log('Expected: [53, 80, 34]');
  console.log('Match:', JSON.stringify(percentages) === JSON.stringify([53, 80, 34]) ? '✅ PASS' : '❌ FAIL');

  console.log('\nTesting reset times extraction...\n');

  // Extract reset times - look for "Resets" followed by time info
  const resetMatches = output.match(/Resets\s+([^\n]+)/g);
  const resetTimes = resetMatches
    ? resetMatches.map(m => m.replace(/Resets\s+/, '').trim())
    : [];

  console.log('Reset times found:', resetTimes);
  console.log('Expected: ["6pm (UTC)", "Dec 4, 6pm (UTC)", "Dec 4, 6pm (UTC)"]');
  console.log('Match:',
    resetTimes.length === 3 &&
    resetTimes[0] === '6pm (UTC)' &&
    resetTimes[1] === 'Dec 4, 6pm (UTC)' &&
    resetTimes[2] === 'Dec 4, 6pm (UTC)'
      ? '✅ PASS' : '❌ FAIL');

  console.log('\nBuilding usage object...\n');

  const usage = {
    currentSession: {
      percentage: percentages[0] || null,
      resetTime: resetTimes[0] || null
    },
    allModels: {
      percentage: percentages[1] || null,
      resetTime: resetTimes[1] || null
    },
    sonnetOnly: {
      percentage: percentages[2] || null,
      resetTime: resetTimes[2] || null
    }
  };

  console.log('Usage object:');
  console.log(JSON.stringify(usage, null, 2));

  console.log('\nTesting progress bar generation...\n');

  function getProgressBar(percentage) {
    const totalBlocks = 10;
    const filledBlocks = Math.round((percentage / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    return '▓'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  }

  console.log('53% used:', getProgressBar(53));
  console.log('80% used:', getProgressBar(80));
  console.log('34% used:', getProgressBar(34));
  console.log('0% used:', getProgressBar(0));
  console.log('100% used:', getProgressBar(100));

  console.log('\n✅ All parsing tests completed!');
}

testParsing(sampleOutput);
