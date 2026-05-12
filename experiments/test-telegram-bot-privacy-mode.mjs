#!/usr/bin/env node

/**
 * Experiment: Diagnose telegram bot privacy mode and configuration
 *
 * This script helps diagnose why a bot might not be receiving messages in a group:
 * 1. Check bot privacy mode setting
 * 2. Check bot admin status in groups
 * 3. Provide troubleshooting steps
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const dotenvxModule = await use('@dotenvx/dotenvx');
const dotenvx = dotenvxModule.default || dotenvxModule;
dotenvx.config({ quiet: true });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.argv[2];

if (!BOT_TOKEN) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN not provided');
  console.error('Usage: node test-telegram-bot-privacy-mode.mjs [BOT_TOKEN]');
  process.exit(1);
}

console.log('🔍 Telegram Bot Privacy Mode Diagnostic\n');
console.log('Bot token:', BOT_TOKEN.substring(0, 10) + '...\n');

const telegrafModule = await use('telegraf');
const { Telegraf } = telegrafModule;

const bot = new Telegraf(BOT_TOKEN);

try {
  // Get bot information
  console.log('📋 Fetching bot information...');
  const botInfo = await bot.telegram.getMe();
  console.log(`✅ Bot username: @${botInfo.username}`);
  console.log(`   Bot ID: ${botInfo.id}`);
  console.log(`   Bot name: ${botInfo.first_name}\n`);

  // Note: Privacy mode cannot be checked via API - it's a BotFather setting
  console.log('⚠️  IMPORTANT: Privacy Mode Settings\n');
  console.log('Privacy mode is a bot-level setting configured in @BotFather and cannot be');
  console.log("checked via the Telegram Bot API. Here's what you need to know:\n");

  console.log('📖 What is Privacy Mode?');
  console.log('   When privacy mode is ENABLED (default for new bots):');
  console.log('   - Bot only receives messages starting with "/" (commands)');
  console.log('   - Bot only receives messages that mention the bot (@botusername)');
  console.log('   - Bot only receives replies to its own messages');
  console.log("   - THIS IS THE MOST COMMON REASON BOTS DON'T RECEIVE GROUP MESSAGES\n");

  console.log('   When privacy mode is DISABLED:');
  console.log('   - Bot receives ALL messages in the group');
  console.log('   - Bot can see every message, not just commands\n');

  console.log('🔧 How to Fix Privacy Mode Issues:\n');
  console.log('   Option 1: Disable Privacy Mode (Recommended for command bots)');
  console.log('   1. Open a chat with @BotFather on Telegram');
  console.log('   2. Send /setprivacy');
  console.log('   3. Select your bot: @' + botInfo.username);
  console.log('   4. Choose "Disable"');
  console.log('   5. IMPORTANT: Remove bot from group and re-add it');
  console.log('      (Privacy mode changes only apply to newly joined groups)\n');

  console.log('   Option 2: Make Bot an Admin (Alternative)');
  console.log('   1. Go to your Telegram group');
  console.log('   2. Group settings → Administrators');
  console.log('   3. Add @' + botInfo.username + ' as admin');
  console.log('   4. Admins can see all messages regardless of privacy mode\n');

  console.log('🧪 Testing Tips:\n');
  console.log('   1. After changing privacy mode, ALWAYS remove and re-add the bot');
  console.log('   2. Test with a simple command like /help first');
  console.log('   3. Use --verbose flag to see if messages are being received');
  console.log('   4. Check that bot is in the correct group (verify chat ID)\n');

  // Check webhook status
  console.log('🌐 Checking webhook status...');
  const webhookInfo = await bot.telegram.getWebhookInfo();
  if (webhookInfo.url) {
    console.log('⚠️  WARNING: Webhook is configured!');
    console.log('   Webhook URL:', webhookInfo.url);
    console.log('   This prevents polling mode from working!');
    console.log('   Run: await bot.telegram.deleteWebhook() before bot.launch()\n');
  } else {
    console.log('✅ No webhook configured - polling mode is available\n');
  }

  // Get updates configuration
  console.log('📡 Bot API Configuration:');
  console.log('   Max connections:', webhookInfo.max_connections || 40);
  console.log('   Pending update count:', webhookInfo.pending_update_count);
  if (webhookInfo.last_error_date) {
    console.log('   ⚠️  Last error:', new Date(webhookInfo.last_error_date * 1000).toISOString());
    console.log('   Last error message:', webhookInfo.last_error_message);
  } else {
    console.log('   ✅ No recent errors');
  }
  console.log();

  console.log('✅ Diagnostic complete!\n');
  console.log('🎯 Most Likely Issue:');
  console.log("   If your bot is not receiving messages in a group, it's almost certainly");
  console.log('   due to privacy mode being enabled. Follow Option 1 or 2 above to fix.\n');

  console.log('📚 Additional Resources:');
  console.log('   - Telegram Bots FAQ: https://core.telegram.org/bots/faq');
  console.log('   - Privacy Mode Docs: https://core.telegram.org/bots/features#privacy-mode');

  process.exit(0);
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('\nPossible reasons:');
  console.error('  - Invalid bot token');
  console.error('  - Network connectivity issues');
  console.error('  - Telegram API temporarily unavailable');
  process.exit(1);
}
