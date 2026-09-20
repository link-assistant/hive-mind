#!/usr/bin/env node

/**
 * Experiment: Test Telegraf webhook vs polling issue
 *
 * Research common reasons why Telegraf bots don't receive messages:
 * 1. Webhook still active (conflicts with polling)
 * 2. Missing polling configuration
 * 3. Bot not started properly
 * 4. Network/firewall issues
 * 5. Bot token issues
 */

console.log('🧪 Testing Telegraf polling issues...\n');

console.log("Common reasons Telegraf bots don't receive messages:\n");

console.log('1. Webhook still active (most common):');
console.log('   - If bot previously used webhooks, need to delete webhook first');
console.log('   - Solution: Call deleteWebhook() before launch()');
console.log('   - API: https://core.telegram.org/bots/api#deletewebhook\n');

console.log('2. Polling not enabled:');
console.log('   - bot.launch() uses polling by default');
console.log('   - But might need explicit polling configuration\n');

console.log('3. allowedUpdates configuration:');
console.log('   - Empty array blocks all updates');
console.log('   - Should use: ["message"] for commands');
console.log('   - Current code has this, should work\n');

console.log('4. Bot token issues:');
console.log('   - Invalid or revoked token');
console.log('   - Token from wrong environment\n');

console.log('5. Message filtering too aggressive:');
console.log('   - isOldMessage() might have wrong logic');
console.log('   - Date comparison issues (ms vs seconds)\n');

console.log('📋 Recommended fix:');
console.log('   Add deleteWebhook() call before bot.launch():');
console.log('   await bot.telegram.deleteWebhook({ drop_pending_updates: true })');
console.log('   This ensures polling can start cleanly\n');

console.log('✅ Test complete!');
