#!/usr/bin/env node

// Version information library for hive-mind project
// Provides comprehensive version information for bot, commands, and runtime
//
// Performance optimization (issue #1320):
// Runs commands concurrently with a shared limit and process-group cleanup.
// Optional probes must not accumulate child processes across repeated reports.

import { getVersion } from './version.lib.mjs';
import { t } from './i18n.lib.mjs';
import { hasConnectedPlaywrightMcpServer } from './playwright-mcp.lib.mjs';
import { execVersionCommand } from './version-command.lib.mjs';

import { parseVersion, normalizeDate } from './version-parsers.lib.mjs';
export { parseVersion, normalizeDate };

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
  { key: 'qwenCode', command: 'qwen --version 2>&1' },
  { key: 'gemini', command: 'gemini --version 2>&1' },
  { key: 'copilot', command: 'copilot --version 2>&1' },

  // Browser Automation
  { key: 'playwright', command: 'playwright --version 2>&1' },
  { key: 'playwrightTest', command: "npm list -g @playwright/test --depth=0 2>&1 | grep @playwright/test | awk '{print $2}'" },
  { key: 'playwrightMcp', command: "npm list -g @playwright/mcp --depth=0 2>&1 | grep @playwright/mcp | awk '{print $2}'" },
  { key: 'playwrightMcpClaudeStatus', command: 'timeout 5 claude mcp list 2>&1 | grep -i playwright | head -1' },
  { key: 'playwrightMcpCodexStatus', command: 'timeout 5 codex mcp list 2>&1 | grep -i playwright | head -1' },
  { key: 'puppeteerBrowsers', command: "npm list -g @puppeteer/browsers --depth=0 2>&1 | grep @puppeteer/browsers | awk '{print $2}'" },

  // Browsers (installed via Playwright)
  { key: 'chrome', command: 'google-chrome --version 2>&1' },
  { key: 'chromium', command: 'chromium --version 2>&1', fallbacks: ['chromium-browser --version 2>&1', "ls ~/.cache/ms-playwright/ 2>/dev/null | grep -oE 'chromium-[0-9]+' | head -1"] },
  { key: 'firefox', command: 'firefox --version 2>&1', fallbacks: ["ls ~/.cache/ms-playwright/ 2>/dev/null | grep -oE 'firefox-[0-9]+' | head -1"] },
  { key: 'msedge', command: 'microsoft-edge --version 2>&1', fallbacks: ['microsoft-edge-stable --version 2>&1'] },
  { key: 'webkit', command: "ls ~/.cache/ms-playwright/ 2>/dev/null | grep -oE 'webkit-[0-9]+' | head -1" },

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
  { key: 'lld', command: 'ld.lld --version 2>&1 | head -n1', fallbacks: ['lld --version 2>&1 | head -n1'] },
  { key: 'make', command: 'make --version 2>&1 | head -n1' },
  { key: 'cmake', command: 'cmake --version 2>&1 | head -n1' },

  // Ruby ecosystem
  { key: 'ruby', command: 'ruby --version 2>&1' },
  { key: 'rbenv', command: 'rbenv --version 2>&1' },

  // Kotlin
  { key: 'kotlin', command: 'kotlin -version 2>&1' },

  // Swift
  { key: 'swift', command: 'swift --version 2>&1 | head -n1' },

  // R
  { key: 'r', command: 'R --version 2>&1 | head -n1' },

  // Development Tools
  { key: 'git', command: 'git --version 2>&1' },
  { key: 'gh', command: 'gh --version 2>&1 | head -n1' },
  { key: 'glab', command: 'glab --version 2>&1 | head -n1' },
  { key: 'brew', command: 'brew --version 2>&1 | head -n1' },
  { key: 'nasm', command: 'nasm --version 2>&1' },
  { key: 'fasm', command: 'fasm 2>&1 | head -n1' },
  { key: 'curl', command: 'curl --version 2>&1 | head -n1' },
  { key: 'wget', command: 'wget --version 2>&1 | head -n1' },
  { key: 'zip', command: 'zip --version 2>&1 | head -n2 | tail -n1' },
  { key: 'unzip', command: 'unzip -v 2>&1 | head -n1' },
  { key: 'expect', command: 'expect -version 2>&1' },
  { key: 'screen', command: 'screen --version 2>&1' },
  { key: 'xvfb', command: 'dpkg -l xvfb 2>/dev/null | grep "^ii" | head -1', fallbacks: ['Xvfb -version 2>&1 | head -n1'] },
];

