#!/usr/bin/env node

/**
 * Investigation Script: Why does GitHub say "No commits between branches"
 * when git push shows commit movement?
 *
 * This script helps understand the relationship between:
 * 1. Git commit SHAs (8ee8459..9d8c4fc)
 * 2. Git tree SHAs (content)
 * 3. GitHub's "No commits between" error
 */

console.log('=== Understanding "No commits between branches" ===\n');

console.log('Key Insight:');
console.log('GitHub PR creation checks if there are TREE differences between branches,');
console.log('not just if there are different COMMITS.\n');

console.log('Scenario from logs:');
console.log('  Push: 8ee8459..9d8c4fc  issue-1-b53fe3666f91 -> issue-1-b53fe3666f91');
console.log('  Error: No commits between master and issue-1-b53fe3666f91\n');

console.log('What this means:');
console.log('  1. Commit 8ee8459 exists on branch (old)');
console.log('  2. Commit 9d8c4fc exists on branch (new)');
console.log('  3. BUT: Both commits have the SAME TREE as master\n');

console.log('How this happens with --auto-continue:');
console.log('  Run 1:');
console.log('    - Create branch from master');
console.log('    - CLAUDE.md contains: "Task: Issue #1"');
console.log('    - Commit A created with this content');
console.log('    - Push succeeds');
console.log('    - PR creation fails for some reason');
console.log('');
console.log('  Run 2 (with --auto-continue):');
console.log('    - Checkout existing branch');
console.log('    - CLAUDE.md exists, read content: "Task: Issue #1"');
console.log('    - Append to CLAUDE.md: "\\n\\n---\\n\\nTask: Issue #1"');
console.log('    - Wait... this is IDENTICAL to existing content!');
console.log('    - Git sees modified file (write operation)');
console.log('    - Creates commit B');
console.log('    - Push succeeds: A..B');
console.log('    - BUT: Tree of B == Tree of A == Tree of master');
console.log('    - GitHub: "No commits between branches"\n');

console.log('The REAL problem:');
console.log('  When CLAUDE.md already exists and we append the SAME task info,');
console.log('  we are NOT actually changing the content in a meaningful way.\n');

console.log('Why v0.29.8 timestamp fix works:');
console.log('  finalContent = `${existing}\\n\\n---\\n\\n${taskInfo}\\n\\nRun timestamp: ${timestamp}`;');
console.log('');
console.log('  This ensures each run has DIFFERENT content because timestamp changes.');
console.log('  Result: Tree of commit B != Tree of commit A');
console.log('  GitHub sees actual changes and allows PR creation.\n');

console.log('But wait... why does it still fail?');
console.log('  Looking at the logs again...\n');

console.log('From gist log (second run at 09:59):');
console.log('  [2025-11-05T10:00:04.078Z] Using existing branch: issue-1-b53fe3666f91');
console.log('  [2025-11-05T10:00:15.117Z] CLAUDE.md already exists, appending task info...');
console.log('  [2025-11-05T10:00:15.199Z] Commit created: 9d8c4fc');
console.log('  [2025-11-05T10:00:16.535Z] Push: 8ee8459..9d8c4fc');
console.log('  [2025-11-05T10:00:30.151Z] ERROR: No commits between master and issue-1-b53fe3666f91\n');

console.log('Critical question: What version was running?');
console.log('  [2025-11-05T09:59:49.240Z] [INFO] 🚀 solve v0.29.5\n');

console.log('AH HA! The issue:');
console.log('  The logs show v0.29.5 running, which does NOT have the timestamp fix!');
console.log('  v0.29.8 has the timestamp fix.');
console.log('  User reverted to v0.29.5 after v0.29.7 broke fork mode.');
console.log('  So the timestamp fix was never actually tested in production!\n');

console.log('Additional issue with fork mode (v0.29.7):');
console.log('  From third gist log:');
console.log('    [2025-11-05T12:28:31.050Z] 🚀 solve v0.29.7');
console.log('    [2025-11-05T12:28:48.248Z] Push succeeds to fork');
console.log('    [2025-11-05T12:28:50.768Z] Compare API error: 404');
console.log('    [continues failing for 5 attempts over 30+ seconds]');
console.log('');
console.log('  This is the fork mode Compare API issue.');
console.log('  The Compare API is being called with wrong format:');
console.log('    repos/xlabtg/anti-corruption/compare/main...issue-6-01d3f376c347');
console.log('');
console.log('  But branch only exists in fork: konard/anti-corruption');
console.log('  Should be:');
console.log('    repos/xlabtg/anti-corruption/compare/main...konard:issue-6-01d3f376c347\n');

console.log('=== Summary ===\n');
console.log('Problem 1 (v0.29.5): Identical CLAUDE.md content when reusing branches');
console.log('  Status: Fixed in v0.29.8 with timestamp');
console.log('  Evidence: Logs show v0.29.5 (before fix) failing\n');

console.log('Problem 2 (v0.29.7): Fork mode Compare API 404 errors');
console.log('  Status: Fixed in v0.29.9 with forkUser:branch format');
console.log('  Evidence: Logs show v0.29.7 failing with 404s\n');

console.log('Conclusion:');
console.log('  The fixes ARE correct and should work.');
console.log('  The logs show OLD versions failing.');
console.log('  User needs to test with v0.29.9 (current branch with all fixes).\n');

console.log('However, there may be a deeper issue...');
console.log('  Let me check if there is something else going on...\n');
