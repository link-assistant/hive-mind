/** Location hints shared by CLI and Telegram validation. */
export function formatInputLocation(input, location = {}) {
  const { part = input, start = 0, label = 'input' } = location;
  return `Check ${label} ${JSON.stringify(part)} (column ${[...input.slice(0, start)].length + 1}).\nInput: ${JSON.stringify(input)}`;
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
