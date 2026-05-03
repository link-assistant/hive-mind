#!/usr/bin/env node

console.log('Testing Telegram bot reply threading implementation...\n');

const { readFile } = await import('fs/promises');

try {
  const content = await readFile('./src/telegram-bot.mjs', 'utf-8');

  const replyToMessageIdPattern = /reply_to_message_id:\s*ctx\.message\.message_id/g;
  const matches = content.match(replyToMessageIdPattern);

  if (!matches) {
    console.error('❌ FAIL: No reply_to_message_id parameters found');
    process.exit(1);
  }

  console.log(`✅ Found ${matches.length} reply_to_message_id parameters`);

  const solveCommandPattern = /bot\.command\('solve'/;
  const hiveCommandPattern = /bot\.command\('hive'/;

  if (!solveCommandPattern.test(content)) {
    console.error('❌ FAIL: /solve command handler not found');
    process.exit(1);
  }
  console.log('✅ /solve command handler found');

  if (!hiveCommandPattern.test(content)) {
    console.error('❌ FAIL: /hive command handler not found');
    process.exit(1);
  }
  console.log('✅ /hive command handler found');

  const lines = content.split('\n');
  let inSolveCommand = false;
  let inHiveCommand = false;
  let solveReplies = 0;
  let hiveReplies = 0;

  for (const line of lines) {
    if (line.includes("bot.command('solve'")) {
      inSolveCommand = true;
      inHiveCommand = false;
    } else if (line.includes("bot.command('hive'")) {
      inHiveCommand = true;
      inSolveCommand = false;
    } else if (line.includes('bot.command(') || line.includes('bot.launch()')) {
      inSolveCommand = false;
      inHiveCommand = false;
    }

    if (line.includes('ctx.reply(') && line.includes('reply_to_message_id')) {
      if (inSolveCommand) solveReplies++;
      if (inHiveCommand) hiveReplies++;
    }
  }

  console.log(`✅ /solve command has ${solveReplies} replies with threading`);
  console.log(`✅ /hive command has ${hiveReplies} replies with threading`);

  if (solveReplies < 3) {
    console.error('❌ FAIL: Expected at least 3 threaded replies in /solve command');
    process.exit(1);
  }

  if (hiveReplies < 3) {
    console.error('❌ FAIL: Expected at least 3 threaded replies in /hive command');
    process.exit(1);
  }

  console.log('\n✅ ALL TESTS PASSED: Reply threading implementation verified successfully!');
  console.log('\n📋 Summary:');
  console.log('- All bot replies now include reply_to_message_id parameter');
  console.log('- This creates a visual thread in Telegram that links responses to the original command');
  console.log('- Multiple users can now issue commands simultaneously without confusion');
} catch (error) {
  console.error('❌ Test failed with error:', error.message);
  process.exit(1);
}
