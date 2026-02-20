#!/usr/bin/env node

// Version information library for hive-mind project
// Provides comprehensive version information for bot, commands, and runtime
//
// Performance optimization (issue #1320):
// Uses Promise.all for parallel command execution instead of sequential execSync.
// This reduces version gathering time from ~30-150s to ~5s (limited by slowest command).

import { getVersion } from './version.lib.mjs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Execute a command asynchronously and return its output, or null if it fails
 * @param {string} command - Command to execute
 * @param {number} timeout - Timeout in milliseconds (default: 5000ms)
 * @returns {Promise<string|null>} Command output or null
 */
async function execCommandAsync(command, timeout = 5000) {
  try {
    const { stdout } = await execAsync(command, { timeout, maxBuffer: 1024 * 1024 });
    const trimmed = stdout.trim();
    // Return null if the output looks like an error message
    if (trimmed.includes('not found') || trimmed.includes('command not found') || trimmed === '') {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Command definitions for version checking
 * Each entry has: key, command, and optional fallbacks
 * @type {Array<{key: string, command: string, fallbacks?: string[]}>}
 */
const VERSION_COMMANDS = [
  // AI Agents and Tools (--tool options)
  { key: 'claudeCode', command: 'claude --version 2>&1' },
  { key: 'agent', command: 'agent --version 2>&1' },
  { key: 'codex', command: 'codex --version 2>&1' },
  { key: 'opencode', command: 'opencode --version 2>&1' },
  { key: 'qwenCode', command: 'qwen-code --version 2>&1' },
  { key: 'gemini', command: 'gemini --version 2>&1' },
  { key: 'copilot', command: 'copilot --version 2>&1' },

  // Browser Automation
  { key: 'playwright', command: 'playwright --version 2>&1' },
  { key: 'playwrightMcp', command: "npm list -g @playwright/mcp --depth=0 2>&1 | grep @playwright/mcp | awk '{print $2}'" },

  // JavaScript/Node.js ecosystem
  { key: 'bun', command: 'bun --version 2>&1' },
  { key: 'deno', command: 'deno --version 2>&1 | head -n1' },
  { key: 'npm', command: 'npm --version 2>&1' },
  { key: 'nvm', command: 'nvm --version 2>&1' },

  // Python ecosystem
  { key: 'python', command: 'python --version 2>&1' },
  { key: 'pyenv', command: 'pyenv --version 2>&1' },

  // Rust ecosystem
  { key: 'rust', command: 'rustc --version 2>&1' },
  { key: 'cargo', command: 'cargo --version 2>&1' },

  // Java ecosystem
  { key: 'java', command: 'java -version 2>&1 | head -n1' },
  { key: 'sdkman', command: "sdk version 2>&1 | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+'" },

  // Go
  { key: 'go', command: 'go version 2>&1' },

  // PHP
  { key: 'php', command: 'php --version 2>&1 | head -n1' },

  // .NET
  { key: 'dotnet', command: 'dotnet --version 2>&1' },

  // Perl ecosystem
  { key: 'perl', command: "perl -v 2>&1 | grep -oE 'v[0-9]+\\.[0-9]+\\.[0-9]+'" },
  { key: 'perlbrew', command: 'perlbrew --version 2>&1' },

  // OCaml/Rocq ecosystem
  { key: 'ocaml', command: 'ocaml --version 2>&1' },
  { key: 'opam', command: 'opam --version 2>&1' },
  // Rocq has fallback commands (rocq -> rocqc -> coqc)
  { key: 'rocq', command: 'rocq -v 2>&1 | head -n1', fallbacks: ['rocqc --version 2>&1 | head -n1', 'coqc --version 2>&1 | head -n1'] },

  // Lean ecosystem
  { key: 'lean', command: 'lean --version 2>&1' },
  { key: 'elan', command: 'elan --version 2>&1' },
  { key: 'lake', command: 'lake --version 2>&1' },

  // C/C++ Development Tools
  { key: 'gcc', command: 'gcc --version 2>&1 | head -n1' },
  { key: 'gpp', command: 'g++ --version 2>&1 | head -n1' },
  { key: 'clang', command: 'clang --version 2>&1 | head -n1' },
  { key: 'llvm', command: 'llvm-config --version 2>&1' },
  { key: 'lld', command: 'lld --version 2>&1 | head -n1' },
  { key: 'make', command: 'make --version 2>&1 | head -n1' },
  { key: 'cmake', command: 'cmake --version 2>&1 | head -n1' },

  // Development Tools
  { key: 'git', command: 'git --version 2>&1' },
  { key: 'gh', command: 'gh --version 2>&1 | head -n1' },
  { key: 'brew', command: 'brew --version 2>&1 | head -n1' },
];

/**
 * Execute a version command with optional fallbacks
 * @param {{key: string, command: string, fallbacks?: string[]}} cmdDef - Command definition
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<{key: string, value: string|null}>}
 */
async function executeVersionCommand(cmdDef, verbose) {
  let result = await execCommandAsync(cmdDef.command);

  // Try fallbacks if primary command failed
  if (!result && cmdDef.fallbacks) {
    for (const fallback of cmdDef.fallbacks) {
      result = await execCommandAsync(fallback);
      if (result) break;
    }
  }

  if (verbose && result) {
    console.log(`[VERBOSE] ${cmdDef.key}: ${result}`);
  } else if (verbose && !result) {
    console.log(`[VERBOSE] ${cmdDef.key}: not found`);
  }

  return { key: cmdDef.key, value: result };
}

/**
 * Get comprehensive version information for all components
 * Uses Promise.all for parallel execution (issue #1320)
 * @param {boolean} verbose - Enable verbose logging
 * @param {string} [processVersion] - Optional: version from the running process (for restart warning)
 * @returns {Promise<Object>} Version information object
 */
export async function getVersionInfo(verbose = false, processVersion = null) {
  const startTime = Date.now();

  try {
    if (verbose) {
      console.log('[VERBOSE] Gathering version information (parallel execution)...');
    }

    // Get hive-mind package version
    const packageVersion = await getVersion();
    if (verbose) {
      console.log(`[VERBOSE] Package version: ${packageVersion}`);
    }

    // Execute all version commands in parallel
    const results = await Promise.all(VERSION_COMMANDS.map(cmd => executeVersionCommand(cmd, verbose)));

    // Convert results array to object
    const versions = {};
    for (const { key, value } of results) {
      versions[key] = value;
    }

    // Add Node.js version (always available from process)
    versions.node = process.version;
    if (verbose) {
      console.log(`[VERBOSE] Node.js version: ${versions.node}`);
    }

    // Platform information
    const platform = process.platform;
    const arch = process.arch;
    versions.platform = `${platform} (${arch})`;
    if (verbose) {
      console.log(`[VERBOSE] Platform: ${versions.platform}`);
    }

    // Check if process version differs from installed version (restart warning)
    const needsRestart = processVersion && processVersion !== packageVersion;

    // Build version info object
    const versionInfo = {
      success: true,
      versions: {
        // Hive-mind package (single entry, not duplicated)
        hiveMind: packageVersion,
        processVersion: processVersion || packageVersion,
        needsRestart,

        // AI Agents (--tool options)
        claudeCode: versions.claudeCode,
        agent: versions.agent,
        codex: versions.codex,
        opencode: versions.opencode,
        qwenCode: versions.qwenCode,
        gemini: versions.gemini,
        copilot: versions.copilot,

        // Browser Automation
        playwright: versions.playwright,
        playwrightMcp: versions.playwrightMcp,

        // JavaScript/Node.js
        node: versions.node,
        bun: versions.bun,
        deno: versions.deno,
        npm: versions.npm,
        nvm: versions.nvm,

        // Python
        python: versions.python,
        pyenv: versions.pyenv,

        // Rust
        rust: versions.rust,
        cargo: versions.cargo,

        // Java
        java: versions.java,
        sdkman: versions.sdkman,

        // Go
        go: versions.go,

        // PHP
        php: versions.php,

        // .NET
        dotnet: versions.dotnet,

        // Perl
        perl: versions.perl,
        perlbrew: versions.perlbrew,

        // OCaml/Rocq
        ocaml: versions.ocaml,
        opam: versions.opam,
        rocq: versions.rocq,

        // Lean
        lean: versions.lean,
        elan: versions.elan,
        lake: versions.lake,

        // C/C++
        gcc: versions.gcc,
        gpp: versions.gpp,
        clang: versions.clang,
        llvm: versions.llvm,
        lld: versions.lld,
        make: versions.make,
        cmake: versions.cmake,

        // Development Tools
        git: versions.git,
        gh: versions.gh,
        brew: versions.brew,

        // Platform
        platform: versions.platform,
      },
      // Performance metrics
      gatherTimeMs: Date.now() - startTime,
    };

    if (verbose) {
      console.log(`[VERBOSE] Version info gathered in ${versionInfo.gatherTimeMs}ms`);
      console.log('[VERBOSE] Version info:', JSON.stringify(versionInfo, null, 2));
    }

    return versionInfo;
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] Error gathering version info:', error);
    }

    return {
      success: false,
      error: error.message || 'Failed to gather version information',
      gatherTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Helper to add version line if version exists
 * @param {string[]} lines - Array to push to
 * @param {string} label - Display label
 * @param {string|null} version - Version string or null
 */
function addVersionLine(lines, label, version) {
  if (version) {
    lines.push(`• ${label}: \`${version}\``);
  }
}

/**
 * Format version information as a Telegram message
 * Groups tools by programming language for better readability (issue #1320)
 * @param {Object} versions - Version information object
 * @returns {string} Formatted message
 */
export function formatVersionMessage(versions) {
  const lines = [];

  // === Hive-Mind Package (single entry with restart warning) ===
  lines.push('*🤖 Hive-Mind*');
  if (versions.hiveMind) {
    lines.push(`• Version: \`${versions.hiveMind}\``);
    if (versions.needsRestart) {
      lines.push(`⚠️ _Process running: \`${versions.processVersion}\` (restart needed)_`);
    }
  }

  // === AI Agents (--tool options) ===
  const agentLines = [];
  addVersionLine(agentLines, 'Claude Code', versions.claudeCode);
  addVersionLine(agentLines, 'Agent CLI', versions.agent);
  addVersionLine(agentLines, 'OpenAI Codex', versions.codex);
  addVersionLine(agentLines, 'OpenCode', versions.opencode);
  addVersionLine(agentLines, 'Qwen Code', versions.qwenCode);
  addVersionLine(agentLines, 'Gemini CLI', versions.gemini);
  addVersionLine(agentLines, 'GitHub Copilot', versions.copilot);

  if (agentLines.length > 0) {
    lines.push('');
    lines.push('*🎭 AI Agents*');
    lines.push(...agentLines);
  }

  // === JavaScript/Node.js ===
  const jsLines = [];
  addVersionLine(jsLines, 'Node.js', versions.node);
  addVersionLine(jsLines, 'Bun', versions.bun);
  addVersionLine(jsLines, 'Deno', versions.deno);
  addVersionLine(jsLines, 'NPM', versions.npm);
  addVersionLine(jsLines, 'NVM', versions.nvm);

  if (jsLines.length > 0) {
    lines.push('');
    lines.push('*📦 JavaScript/Node.js*');
    lines.push(...jsLines);
  }

  // === Python ===
  const pythonLines = [];
  addVersionLine(pythonLines, 'Python', versions.python);
  addVersionLine(pythonLines, 'Pyenv', versions.pyenv);

  if (pythonLines.length > 0) {
    lines.push('');
    lines.push('*🐍 Python*');
    lines.push(...pythonLines);
  }

  // === Rust ===
  const rustLines = [];
  addVersionLine(rustLines, 'Rustc', versions.rust);
  addVersionLine(rustLines, 'Cargo', versions.cargo);

  if (rustLines.length > 0) {
    lines.push('');
    lines.push('*🦀 Rust*');
    lines.push(...rustLines);
  }

  // === Java ===
  const javaLines = [];
  addVersionLine(javaLines, 'Java', versions.java);
  addVersionLine(javaLines, 'SDKMAN', versions.sdkman);

  if (javaLines.length > 0) {
    lines.push('');
    lines.push('*☕ Java*');
    lines.push(...javaLines);
  }

  // === Go ===
  if (versions.go) {
    lines.push('');
    lines.push('*🔷 Go*');
    addVersionLine(lines, 'Go', versions.go);
  }

  // === PHP ===
  if (versions.php) {
    lines.push('');
    lines.push('*🐘 PHP*');
    addVersionLine(lines, 'PHP', versions.php);
  }

  // === .NET ===
  if (versions.dotnet) {
    lines.push('');
    lines.push('*📦 .NET*');
    addVersionLine(lines, '.NET SDK', versions.dotnet);
  }

  // === Perl ===
  const perlLines = [];
  addVersionLine(perlLines, 'Perl', versions.perl);
  addVersionLine(perlLines, 'Perlbrew', versions.perlbrew);

  if (perlLines.length > 0) {
    lines.push('');
    lines.push('*💎 Perl*');
    lines.push(...perlLines);
  }

  // === OCaml/Rocq ===
  const ocamlLines = [];
  addVersionLine(ocamlLines, 'OCaml', versions.ocaml);
  addVersionLine(ocamlLines, 'Opam', versions.opam);
  addVersionLine(ocamlLines, 'Rocq/Coq', versions.rocq);

  if (ocamlLines.length > 0) {
    lines.push('');
    lines.push('*🐫 OCaml/Rocq*');
    lines.push(...ocamlLines);
  }

  // === Lean ===
  const leanLines = [];
  addVersionLine(leanLines, 'Lean', versions.lean);
  addVersionLine(leanLines, 'Elan', versions.elan);
  addVersionLine(leanLines, 'Lake', versions.lake);

  if (leanLines.length > 0) {
    lines.push('');
    lines.push('*📐 Lean*');
    lines.push(...leanLines);
  }

  // === C/C++ ===
  const cppLines = [];
  addVersionLine(cppLines, 'GCC', versions.gcc);
  addVersionLine(cppLines, 'G++', versions.gpp);
  addVersionLine(cppLines, 'Clang', versions.clang);
  addVersionLine(cppLines, 'LLVM', versions.llvm);
  addVersionLine(cppLines, 'LLD', versions.lld);
  addVersionLine(cppLines, 'Make', versions.make);
  addVersionLine(cppLines, 'CMake', versions.cmake);

  if (cppLines.length > 0) {
    lines.push('');
    lines.push('*🔨 C/C++*');
    lines.push(...cppLines);
  }

  // === Development Tools ===
  const toolLines = [];
  addVersionLine(toolLines, 'Git', versions.git);
  addVersionLine(toolLines, 'GitHub CLI', versions.gh);
  addVersionLine(toolLines, 'Playwright', versions.playwright);
  addVersionLine(toolLines, 'Playwright MCP', versions.playwrightMcp);
  addVersionLine(toolLines, 'Homebrew', versions.brew);

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