/**
 * Execute a version command with optional fallbacks
 * @param {{key: string, command: string, fallbacks?: string[]}} cmdDef - Command definition
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<{key: string, value: string|null}>}
 */
async function executeVersionCommand(cmdDef, verbose, runCommand) {
  let result = await runCommand(cmdDef.command);

  // Try fallbacks if primary command failed
  if (!result && cmdDef.fallbacks) {
    for (const fallback of cmdDef.fallbacks) {
      result = await runCommand(fallback);
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
 * Map of process.arch values to human-friendly architecture names
 */
const ARCH_NAMES = {
  x64: 'AMD64 (x86-64)',
  arm64: 'ARM64 (aarch64)',
  arm: 'ARM32',
  ia32: 'x86 (IA-32)',
  mips: 'MIPS',
  mipsel: 'MIPS (LE)',
  ppc64: 'PowerPC 64',
  s390x: 's390x',
  riscv64: 'RISC-V 64',
};

/**
 * Detect detailed platform information: environment type, OS, architecture, kernel.
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<{environment: string, arch: string, os: string, kernel: string}>}
 */
async function detectPlatformInfo(verbose, runCommand) {
  const info = { environment: '', arch: '', os: '', kernel: '' };

  // Architecture
  info.arch = ARCH_NAMES[process.arch] || process.arch;

  // Kernel
  const uname = await runCommand('uname -r 2>/dev/null');
  if (uname) {
    info.kernel = `Linux ${uname}`;
  } else if (process.platform === 'darwin') {
    const darwinVer = await runCommand('uname -r 2>/dev/null');
    info.kernel = darwinVer ? `Darwin ${darwinVer}` : 'Darwin';
  } else if (process.platform === 'win32') {
    info.kernel = 'Windows NT';
  }

  // OS detection
  if (process.platform === 'linux') {
    // Try /etc/os-release for distro info
    const osRelease = await runCommand('cat /etc/os-release 2>/dev/null');
    if (osRelease) {
      const nameMatch = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      if (nameMatch) {
        info.os = nameMatch[1];
      } else {
        const idMatch = osRelease.match(/^ID="?([^"\n]+)"?/m);
        const versionMatch = osRelease.match(/^VERSION_ID="?([^"\n]+)"?/m);
        if (idMatch) {
          info.os = versionMatch ? `${idMatch[1]} ${versionMatch[1]}` : idMatch[1];
        }
      }
    }
    if (!info.os) info.os = 'Linux';
  } else if (process.platform === 'darwin') {
    const swVers = await runCommand('sw_vers -productVersion 2>/dev/null');
    info.os = swVers ? `macOS ${swVers}` : 'macOS';
  } else if (process.platform === 'win32') {
    info.os = 'Windows';
  } else {
    info.os = process.platform;
  }

  // Environment detection: docker container, VM, or host
  const isDocker = await runCommand('cat /proc/1/cgroup 2>/dev/null | grep -qi docker && echo docker || test -f /.dockerenv && echo docker || echo no');
  if (isDocker && isDocker.trim() === 'docker') {
    info.environment = 'docker container';
  } else {
    // Check for VM/hypervisor
    const systemdDetect = await runCommand('systemd-detect-virt 2>/dev/null');
    if (systemdDetect && systemdDetect !== 'none') {
      info.environment = `virtual machine (${systemdDetect})`;
    } else {
      const dmi = await runCommand('cat /sys/class/dmi/id/product_name 2>/dev/null');
      if (dmi && /virtual|vmware|kvm|qemu|hyper-v|xen|bochs/i.test(dmi)) {
        info.environment = `virtual machine`;
      } else {
        info.environment = 'host machine';
      }
    }
  }

  if (verbose) {
    console.log(`[VERBOSE] Platform detection: ${JSON.stringify(info)}`);
  }

  return info;
}

/**
 * Get comprehensive version information for all components
 * Uses Promise.all for parallel execution (issue #1320)
 * @param {boolean} verbose - Enable verbose logging
 * @param {string} [processVersion] - Optional: version from the running process (for restart warning)
 * @returns {Promise<Object>} Version information object
 */
export async function getVersionInfo(verbose = false, processVersion = null, { runCommand = execVersionCommand } = {}) {
  const startTime = Date.now();
  if (verbose && runCommand === execVersionCommand) runCommand = command => execVersionCommand(command, 5000, { onDiagnostic: message => console.log(`[VERBOSE] ${message}`) });

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
    const results = await Promise.all(VERSION_COMMANDS.map(cmd => executeVersionCommand(cmd, verbose, runCommand)));

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

    // Platform information — detailed detection
    const platformInfo = await detectPlatformInfo(verbose, runCommand);
    versions.platformEnvironment = platformInfo.environment;
    versions.platformArch = platformInfo.arch;
    versions.platformOs = platformInfo.os;
    versions.platformKernel = platformInfo.kernel;
    // Keep legacy field for backward compat
    versions.platform = platformInfo.os;
    if (verbose) {
      console.log(`[VERBOSE] Platform: env=${platformInfo.environment}, arch=${platformInfo.arch}, os=${platformInfo.os}, kernel=${platformInfo.kernel}`);
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
        playwrightTest: versions.playwrightTest,
        playwrightMcp: versions.playwrightMcp,
        playwrightMcpClaudeStatus: versions.playwrightMcpClaudeStatus,
        playwrightMcpCodexStatus: versions.playwrightMcpCodexStatus,
        puppeteerBrowsers: versions.puppeteerBrowsers,

        // Browsers
        chrome: versions.chrome,
        chromium: versions.chromium,
        firefox: versions.firefox,
        msedge: versions.msedge,
        webkit: versions.webkit,

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

        // Ruby
        ruby: versions.ruby,
        rbenv: versions.rbenv,

        // Kotlin
        kotlin: versions.kotlin,

        // Swift
        swift: versions.swift,

        // R
        r: versions.r,

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
        glab: versions.glab,
        brew: versions.brew,
        nasm: versions.nasm,
        fasm: versions.fasm,
        curl: versions.curl,
        wget: versions.wget,
        zip: versions.zip,
        unzip: versions.unzip,
        expect: versions.expect,
        screen: versions.screen,
        xvfb: versions.xvfb,

        // Platform (detailed)
        platform: versions.platform,
        platformEnvironment: versions.platformEnvironment,
        platformArch: versions.platformArch,
        platformOs: versions.platformOs,
        platformKernel: versions.platformKernel,
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
 * Helper to add version line if version exists.
 * Uses parseVersion() to normalize raw output into uniform format.
 * @param {string[]} lines - Array to push to
 * @param {string} label - Display label
 * @param {string|null} version - Version string or null
 * @param {string} [key] - Tool key for version parser lookup
 */
const ENGLISH_VERSION_LABELS = {
  ai_agents: 'AI Agents',
  browsers: 'Browsers',
  browser_automation: 'Browser Automation',
  connected: 'connected',
  development_tools: 'Development Tools',
  environment: 'Environment',
  architecture: 'Architecture',
  kernel: 'Kernel',
  not_connected: 'not connected',
  os: 'OS',
  platform: 'Platform',
  process_running_restart_needed: 'Process running: `{{processVersion}}` (restart needed)',
  system: 'System',
  version: 'Version',
};

function resolveVersionLocale(options = {}) {
  if (typeof options === 'string') return options;
  return options?.locale || null;
}

function vt(key, params = {}, options = {}) {
  const fullKey = `version.${key}`;
  const locale = resolveVersionLocale(options);
  const value = t(fullKey, params, locale ? { locale } : {});
  if (value !== fullKey) return value;
  let fallback = ENGLISH_VERSION_LABELS[key] || key;
  for (const [paramKey, paramValue] of Object.entries(params)) {
    fallback = fallback.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(paramValue));
  }
  return fallback;
}

function addVersionLine(lines, label, version, key) {
  if (version) {
    const display = key ? parseVersion(key, version) : version;
    lines.push(`• ${label}: \`${display}\``);
  }
}

/**
 * Format version information as a Telegram message
 * Groups tools by programming language for better readability (issue #1320)
 * @param {Object} versions - Version information object
 * @returns {string} Formatted message
 */
export function formatVersionMessage(versions, options = {}) {
  const locale = resolveVersionLocale(options);
  const vOptions = { locale };
  const lines = [];

  // === Hive-Mind Package (single entry with restart warning) ===
  lines.push('*🤖 Hive-Mind*');
  if (versions.hiveMind) {
    lines.push(`• ${vt('version', {}, vOptions)}: \`${versions.hiveMind}\``);
    if (versions.needsRestart) {
      lines.push(`⚠️ _${vt('process_running_restart_needed', { processVersion: versions.processVersion }, vOptions)}_`);
    }
  }

  // === AI Agents (--tool options) ===
  const agentLines = [];
  addVersionLine(agentLines, 'Claude Code', versions.claudeCode, 'claudeCode');
  addVersionLine(agentLines, 'Agent CLI', versions.agent, 'agent');
  addVersionLine(agentLines, 'OpenAI Codex', versions.codex, 'codex');
  addVersionLine(agentLines, 'OpenCode', versions.opencode, 'opencode');
  addVersionLine(agentLines, 'Qwen Code', versions.qwenCode, 'qwenCode');
  addVersionLine(agentLines, 'Gemini CLI', versions.gemini, 'gemini');
  addVersionLine(agentLines, 'GitHub Copilot', versions.copilot, 'copilot');

  if (agentLines.length > 0) {
    lines.push('');
    lines.push(`*🎭 ${vt('ai_agents', {}, vOptions)}*`);
    lines.push(...agentLines);
  }

  // === JavaScript/Node.js ===
  const jsLines = [];
  addVersionLine(jsLines, 'Node.js', versions.node);
  addVersionLine(jsLines, 'Bun', versions.bun);
  addVersionLine(jsLines, 'Deno', versions.deno, 'deno');
  addVersionLine(jsLines, 'NPM', versions.npm);
  addVersionLine(jsLines, 'NVM', versions.nvm);

  if (jsLines.length > 0) {
    lines.push('');
    lines.push('*📦 JavaScript/Node.js*');
    lines.push(...jsLines);
  }

  // === Python ===
  const pythonLines = [];
  addVersionLine(pythonLines, 'Python', versions.python, 'python');
  addVersionLine(pythonLines, 'Pyenv', versions.pyenv, 'pyenv');

  if (pythonLines.length > 0) {
    lines.push('');
    lines.push('*🐍 Python*');
    lines.push(...pythonLines);
  }

  // === Rust ===
  const rustLines = [];
  addVersionLine(rustLines, 'Rustc', versions.rust, 'rust');
  addVersionLine(rustLines, 'Cargo', versions.cargo, 'cargo');

  if (rustLines.length > 0) {
    lines.push('');
    lines.push('*🦀 Rust*');
    lines.push(...rustLines);
  }

  // === Java ===
  const javaLines = [];
  addVersionLine(javaLines, 'Java', versions.java, 'java');
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
    addVersionLine(lines, 'Go', versions.go, 'go');
  }

  // === PHP ===
  if (versions.php) {
    lines.push('');
    lines.push('*🐘 PHP*');
    addVersionLine(lines, 'PHP', versions.php, 'php');
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
  addVersionLine(perlLines, 'Perlbrew', versions.perlbrew, 'perlbrew');

  if (perlLines.length > 0) {
    lines.push('');
    lines.push('*🐪 Perl*');
    lines.push(...perlLines);
  }

  // === OCaml/Rocq ===
  const ocamlLines = [];
  addVersionLine(ocamlLines, 'OCaml', versions.ocaml, 'ocaml');
  addVersionLine(ocamlLines, 'Opam', versions.opam);
  addVersionLine(ocamlLines, 'Rocq/Coq', versions.rocq, 'rocq');

  if (ocamlLines.length > 0) {
    lines.push('');
    lines.push('*🐫 OCaml/Rocq*');
    lines.push(...ocamlLines);
  }

  // === Lean ===
  const leanLines = [];
  addVersionLine(leanLines, 'Lean', versions.lean, 'lean');
  addVersionLine(leanLines, 'Elan', versions.elan, 'elan');
  addVersionLine(leanLines, 'Lake', versions.lake);

  if (leanLines.length > 0) {
    lines.push('');
    lines.push('*📐 Lean*');
    lines.push(...leanLines);
  }

  // === Ruby ===
  const rubyLines = [];
  addVersionLine(rubyLines, 'Ruby', versions.ruby, 'ruby');
  addVersionLine(rubyLines, 'Rbenv', versions.rbenv, 'rbenv');

  if (rubyLines.length > 0) {
    lines.push('');
    lines.push('*💎 Ruby*');
    lines.push(...rubyLines);
  }

  // === Kotlin ===
  if (versions.kotlin) {
    lines.push('');
    lines.push('*🟣 Kotlin*');
    addVersionLine(lines, 'Kotlin', versions.kotlin, 'kotlin');
  }

  // === Swift ===
  if (versions.swift) {
    lines.push('');
    lines.push('*🦅 Swift*');
    addVersionLine(lines, 'Swift', versions.swift, 'swift');
  }

  // === R ===
  if (versions.r) {
    lines.push('');
    lines.push('*📊 R*');
    addVersionLine(lines, 'R', versions.r, 'r');
  }

  // === C/C++ ===
  const cppLines = [];
  addVersionLine(cppLines, 'GCC', versions.gcc, 'gcc');
  addVersionLine(cppLines, 'G++', versions.gpp, 'gpp');
  addVersionLine(cppLines, 'Clang', versions.clang, 'clang');
  addVersionLine(cppLines, 'LLVM', versions.llvm);
  addVersionLine(cppLines, 'LLD', versions.lld, 'lld');
  addVersionLine(cppLines, 'Make', versions.make, 'make');
  addVersionLine(cppLines, 'CMake', versions.cmake, 'cmake');
  addVersionLine(cppLines, 'NASM', versions.nasm, 'nasm');
  addVersionLine(cppLines, 'FASM', versions.fasm, 'fasm');

  if (cppLines.length > 0) {
    lines.push('');
    lines.push('*🔨 C, C++, Assembly*');
    lines.push(...cppLines);
  }

  // === Browsers ===
  const browserLines = [];
  addVersionLine(browserLines, 'Google Chrome', versions.chrome, 'chrome');
  addVersionLine(browserLines, 'Chromium', versions.chromium, 'chromium');
  addVersionLine(browserLines, 'Firefox', versions.firefox, 'firefox');
  addVersionLine(browserLines, 'Microsoft Edge', versions.msedge, 'msedge');
  addVersionLine(browserLines, 'WebKit', versions.webkit);

  if (browserLines.length > 0) {
    lines.push('');
    lines.push(`*🌐 ${vt('browsers', {}, vOptions)}*`);
    lines.push(...browserLines);
  }

  // === Browser Automation ===
  const browserAutoLines = [];
  addVersionLine(browserAutoLines, 'Playwright', versions.playwright, 'playwright');
  addVersionLine(browserAutoLines, 'Playwright Test', versions.playwrightTest, 'playwrightTest');
  // Playwright MCP: show version with Claude Code and Codex connection status inline
  if (versions.playwrightMcp) {
    const mcpVersion = parseVersion('playwrightMcp', versions.playwrightMcp);
    const claudeStatus = hasConnectedPlaywrightMcpServer(versions.playwrightMcpClaudeStatus) ? vt('connected', {}, vOptions) : vt('not_connected', {}, vOptions);
    const codexStatus = hasConnectedPlaywrightMcpServer(versions.playwrightMcpCodexStatus) ? vt('connected', {}, vOptions) : vt('not_connected', {}, vOptions);
    browserAutoLines.push(`• Playwright MCP: \`${mcpVersion} | Claude Code: ${claudeStatus} | Codex: ${codexStatus}\``);
  }
  addVersionLine(browserAutoLines, 'Puppeteer Browsers', versions.puppeteerBrowsers, 'puppeteerBrowsers');

  if (browserAutoLines.length > 0) {
    lines.push('');
    lines.push(`*🎭 ${vt('browser_automation', {}, vOptions)}*`);
    lines.push(...browserAutoLines);
  }

  // === Development Tools ===
  const toolLines = [];
  addVersionLine(toolLines, 'Git', versions.git, 'git');
  addVersionLine(toolLines, 'GitHub CLI', versions.gh, 'gh');
  addVersionLine(toolLines, 'GitLab CLI', versions.glab, 'glab');
  addVersionLine(toolLines, 'Homebrew', versions.brew, 'brew');
  addVersionLine(toolLines, 'cURL', versions.curl, 'curl');
  addVersionLine(toolLines, 'Wget', versions.wget, 'wget');
  addVersionLine(toolLines, 'Zip', versions.zip, 'zip');
  addVersionLine(toolLines, 'Unzip', versions.unzip, 'unzip');
  addVersionLine(toolLines, 'Expect', versions.expect, 'expect');
  addVersionLine(toolLines, 'Screen', versions.screen, 'screen');
  addVersionLine(toolLines, 'Xvfb', versions.xvfb, 'xvfb');

  if (toolLines.length > 0) {
    lines.push('');
    lines.push(`*🛠 ${vt('development_tools', {}, vOptions)}*`);
    lines.push(...toolLines);
  }

  // === Platform (detailed) ===
  {
    const platformLines = [];
    if (versions.platformEnvironment) platformLines.push(`• ${vt('environment', {}, vOptions)}: \`${versions.platformEnvironment}\``);
    if (versions.platformArch) platformLines.push(`• ${vt('architecture', {}, vOptions)}: \`${versions.platformArch}\``);
    if (versions.platformOs) platformLines.push(`• ${vt('os', {}, vOptions)}: \`${versions.platformOs}\``);
    if (versions.platformKernel) platformLines.push(`• ${vt('kernel', {}, vOptions)}: \`${versions.platformKernel}\``);
    // Fallback to legacy single-line format
    if (platformLines.length === 0 && versions.platform) {
      platformLines.push(`• ${vt('system', {}, vOptions)}: \`${versions.platform}\``);
    }
    if (platformLines.length > 0) {
      lines.push('');
      lines.push(`*💻 ${vt('platform', {}, vOptions)}*`);
      lines.push(...platformLines);
    }
  }

  return lines.join('\n');
}

export default {
  getVersionInfo,
  formatVersionMessage,
  parseVersion,
  normalizeDate,
};
