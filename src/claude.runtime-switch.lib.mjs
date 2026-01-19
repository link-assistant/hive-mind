#!/usr/bin/env node
// Claude runtime switching module
// Extracted from claude.lib.mjs to maintain file line limits
// See: docs/case-studies/issue-1141

// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
import { log, cleanErrorMessage } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';

// Function to handle Claude runtime switching between Node.js and Bun
export const handleClaudeRuntimeSwitch = async argv => {
  if (argv['force-claude-bun-run']) {
    await log('\n🔧 Switching Claude runtime to bun...');
    try {
      try {
        await $`which bun`;
        await log('   ✅ Bun runtime found');
      } catch (bunError) {
        reportError(bunError, {
          context: 'claude.runtime-switch.lib.mjs - bun availability check',
          level: 'error',
        });
        await log('❌ Bun runtime not found. Please install bun first: https://bun.sh/', { level: 'error' });
        process.exit(1);
      }

      // Find Claude executable path
      const claudePathResult = await $`which claude`;
      const claudePath = claudePathResult.stdout.toString().trim();

      if (!claudePath) {
        await log('❌ Claude executable not found', { level: 'error' });
        process.exit(1);
      }

      await log(`   Claude path: ${claudePath}`);

      try {
        await fs.access(claudePath, fs.constants.W_OK);
      } catch (accessError) {
        reportError(accessError, {
          context: 'claude.runtime-switch.lib.mjs - Claude executable write permission check (bun)',
          level: 'error',
        });
        await log('❌ Cannot write to Claude executable (permission denied)', { level: 'error' });
        await log('   Try running with sudo or changing file permissions', { level: 'error' });
        process.exit(1);
      }
      // Read current shebang
      const firstLine = await $`head -1 "${claudePath}"`;
      const currentShebang = firstLine.stdout.toString().trim();
      await log(`   Current shebang: ${currentShebang}`);
      if (currentShebang.includes('bun')) {
        await log('   ✅ Claude is already configured to use bun');
        process.exit(0);
      }

      // Create backup
      const backupPath = `${claudePath}.nodejs-backup`;
      await $`cp "${claudePath}" "${backupPath}"`;
      await log(`   📦 Backup created: ${backupPath}`);

      // Read file content and replace shebang
      const content = await fs.readFile(claudePath, 'utf8');
      const newContent = content.replace(/^#!.*node.*$/m, '#!/usr/bin/env bun');

      if (content === newContent) {
        await log('⚠️  No Node.js shebang found to replace', { level: 'warning' });
        await log(`   Current shebang: ${currentShebang}`, { level: 'warning' });
        process.exit(0);
      }

      await fs.writeFile(claudePath, newContent);
      await log('   ✅ Claude shebang updated to use bun');
      await log('   🔄 Claude will now run with bun runtime');
    } catch (error) {
      await log(`❌ Failed to switch Claude to bun: ${cleanErrorMessage(error)}`, { level: 'error' });
      process.exit(1);
    }

    // Exit after switching runtime
    process.exit(0);
  }

  if (argv['force-claude-nodejs-run']) {
    await log('\n🔧 Restoring Claude runtime to Node.js...');
    try {
      try {
        await $`which node`;
        await log('   ✅ Node.js runtime found');
      } catch (nodeError) {
        reportError(nodeError, {
          context: 'claude.runtime-switch.lib.mjs - Node.js availability check',
          level: 'error',
        });
        await log('❌ Node.js runtime not found. Please install Node.js first', { level: 'error' });
        process.exit(1);
      }

      // Find Claude executable path
      const claudePathResult = await $`which claude`;
      const claudePath = claudePathResult.stdout.toString().trim();

      if (!claudePath) {
        await log('❌ Claude executable not found', { level: 'error' });
        process.exit(1);
      }

      await log(`   Claude path: ${claudePath}`);

      try {
        await fs.access(claudePath, fs.constants.W_OK);
      } catch (accessError) {
        reportError(accessError, {
          context: 'claude.runtime-switch.lib.mjs - Claude executable write permission check (nodejs)',
          level: 'error',
        });
        await log('❌ Cannot write to Claude executable (permission denied)', { level: 'error' });
        await log('   Try running with sudo or changing file permissions', { level: 'error' });
        process.exit(1);
      }
      // Read current shebang
      const firstLine = await $`head -1 "${claudePath}"`;
      const currentShebang = firstLine.stdout.toString().trim();
      await log(`   Current shebang: ${currentShebang}`);
      if (currentShebang.includes('node') && !currentShebang.includes('bun')) {
        await log('   ✅ Claude is already configured to use Node.js');
        process.exit(0);
      }

      const backupPath = `${claudePath}.nodejs-backup`;
      try {
        await fs.access(backupPath);
        // Restore from backup
        await $`cp "${backupPath}" "${claudePath}"`;
        await log(`   ✅ Restored Claude from backup: ${backupPath}`);
      } catch (backupError) {
        reportError(backupError, {
          context: 'claude_restore_backup',
          level: 'info',
        });
        // No backup available, manually update shebang
        await log('   📝 No backup found, manually updating shebang...');
        const content = await fs.readFile(claudePath, 'utf8');
        const newContent = content.replace(/^#!.*bun.*$/m, '#!/usr/bin/env node');

        if (content === newContent) {
          await log('⚠️  No bun shebang found to replace', { level: 'warning' });
          await log(`   Current shebang: ${currentShebang}`, { level: 'warning' });
          process.exit(0);
        }

        await fs.writeFile(claudePath, newContent);
        await log('   ✅ Claude shebang updated to use Node.js');
      }

      await log('   🔄 Claude will now run with Node.js runtime');
    } catch (error) {
      await log(`❌ Failed to restore Claude to Node.js: ${cleanErrorMessage(error)}`, { level: 'error' });
      process.exit(1);
    }

    // Exit after restoring runtime
    process.exit(0);
  }
};

export default {
  handleClaudeRuntimeSwitch,
};
