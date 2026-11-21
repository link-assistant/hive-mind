// Pure version normalization, independent of subprocess execution.
/**
 * Month name/abbreviation to zero-padded number mapping
 */
const MONTH_MAP = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

/**
 * Normalize a date string to ISO format (YYYY-MM-DD).
 * Handles formats like:
 *   "20-Aug-23"       → "2023-08-20"
 *   "20 April 2009"   → "2009-04-20"
 *   "July 5th 2008"   → "2008-07-05"
 *   "Jan 13 2026"     → "2026-01-13"
 *   "2024-02-29"      → "2024-02-29" (passthrough)
 * Returns the original string if parsing fails.
 * @param {string} dateStr - Date string to normalize
 * @returns {string} ISO date string or original
 */
export function normalizeDate(dateStr) {
  if (!dateStr) return dateStr;
  const s = dateStr.trim();

  // Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // "DD-Mon-YY" (e.g. "20-Aug-23")
  const dmy = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (dmy) {
    const month = MONTH_MAP[dmy[2].toLowerCase()];
    if (month) {
      const year = parseInt(dmy[3], 10);
      const fullYear = year >= 70 ? `19${dmy[3]}` : `20${dmy[3]}`;
      return `${fullYear}-${month}-${dmy[1].padStart(2, '0')}`;
    }
  }

  // "DD Month YYYY" (e.g. "20 April 2009")
  const dmY = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmY) {
    const month = MONTH_MAP[dmY[2].toLowerCase()];
    if (month) return `${dmY[3]}-${month}-${dmY[1].padStart(2, '0')}`;
  }

  // "Month DDth YYYY" or "Month DD YYYY" (e.g. "July 5th 2008", "Jan 13 2026")
  const mdY = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})$/);
  if (mdY) {
    const month = MONTH_MAP[mdY[1].toLowerCase()];
    if (month) return `${mdY[3]}-${month}-${mdY[2].padStart(2, '0')}`;
  }

  // "Month DD YYYY HH:MM:SS" (e.g. "Jan 13 2026 22:36:55")
  const mdYt = s.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  if (mdYt) {
    const month = MONTH_MAP[mdYt[1].toLowerCase()];
    if (month) return `${mdYt[3]}-${month}-${mdYt[2].padStart(2, '0')} ${mdYt[4]}`;
  }

  return s;
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
  // go version go1.26.1 linux/amd64 → strip platform/arch
  go: raw => {
    const m = raw.match(/go([\d.]+(?:\S*)?)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // PHP 8.3.30 (cli) (built: Jan 13 2026 22:36:55) (NTS) → strip cli, normalize date
  php: raw => {
    const m = raw.match(/^PHP\s+([\d.]+(?:-\S+)?)\s*(.*)/);
    if (!m) return null;
    const tags = [];
    const parts = m[2].matchAll(/\(([^)]+)\)/g);
    for (const p of parts) {
      const tag = p[1].trim();
      // Skip "cli" — not meaningful for version display
      if (tag === 'cli') continue;
      // Normalize "built: Jan 13 2026 22:36:55" → "2026-01-13 22:36:55"
      const built = tag.match(/^built:\s+(.+)$/);
      if (built) {
        tags.push(normalizeDate(built[1]));
        continue;
      }
      tags.push(tag);
    }
    return { version: m[1], extra: tags };
  },
  // openjdk version "21" 2023-09-19 LTS
  java: raw => {
    const m = raw.match(/version\s+"([^"]+)"(?:\s+(.+))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2].trim()] : [] };
  },
  // gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0 → use base version only
  gcc: raw => {
    const m = raw.match(/^gcc\s+(?:\([^)]*\)\s+)?([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0 → use base version only
  gpp: raw => {
    const m = raw.match(/^g\+\+\s+(?:\([^)]*\)\s+)?([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // clang version 17.0.0 (https://github.com/... 2e6139970eda) → strip URL, keep commit
  clang: raw => {
    const m = raw.match(/^clang\s+version\s+([\d.]+(?:-\S+)?)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    if (m[2]) {
      // Remove URLs, keep only hex commit hashes
      const parts = m[2]
        .trim()
        .split(/\s+/)
        .filter(p => !p.includes('://') && !p.includes('.git'));
      const commitParts = parts.filter(p => /^[0-9a-f]{7,}$/i.test(p));
      return { version: m[1], extra: commitParts };
    }
    return { version: m[1], extra: [] };
  },
  // LLD 17.0.0 (compatible with GNU linkers) — only version number matters
  lld: raw => {
    const m = raw.match(/^LLD\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // Python 3.14.3
  python: raw => {
    const m = raw.match(/^Python\s+([\d.]+(?:\S*)?)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // ruby 3.4.9 (2026-03-11 revision 76cca827ab) +PRISM [x86_64-linux] → strip arch, reformat
  ruby: raw => {
    const m = raw.match(/^ruby\s+([\d.]+(?:p\d+)?)\s*(?:\(([^)]+)\))?\s*(.*)/);
    if (!m) return null;
    const extra = [];
    if (m[2]) {
      // Parse "2026-03-11 revision 76cca827ab" → commit, date
      const revMatch = m[2].match(/^(\d{4}-\d{2}-\d{2})\s+revision\s+(\w+)$/);
      if (revMatch) {
        extra.push(revMatch[2]); // commit first
        extra.push(revMatch[1]); // then date
      } else {
        extra.push(m[2].trim());
      }
    }
    // Capture +PRISM or similar flags, but strip [arch] info
    const tail = m[3] ? m[3].trim() : '';
    if (tail) {
      const cleaned = tail.replace(/\[[\w-]+\]/g, '').trim();
      if (cleaned) extra.push(cleaned);
    }
    return { version: m[1], extra };
  },
  // Kotlin version 2.3.20-release-208 (JRE 21+35-LTS) → strip -release-NNN suffix
  kotlin: raw => {
    const m = raw.match(/^Kotlin\s+version\s+([\d.]+)(?:-release-\d+)?\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [m[2].trim()] : [] };
  },
  // Swift version 6.0.3 (swift-6.0.3-RELEASE) → strip redundant release tag
  swift: raw => {
    const m = raw.match(/^Swift\s+version\s+([\d.]+(?:\.\d+)?)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
  },
  // R version 4.3.3 (2024-02-29) -- "Angel Food Cake" → normalize date
  r: raw => {
    const m = raw.match(/^R\s+version\s+([\d.]+)\s*(?:\(([^)]+)\))?(?:\s+--\s+"([^"]+)")?/);
    if (!m) return null;
    const extra = [];
    if (m[2]) extra.push(normalizeDate(m[2]));
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
  // curl 8.19.0 (x86_64-pc-linux-gnu) libcurl/8.19.0 ... → strip arch info
  curl: raw => {
    const m = raw.match(/^curl\s+([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
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
  // Screen version 4.09.01 (GNU) 20-Aug-23 → normalize date, strip GNU
  screen: raw => {
    const m = raw.match(/^Screen\s+version\s+([\d.]+)\s*(?:\([^)]*\))?\s*(.*)/);
    if (!m) return null;
    const extra = [];
    const dateStr = m[2] ? m[2].trim() : '';
    if (dateStr) extra.push(normalizeDate(dateStr));
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
  // Lean (version 4.29.0, x86_64-unknown-linux-gnu, commit abc123, Release) → strip arch/Release
  lean: raw => {
    const m = raw.match(/version\s+([\d.]+)(?:,\s*(.+?))\)?$/);
    if (!m) return null;
    const extra = m[2]
      ? m[2]
          .split(',')
          .map(s => s.trim().replace(/\)$/, ''))
          .filter(s => {
            if (!s) return false;
            // Strip arch patterns and "Release"
            if (/^\w+[-_]\w+[-_]\w+[-_]\w+$/.test(s)) return false;
            if (s === 'Release') return false;
            return true;
          })
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
  // deno 2.7.9 (stable, release, x86_64-unknown-linux-gnu) → keep only channel (stable)
  deno: raw => {
    const m = raw.match(/^deno\s+([\d.]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    const extra = m[2]
      ? m[2]
          .split(',')
          .map(s => s.trim())
          .filter(s => s && s !== 'release' && !s.includes('-') && !s.includes('/'))
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
  // 2.1.87 (Claude Code) → strip redundant product name
  claudeCode: raw => {
    const m = raw.match(/([\d.]+)/);
    if (!m) return null;
    return { version: m[1], extra: [] };
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
  // This is Zip 3.0 (July 5th 2008), by Info-ZIP. → normalize date
  zip: raw => {
    const m = raw.match(/Zip\s+([\d.]+)\s*(?:\(([^)]+)\))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [normalizeDate(m[2])] : [] };
  },
  // UnZip 6.00 of 20 April 2009, by Debian. → normalize date
  unzip: raw => {
    const m = raw.match(/UnZip\s+([\d.]+)\s*(?:of\s+([^,]+))?/);
    if (!m) return null;
    return { version: m[1], extra: m[2] ? [normalizeDate(m[2].trim())] : [] };
  },
  // ii  xvfb  2:21.1.12-1ubuntu1.5  amd64  Virtual Framebuffer... → base version only
  xvfb: raw => {
    // dpkg output format
    const dpkg = raw.match(/^ii\s+xvfb\s+(\S+)/);
    if (dpkg) {
      // Strip epoch (e.g. "2:21.1.12-1ubuntu1.5" -> "21.1.12-1ubuntu1.5")
      // Then strip distro suffix (e.g. "21.1.12-1ubuntu1.5" -> "21.1.12")
      const ver = dpkg[1].replace(/^\d+:/, '').replace(/-.*$/, '');
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
