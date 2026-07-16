/**
 * Shared helpers for destructive CLI confirmations.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1930
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const C1_CSI = String.fromCharCode(0x9b);

const ANSI_ESCAPE_PATTERN = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_])`, 'g');
const C1_CSI_PATTERN = new RegExp(`${C1_CSI}[0-?]*[ -/]*[@-~]`, 'g');

function removeLastWord(chars) {
  while (chars.length > 0 && /\s/.test(chars.at(-1))) chars.pop();
  while (chars.length > 0 && !/\s/.test(chars.at(-1))) chars.pop();
}

/**
 * Normalize an answer as it appeared after terminal line editing.
 *
 * Some terminal/window-manager shortcuts can inject escape sequences into the
 * input stream even though the user still sees a clean `yes`. We strip those
 * non-text sequences and replay common erase controls before comparing.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeConfirmationInput(value) {
  const raw = String(value ?? '')
    .normalize('NFKC')
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(C1_CSI_PATTERN, '');
  const chars = [];

  for (const char of raw) {
    const code = char.codePointAt(0);

    if (char === '\b' || char === '\u007f') {
      chars.pop();
      continue;
    }

    if (char === '\u0015') {
      chars.length = 0;
      continue;
    }

    if (char === '\u0017') {
      removeLastWord(chars);
      continue;
    }

    if (char === '\r' || char === '\n' || code === 0xfeff) continue;
    if (code < 32 || (code >= 0x80 && code <= 0x9f)) continue;

    chars.push(char);
  }

  return chars.join('').trim();
}

export function isConfirmationYes(value) {
  return normalizeConfirmationInput(value).toLowerCase() === 'yes';
}

/**
 * Read one interactive confirmation line.
 *
 * @param {{prompt?: string, input?: import('node:stream').Readable, output?: import('node:stream').Writable}} [options]
 * @returns {Promise<string>}
 */
export async function readConfirmationLine(options = {}) {
  const input = options.input || stdin;
  const output = options.output || stdout;
  const rl = createInterface({
    input,
    output,
    terminal: Boolean(input.isTTY && output.isTTY),
  });

  try {
    return await rl.question(options.prompt ?? '> ');
  } finally {
    rl.close();
  }
}
