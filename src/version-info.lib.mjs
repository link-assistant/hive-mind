#!/usr/bin/env node

// Version information library for hive-mind project
// Provides comprehensive version information for bot, commands, and runtime

import { getVersion } from './version.lib.mjs';
import { execSync } from 'child_process';

/**
 * Execute a command and return its output, or null if it fails
 * @param {string} command - Command to execute
 * @param {boolean} verbose - Enable verbose logging
 * @returns {string|null} Command output or null
 */
function execCommand(command, verbose = false) {
  try {
    const result = execSync(command, { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
    const trimmed = result.trim();
    // Return null if the output looks like an error message
    if (trimmed.includes('not found') || trimmed.includes('command not found') || trimmed === '') {
      return null;
    }
    return trimmed;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] Command failed: ${command}`, error.message);
    }
    return null;
  }
}

/**
 * Get comprehensive version information for all components
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<Object>} Version information object
 */
export async function getVersionInfo(verbose = false) {
  try {
    if (verbose) {
      console.log('[VERBOSE] Gathering version information...');
    }

    // Get hive-mind package version
    const packageVersion = await getVersion();
    if (verbose) {
      console.log(`[VERBOSE] Package version: ${packageVersion}`);
    }

    // === Agents ===

    // Claude Code
    const claudeVersion = execCommand('claude --version 2>&1', verbose);
    if (verbose && claudeVersion) {
      console.log(`[VERBOSE] Claude Code version: ${claudeVersion}`);
    }

    // Playwright
    const playwrightVersion = execCommand('playwright --version 2>&1', verbose);
    if (verbose && playwrightVersion) {
      console.log(`[VERBOSE] Playwright version: ${playwrightVersion}`);
    }

    // Playwright MCP (check if installed via npm)
    const playwrightMcpVersion = execCommand('npm list -g @playwright/mcp --depth=0 2>&1 | grep @playwright/mcp | awk \'{print $2}\'', verbose);
    if (verbose && playwrightMcpVersion) {
      console.log(`[VERBOSE] Playwright MCP version: ${playwrightMcpVersion}`);
    }

    // === Language Runtimes ===

    // Node.js (from process, always available)
    const nodeVersion = process.version;
    if (verbose) {
      console.log(`[VERBOSE] Node.js version: ${nodeVersion}`);
    }

    // Python
    const pythonVersion = execCommand('python --version 2>&1', verbose);
    if (verbose && pythonVersion) {
      console.log(`[VERBOSE] Python version: ${pythonVersion}`);
    }

    // Pyenv
    const pyenvVersion = execCommand('pyenv --version 2>&1', verbose);
    if (verbose && pyenvVersion) {
      console.log(`[VERBOSE] Pyenv version: ${pyenvVersion}`);
    }

    // Rust
    const rustVersion = execCommand('rustc --version 2>&1', verbose);
    if (verbose && rustVersion) {
      console.log(`[VERBOSE] Rust version: ${rustVersion}`);
    }

    // Cargo
    const cargoVersion = execCommand('cargo --version 2>&1', verbose);
    if (verbose && cargoVersion) {
      console.log(`[VERBOSE] Cargo version: ${cargoVersion}`);
    }

    // PHP
    const phpVersion = execCommand('php --version 2>&1 | head -n1', verbose);
    if (verbose && phpVersion) {
      console.log(`[VERBOSE] PHP version: ${phpVersion}`);
    }

    // Bun
    const bunVersion = execCommand('bun --version 2>&1', verbose);
    if (verbose && bunVersion) {
      console.log(`[VERBOSE] Bun version: ${bunVersion}`);
    }

    // .NET
    const dotnetVersion = execCommand('dotnet --version 2>&1', verbose);
    if (verbose && dotnetVersion) {
      console.log(`[VERBOSE] .NET version: ${dotnetVersion}`);
    }

    // === Development Tools ===

    // Git
    const gitVersion = execCommand('git --version 2>&1', verbose);
    if (verbose && gitVersion) {
      console.log(`[VERBOSE] Git version: ${gitVersion}`);
    }

    // GitHub CLI
    const ghVersion = execCommand('gh --version 2>&1 | head -n1', verbose);
    if (verbose && ghVersion) {
      console.log(`[VERBOSE] GitHub CLI version: ${ghVersion}`);
    }

    // NVM
    const nvmVersion = execCommand('nvm --version 2>&1', verbose);
    if (verbose && nvmVersion) {
      console.log(`[VERBOSE] NVM version: ${nvmVersion}`);
    }

    // Homebrew
    const brewVersion = execCommand('brew --version 2>&1 | head -n1', verbose);
    if (verbose && brewVersion) {
      console.log(`[VERBOSE] Homebrew version: ${brewVersion}`);
    }

    // NPM
    const npmVersion = execCommand('npm --version 2>&1', verbose);
    if (verbose && npmVersion) {
      console.log(`[VERBOSE] NPM version: ${npmVersion}`);
    }

    // === Platform Information ===
    const platform = process.platform;
    const arch = process.arch;
    if (verbose) {
      console.log(`[VERBOSE] Platform: ${platform} (${arch})`);
    }

    // Build version info object
    const versionInfo = {
      success: true,
      versions: {
        // Bot components
        bot: packageVersion,
        solve: packageVersion,
        hive: packageVersion,

        // Agents
        claudeCode: claudeVersion,
        playwright: playwrightVersion,
        playwrightMcp: playwrightMcpVersion,

        // Language runtimes
        node: nodeVersion,
        python: pythonVersion,
        rust: rustVersion,
        php: phpVersion,
        bun: bunVersion,
        dotnet: dotnetVersion,

        // Development tools
        git: gitVersion,
        gh: ghVersion,
        npm: npmVersion,
        nvm: nvmVersion,
        pyenv: pyenvVersion,
        cargo: cargoVersion,
        brew: brewVersion,

        // Platform
        platform: `${platform} (${arch})`,
      },
    };

    if (verbose) {
      console.log('[VERBOSE] Version info gathered successfully:', JSON.stringify(versionInfo, null, 2));
    }

    return versionInfo;
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] Error gathering version info:', error);
    }

    return {
      success: false,
      error: error.message || 'Failed to gather version information',
    };
  }
}

/**
 * Format version information as a Telegram message
 * @param {Object} versions - Version information object
 * @returns {string} Formatted message
 */
export function formatVersionMessage(versions) {
  const lines = [];

  // === Bot Components ===
  lines.push('*🤖 Bot Components*');
  if (versions.bot) {
    lines.push(`• Bot: \`${versions.bot}\``);
  }
  if (versions.solve) {
    lines.push(`• solve: \`${versions.solve}\``);
  }
  if (versions.hive) {
    lines.push(`• hive: \`${versions.hive}\``);
  }

  // === Agents ===
  const agentLines = [];
  if (versions.claudeCode) {
    agentLines.push(`• Claude Code: \`${versions.claudeCode}\``);
  }
  if (versions.playwright) {
    agentLines.push(`• Playwright: \`${versions.playwright}\``);
  }
  if (versions.playwrightMcp) {
    agentLines.push(`• Playwright MCP: \`${versions.playwrightMcp}\``);
  }

  if (agentLines.length > 0) {
    lines.push('');
    lines.push('*🎭 Agents*');
    lines.push(...agentLines);
  }

  // === Language Runtimes ===
  const runtimeLines = [];
  if (versions.node) {
    runtimeLines.push(`• Node.js: \`${versions.node}\``);
  }
  if (versions.python) {
    runtimeLines.push(`• Python: \`${versions.python}\``);
  }
  if (versions.rust) {
    runtimeLines.push(`• Rust: \`${versions.rust}\``);
  }
  if (versions.php) {
    runtimeLines.push(`• PHP: \`${versions.php}\``);
  }
  if (versions.bun) {
    runtimeLines.push(`• Bun: \`${versions.bun}\``);
  }
  if (versions.dotnet) {
    runtimeLines.push(`• .NET: \`${versions.dotnet}\``);
  }

  if (runtimeLines.length > 0) {
    lines.push('');
    lines.push('*⚙️ Language Runtimes*');
    lines.push(...runtimeLines);
  }

  // === Development Tools ===
  const toolLines = [];
  if (versions.git) {
    toolLines.push(`• Git: \`${versions.git}\``);
  }
  if (versions.gh) {
    toolLines.push(`• GitHub CLI: \`${versions.gh}\``);
  }
  if (versions.npm) {
    toolLines.push(`• NPM: \`${versions.npm}\``);
  }
  if (versions.nvm) {
    toolLines.push(`• NVM: \`${versions.nvm}\``);
  }
  if (versions.pyenv) {
    toolLines.push(`• Pyenv: \`${versions.pyenv}\``);
  }
  if (versions.cargo) {
    toolLines.push(`• Cargo: \`${versions.cargo}\``);
  }
  if (versions.brew) {
    toolLines.push(`• Homebrew: \`${versions.brew}\``);
  }

  if (toolLines.length > 0) {
    lines.push('');
    lines.push('*🛠 Development Tools*');
    lines.push(...toolLines);
  }

  // === Platform ===
  if (versions.platform) {
    lines.push('');
    lines.push('*💻 Platform*');
    lines.push(`• System: \`${versions.platform}\``);
  }

  return lines.join('\n');
}

export default {
  getVersionInfo,
  formatVersionMessage,
};
