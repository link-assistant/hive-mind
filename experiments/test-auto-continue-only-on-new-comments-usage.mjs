#!/usr/bin/env node

/**
 * Example usage of --auto-continue-only-on-new-comments option
 *
 * This script demonstrates how to use the new option in different scenarios:
 *
 * 1. With auto-continue mode:
 *    ./solve.mjs "https://github.com/owner/repo/issues/123" --auto-continue --auto-continue-only-on-new-comments
 *
 * 2. With continue mode (PR URL):
 *    ./solve.mjs "https://github.com/owner/repo/pull/456" --auto-continue-only-on-new-comments
 *
 * 3. With resume + auto-continue-on-limit-reset:
 *    ./solve.mjs "https://github.com/owner/repo/issues/123" --resume session-id --auto-continue-on-limit-reset --auto-continue-only-on-new-comments
 *
 * Expected behavior:
 * - If there are no new comments (PR or issue comments) since the last commit, the script will exit with code 1
 * - If there are new comments, the script will continue as normal
 * - This helps prevent unnecessary auto-continuation when no human feedback is available
 */

console.log('📖 Auto-continue Only on New Comments Usage Examples');
console.log('');
console.log('Purpose: Prevent auto-continuation when there are no new comments');
console.log('');
console.log('🔧 Usage scenarios:');
console.log('');
console.log('1️⃣  Auto-continue with new comments check:');
console.log('   ./solve.mjs "https://github.com/owner/repo/issues/123" \\');
console.log('     --auto-continue --auto-continue-only-on-new-comments');
console.log('');
console.log('2️⃣  Continue mode with new comments check:');
console.log('   ./solve.mjs "https://github.com/owner/repo/pull/456" \\');
console.log('     --auto-continue-only-on-new-comments');
console.log('');
console.log('3️⃣  Resume with limit reset and new comments check:');
console.log('   ./solve.mjs "https://github.com/owner/repo/issues/123" \\');
console.log('     --resume session-id --auto-continue-on-limit-reset --auto-continue-only-on-new-comments');
console.log('');
console.log('✅ Success: Script continues if new comments are found');
console.log('❌ Failure: Script exits with code 1 if no new comments found');
console.log('');
console.log('💡 This option is useful for:');
console.log('   - Preventing unnecessary iterations when no human feedback is available');
console.log("   - Ensuring auto-continuation only happens when there's actionable input");
console.log('   - Automated workflows that should wait for human intervention');
