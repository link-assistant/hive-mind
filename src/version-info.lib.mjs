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
 * Per-tool regex parsers to normalize raw --version output into uniform format:
 *   <version> (<commit>, <revision>, <date>, etc.)
 *
 * Each parser returns { version, extra[] } or null if it doesn't match.
 * The `version` is the most specific version string (for bug reporting).
 * Items in `extra` are joined with ", " and placed in parentheses.
 *
 * @type {Record<string, (raw: string) => {version: string, extra: string[]} | null>}
 */
const VERSION_PARSERS = {
  // rustc 1.94.1 (e408947bf 2026-03-25)
  rust: raw => {
    const m = raw.match(/^rustc\s+([\d.]+(?:-\S+)?)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    const extra = m[2] ? m[2].trim().split(/\s+/) : [];
    return { version: m[1], extra };
  },
  // cargo 1.94.1 (29ea6fb6a 2026-03-24)
  cargo: raw => {
    const m = raw.match(/^cargo\s+([\d.]+(?:-\S+)?)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    const extra = m[2] ? m[2].trim().split(/\s+/) : [];
    return { version: m[1], extra };
  },
  // go version go1.26.1 linux/amd64
  go: raw => {
    const m = raw.match(/go([\d.]+(?:\S*)?)\s+(.*)/);
    if (!m) return null;
    return { version: m[1], extra: [m[2].trim()] };
  },
  // PHP 8.3.30 (cli) (built: Jan 13 2026 22:36:55) (NTS)
  php: raw => {
    const m = raw.match(/^PHP\s+([\d.]+(?:-\S+)?)\s*(.*)/);
    if (!m) return null;
    const tags = [];
    const parts = m[2].matchAll(/\(([^)]+)\)/g);
    for (const p of parts) tags.push(p[1]);
    return { version: m[1], extra: tags };
  },
  // openjdk version "21" 2023-09-19 LTS
  java: raw => {
    const m = raw.match(/version\s+"([^"]+)"(?:\s+(.+))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2].trim()] : [] };
  },
  // gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0
  gcc: raw => {
    const m = raw.match(/^gcc\s+(?:\(([^)]+)\)\s+)?([\d.]+)/);
    if (!m) return null;
    return { version: m[2], extra: m[1] ? [m[1]] : [] };
  },
  // g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0
  gpp: raw => {
    const m = raw.match(/^g\+\+\s+(?:\(([^)]+)\)\s+)?([\d.]+)/);
    if (!m) return null;
    return { version: m[2], extra: m[1] ? [m[1]] : [] };
  },
  // clang version 17.0.0 (https://github.com/... commit)
  clang: raw => {
    const m = raw.match(/^clang\s+version\s+([\d.]+(?:-\S+)?)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2].trim()] : [] };
  },
  // LLD 17.0.0 (compatible with GNU linkers)
  lld: raw => {
    const m = raw.match(/^LLD\s+([\d.]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2].trim()] : [] };
  },
  // Python 3.14.3
  python: raw => {
    const m = raw.match(/^Python\s+([\d.]+(?:\S*)?)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // ruby 3.4.9 (2026-03-11 revision 76cca827ab) +PRISM [x86_64-linux]
  ruby: raw => {
    const m = raw.match(/^ruby\s+([\d.]+(?:p\d+)?)\s*(?:\(([^)]+)\))?\s*(.*)/);
    if (!m) return null;
    const extra = [];
    if (m[2]) extra.push(m[2].trim());
    const tail = m[3] ? m[3].trim() : '';
    if (tail) extra.push(tail);
    return { version: m[1], extra };
  },
  // Kotlin version 2.3.20-release-208 (JRE 21+35-LTS)
  kotlin: raw => {
    const m = raw.match(/^Kotlin\s+version\s+([\d.\-\w]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2].trim()] : [] };
  },
  // Swift version 6.0.3 (swift-6.0.3-RELEASE)
  swift: raw => {
    const m = raw.match(/^Swift\s+version\s+([\d.]+(?:\.\d+)?)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2].trim()] : [] };
  },
  // R version 4.3.3 (2024-02-29) -- "Angel Food Cake"
  r: raw => {
    const m = raw.match(/^R\s+version\s+([\d.]+)\s*(?:\(([^)]+)\))?(?:\s+--\s+"([^"]+)")?/);
    if (!m) return null;
    const extra = [];
    if (m[2]) extra.push(m[2]);
    if (m[3]) extra.push(m[3]);
    return { version: m[1], extra };
  },
  // git version 2.43.0
  git: raw => {
    const m = raw.match(/^git\s+version\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // gh version 2.89.0 (2026-03-26)
  gh: raw => {
    const m = raw.match(/^gh\s+version\s+([\d.]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2]] : [] };
  },
  // glab version 1.36.0
  glab: raw => {
    const m = raw.match(/^glab\s+version\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // curl 8.19.0 (x86_64-pc-linux-gnu) libcurl/8.19.0 ...
  curl: raw => {
    const m = raw.match(/^curl\s+([\d.]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2]] : [] };
  },
  // GNU Wget 1.21.4 built on linux-gnu.
  wget: raw => {
    const m = raw.match(/^GNU\s+Wget\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // cmake version 3.28.3
  cmake: raw => {
    const m = raw.match(/^cmake\s+version\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // GNU Make 4.3
  make: raw => {
    const m = raw.match(/^GNU\s+Make\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // NASM version 2.16.01
  nasm: raw => {
    const m = raw.match(/^NASM\s+version\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // flat assembler  version 1.73.32
  fasm: raw => {
    const m = raw.match(/version\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // Screen version 4.09.01 (GNU) 20-Aug-23
  screen: raw => {
    const m = raw.match(/^Screen\s+version\s+([\d.]+)\s*(?:\(([^)]+)\))?\s*(.*)/);
    if (!m) return null;
    const extra = [];
    if (m[2]) extra.push(m[2]);
    if (m[3] && m[3].trim()) extra.push(m[3].trim());
    return { version: m[1], extra };
  },
  // expect version 5.45.4
  expect: raw => {
    const m = raw.match(/^expect\s+version\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // The OCaml toplevel, version 5.4.1
  ocaml: raw => {
    const m = raw.match(/version\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // The Rocq Prover, version 9.1.1
  rocq: raw => {
    const m = raw.match(/version\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // elan 4.2.1 (3d5138e15 2026-03-18)
  elan: raw => {
    const m = raw.match(/^elan\s+([\d.]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    const extra = m[2] ? m[2].trim().split(/\s+/) : [];
    return { version: m[1], extra };
  },
  // Lean (version 4.29.0, x86_64-unknown-linux-gnu, commit abc123, Release)
  lean: raw => {
    const m = raw.match(/version\s+([\d.]+)(?:,\s*(.+?))\)?$/);
    if (!m) return null;
    const extra = m[2]
      ? m[2]
          .split(',')
          .map(s => s.trim().replace(/\)$/, ''))
          .filter(Boolean)
      : [];
    return { version: m[1], extra };
  },
  // Google Chrome 146.0.7680.164
  chrome: raw => {
    const m = raw.match(/^Google\s+Chrome\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // Chromium 137.0.7151.0
  chromium: raw => {
    const m = raw.match(/^Chromium\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // Mozilla Firefox 139.0
  firefox: raw => {
    const m = raw.match(/^Mozilla\s+Firefox\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // Microsoft Edge 146.0.3856.84
  msedge: raw => {
    const m = raw.match(/^Microsoft\s+Edge\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // deno 2.7.9 (stable, release, x86_64-unknown-linux-gnu)
  deno: raw => {
    const m = raw.match(/^deno\s+([\d.]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    const extra = m[2]
      ? m[2]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : [];
    return { version: m[1], extra };
  },
  // Version 1.58.2  (Playwright CLI)
  playwright: raw => {
    const m = raw.match(/(?:Version\s+)?([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // @playwright/test@1.58.2
  playwrightTest: raw => {
    const m = raw.match(/@playwright\/test@([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // @playwright/mcp@0.0.69 or `-- @playwright/mcp@0.0.69
  playwrightMcp: raw => {
    const m = raw.match(/@playwright\/mcp@([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // @puppeteer/browsers@2.13.0
  puppeteerBrowsers: raw => {
    const m = raw.match(/@puppeteer\/browsers@([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // 2.1.87 (Claude Code)
  claudeCode: raw => {
    const m = raw.match(/([\d.]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2]] : [] };
  },
  // GitHub Copilot CLI 1.0.14.\nRun 'copilot update'...
  copilot: raw => {
    const m = raw.match(/([\d.]+)/);
    if (!m) return null;
    // Strip trailing dot from version (e.g. "1.0.14." -> "1.0.14")
    const version = m[1].replace(/\.$/, '');
    return { version, extra: [] };
  },
  // pyenv 2.6.26
  pyenv: raw => {
    const m = raw.match(/^pyenv\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // /workspace/.perl5/bin/perlbrew  - App::perlbrew/1.02
  perlbrew: raw => {
    const m = raw.match(/App::perlbrew\/([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // rbenv 1.3.2-20-g23c3041
  rbenv: raw => {
    const m = raw.match(/^rbenv\s+([\d.]+(?:-[\w]+)*)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // Homebrew 5.1.2
  brew: raw => {
    const m = raw.match(/^Homebrew\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // This is Zip 3.0 (July 5th 2008), by Info-ZIP.
  zip: raw => {
    const m = raw.match(/Zip\s+([\d.]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2]] : [] };
  },
  // UnZip 6.00 of 20 April 2009, by Debian.
  unzip: raw => {
    const m = raw.match(/UnZip\s+([\d.]+)\s*(?:of\s+([^,]+))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2].trim()] : [] };
  },
  // ii  xvfb  2:21.1.12-1ubuntu1.5  amd64  Virtual Framebuffer...
  xvfb: raw => {
    // dpkg output format
    const dpkg = raw.match(/^ii\s+xvfb\s+(\S+)/);
    if (dpkg) {
      // Strip epoch (e.g. "2:21.1.12-1ubuntu1.5" -> "21.1.12-1ubuntu1.5")
      const ver = dpkg[1].replace(/^\d+:/, '');
      return { version: ver, extra: [] };
    }
    // X.Org X Server version output (if it ever works)
    const xorg = raw.match(/X\.Org\s+X\s+Server\s+([\d.]+)/);
    if (xorg) return { version: xorg[1], extra: [] };
    return null;
  },
  // Xvfb returns "Unrecognized option: -version" — this is handled by fixing the command
  // to use dpkg fallback first

  // agent 1.0.0 or similar
  agent: raw => {
    const m = raw.match(/([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // codex-cli 0.117.0 or similar
  codex: raw => {
    const m = raw.match(/([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // opencode 1.3.10 or similar
  opencode: raw => {
    const m = raw.match(/([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // qwen-code version
  qwenCode: raw => {
    const m = raw.match(/([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // gemini version
  gemini: raw => {
    const m = raw.match(/([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
};

/**
 * Parse a raw version string using the per-tool parser, returning uniform format:
 *   "<version>" or "<version> (<extra1>, <extra2>, ...)"
 * Falls back to the raw string if no parser matches.
 * @param {string} key - Tool key (must match a key in VERSION_PARSERS)
 * @param {string} raw - Raw version string from command output
 * @returns {string} Parsed version string in uniform format
 */
export function parseVersion(key, raw) {
  if (!raw) return raw;
  const parser = VERSION_PARSERS[key];
  if (!parser) return raw;
  const result = parser(raw);
  if (!result) return raw;
  const { version, extra } = result;
  if (extra && extra.length > 0) {
    return `${version} (${extra.join(', ')})`;
  }
  return version;
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
  { key: 'playwrightTest', command: "npm list -g @playwright/test --depth=0 2>&1 | grep @playwright/test | awk '{print $2}'" },
  { key: 'playwrightMcp', command: "npm list -g @playwright/mcp --depth=0 2>&1 | grep @playwright/mcp | awk '{print $2}'" },
  { key: 'playwrightMcpStatus', command: 'timeout 5 claude mcp list 2>&1 | grep -i playwright | head -1' },
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
        playwrightTest: versions.playwrightTest,
        playwrightMcp: versions.playwrightMcp,
        playwrightMcpStatus: versions.playwrightMcpStatus,
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
 * Helper to add version line if version exists.
 * Uses parseVersion() to normalize raw output into uniform format.
 * @param {string[]} lines - Array to push to
 * @param {string} label - Display label
 * @param {string|null} version - Version string or null
 * @param {string} [key] - Tool key for version parser lookup
 */
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
  addVersionLine(agentLines, 'Claude Code', versions.claudeCode, 'claudeCode');
  addVersionLine(agentLines, 'Agent CLI', versions.agent, 'agent');
  addVersionLine(agentLines, 'OpenAI Codex', versions.codex, 'codex');
  addVersionLine(agentLines, 'OpenCode', versions.opencode, 'opencode');
  addVersionLine(agentLines, 'Qwen Code', versions.qwenCode, 'qwenCode');
  addVersionLine(agentLines, 'Gemini CLI', versions.gemini, 'gemini');
  addVersionLine(agentLines, 'GitHub Copilot', versions.copilot, 'copilot');

  if (agentLines.length > 0) {
    lines.push('');
    lines.push('*🎭 AI Agents*');
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
    lines.push('*🔨 C/C++/Assembly*');
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
    lines.push('*🌐 Browsers*');
    lines.push(...browserLines);
  }

  // === Browser Automation ===
  const browserAutoLines = [];
  addVersionLine(browserAutoLines, 'Playwright', versions.playwright, 'playwright');
  addVersionLine(browserAutoLines, 'Playwright Test', versions.playwrightTest, 'playwrightTest');
  // Playwright MCP: show version with Claude Code connection status inline
  if (versions.playwrightMcp) {
    const mcpVersion = parseVersion('playwrightMcp', versions.playwrightMcp);
    const claudeStatus = versions.playwrightMcpStatus ? 'connected' : 'not connected';
    browserAutoLines.push(`• Playwright MCP: \`${mcpVersion} (Claude Code: ${claudeStatus})\``);
  }
  addVersionLine(browserAutoLines, 'Puppeteer Browsers', versions.puppeteerBrowsers, 'puppeteerBrowsers');

  if (browserAutoLines.length > 0) {
    lines.push('');
    lines.push('*🎭 Browser Automation*');
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
  parseVersion,
};
