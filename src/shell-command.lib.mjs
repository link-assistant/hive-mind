/** Preserve literal argv boundaries when a command must cross a POSIX shell. */
export function shellQuote(value) {
  const stringValue = String(value);
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

export function buildShellCommand(command, args = []) {
  return [command, ...args].map(shellQuote).join(' ');
}
