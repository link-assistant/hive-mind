#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { sanitizeUnicode } from './unicode-sanitization.lib.mjs';

export { sanitizeUnicode };

export const CONFIG = {
  MIN_COMMENT_INTERVAL: 5000,
  MAX_LINES_BEFORE_TRUNCATION: 50,
  LINES_TO_KEEP_START: 20,
  LINES_TO_KEEP_END: 20,
  MAX_JSON_DEPTH: 10,
};

export const execFileAsync = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const { input, maxBuffer = 1024 * 1024, ...spawnOpts } = options;
    const child = spawn(command, args, { ...spawnOpts, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stdoutLen = 0;
    let stderrLen = 0;

    child.stdout.on('data', chunk => {
      const str = chunk.toString();
      stdoutLen += str.length;
      if (stdoutLen <= maxBuffer) stdout += str;
    });
    child.stderr.on('data', chunk => {
      const str = chunk.toString();
      stderrLen += str.length;
      if (stderrLen <= maxBuffer) stderr += str;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        const err = new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });

    if (input != null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });

export const truncateMiddle = (content, options = {}) => {
  const { maxLines = CONFIG.MAX_LINES_BEFORE_TRUNCATION, keepStart = CONFIG.LINES_TO_KEEP_START, keepEnd = CONFIG.LINES_TO_KEEP_END } = options;

  if (!content || typeof content !== 'string') return content || '';

  const lines = content.split('\n');
  if (lines.length <= maxLines) return sanitizeUnicode(content);

  const omitStart = keepStart + 1;
  const omitEnd = lines.length - keepEnd;
  return sanitizeUnicode([...lines.slice(0, keepStart), '', `... [${omitStart}-${omitEnd} lines are omitted] ...`, '', ...lines.slice(-keepEnd)].join('\n'));
};

export const safeJsonStringify = (obj, indent = 2) => {
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return typeof value === 'string' ? sanitizeUnicode(value) : value;
    },
    indent
  );
};

export const createCollapsible = (summary, content, startOpen = false) => `<details${startOpen ? ' open' : ''}>
<summary>${summary}</summary>

${content}

</details>`;

export const createRawJsonSection = data => {
  const dataArray = Array.isArray(data) ? data : [data];
  const jsonContent = truncateMiddle(safeJsonStringify(dataArray, 2), {
    maxLines: 100,
    keepStart: 40,
    keepEnd: 40,
  });
  return createCollapsible('📄 Raw JSON', '```json\n' + jsonContent + '\n```');
};

export const formatDuration = ms => {
  if (!ms || ms < 0) return 'unknown';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

export const formatCost = cost => (typeof cost !== 'number' || isNaN(cost) ? 'unknown' : `$${cost.toFixed(2)}`);

export const escapeMarkdown = text => (!text || typeof text !== 'string' ? '' : text.replace(/```/g, '\\`\\`\\`'));

export const getToolIcon = toolName => {
  const icons = {
    Bash: '💻',
    Read: '📖',
    Write: '✏️',
    Edit: '📝',
    Glob: '🔍',
    Grep: '🔎',
    WebFetch: '🌐',
    WebSearch: '🔍',
    TodoWrite: '📋',
    ToolSearch: '🔍',
    Task: '🎯',
    Agent: '🤖',
    NotebookEdit: '📓',
    default: '🔧',
  };
  return icons[toolName] || icons.default;
};
