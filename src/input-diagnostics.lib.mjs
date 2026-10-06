/** Location hints shared by CLI and Telegram validation. */

// Wide (CJK/emoji) characters take two monospace cells; marks and format characters take none.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;
const ZERO_WIDTH = /[\p{Mn}\p{Me}\p{Cf}]/u;
const charWidth = char => (ZERO_WIDTH.test(char) ? 0 : WIDE.test(char) ? 2 : 1);
const textWidth = chars => chars.reduce((width, char) => width + charWidth(char), 0);

/**
 * Compiler-style snippet: the input with a caret line under the offending part.
 * `maxWidth` trims long input around the part, so narrow screens are less likely to wrap it.
 */
export function formatCaretSnippet(input, { start = 0, end = input.length } = {}, { maxWidth = Infinity } = {}) {
  const before = [...input.slice(0, start)];
  const part = [...input.slice(start, end)];
  const after = [...input.slice(end)];
  let shown = { before, after };
  if (textWidth([...before, ...part, ...after]) > maxWidth) {
    // Keep the whole part, about a third of the remaining room after it, and the rest before it.
    let room = Math.max(0, maxWidth - textWidth(part) - 2);
    const take = (chars, budget, fromEnd) => {
      const kept = [];
      for (const char of fromEnd ? [...chars].reverse() : chars) {
        if (charWidth(char) > budget) break;
        budget -= charWidth(char);
        kept.push(char);
      }
      return fromEnd ? kept.reverse() : kept;
    };
    const afterShown = take(after, Math.floor(room / 3), false);
    room -= textWidth(afterShown);
    let beforeShown = take(before, room, true);
    // Start a trimmed prefix at a URL or argument boundary rather than mid-word.
    const boundary = beforeShown.findIndex(char => /[/\s]/.test(char));
    if (beforeShown.length < before.length && boundary > 0) beforeShown = beforeShown.slice(boundary);
    room -= textWidth(beforeShown);
    const afterFinal = afterShown.length < after.length ? take(after, textWidth(afterShown) + room, false) : afterShown;
    shown = {
      before: beforeShown.length < before.length ? ['…', ...beforeShown] : beforeShown,
      after: afterFinal.length < after.length ? [...afterFinal, '…'] : afterFinal,
    };
  }
  const line = [...shown.before, ...part, ...shown.after].join('');
  const caret = ' '.repeat(textWidth(shown.before)) + '^'.repeat(Math.max(1, textWidth(part)));
  return `${line}\n${caret}`;
}

function describeLocation(input, location, quote) {
  const { part = input, start = 0, label = 'input' } = location;
  const column = [...input.slice(0, start)].length + 1;
  if (!part) return `Expected ${label} at column ${column}:`;
  return part === input ? `Check ${label}:` : `Check ${label} ${quote(part)} (column ${column}):`;
}

/** Plain-text hint with a caret line, for terminals and logs. */
export function formatInputLocation(input, location = {}) {
  return `${describeLocation(input, location, JSON.stringify)}\n${formatCaretSnippet(input, location)
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')}`;
}

const escapeLegacyMarkdown = text => text.replace(/([_*`[])/g, '\\$1');

/**
 * Telegram legacy-Markdown hint: the part in bold and a caret snippet in a code block.
 * Markdown entities cannot contain escapes, so input that would break them falls back
 * to escaped text with the part in capitals.
 */
export function formatInputLocationMarkdown(input, location = {}, { maxWidth = 48 } = {}) {
  const quote = part => (/[_*`[\n]/.test(part) ? escapeLegacyMarkdown(JSON.stringify(part)) : `*${part}*`);
  const heading = describeLocation(input, location, quote);
  if (!input.includes('`')) return `${heading}\n\`\`\`\n${formatCaretSnippet(input, location, { maxWidth })}\n\`\`\``;
  const { start = 0, end = input.length } = location;
  const marked = start === 0 && end === input.length ? input : input.slice(0, start) + input.slice(start, end).toUpperCase() + input.slice(end);
  return `${heading}\n${escapeLegacyMarkdown(marked)}`;
}

/** Preserve the validation error and add positions from the actual argv. */
export function enhanceArgumentError(error, args) {
  if (!error || error.inputLocations || !Array.isArray(args)) return error;
  const message = error.message || '';
  const unknown =
    message
      .match(/Unknown arguments?:\s*([^\n]+)/i)?.[1]
      .split(',')
      .map(name => name.trim().replace(/^-+/, '')) || [];
  const optionNames = [...message.matchAll(/--([a-z][\w-]*)/gi)].map(match => match[1]);
  const choiceName = message.match(/Argument:\s*([^,\s]+)/)?.[1];
  if (choiceName) optionNames.push(choiceName);
  const names = new Set(unknown.length ? unknown : optionNames);
  const locations = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const name = arg.replace(/^-+/, '').split('=')[0];
    if (!arg.startsWith('-') || !names.has(name)) continue;
    // Show only the offending option, never unrelated argument values.
    const hasValue = !unknown.length && !arg.includes('=') && args[index + 1] && !args[index + 1].startsWith('-');
    locations.push({ index, input: hasValue ? `${arg} ${args[index + 1]}` : arg });
  }
  if (!locations.length) return error;
  const enhanced = new Error(`${message}\n\n${locations.map(({ index, input }) => `Check argument ${index + 1}: ${JSON.stringify(input)}`).join('\n')}`, { cause: error });
  enhanced.name = error.name;
  Object.assign(enhanced, error, { inputLocations: locations });
  return enhanced;
}
