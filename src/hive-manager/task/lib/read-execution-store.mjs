// Self-contained so callers can run it inside a deployment with its installed codec.
export async function readExecutionStore({ allowMissing = false } = {}) {
  const { accessSync, closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { homedir } = await import('node:os');
  const { delimiter, join, resolve } = await import('node:path');
  const folder = process.env.START_APP_FOLDER || join(homedir(), '.start-command');
  let fd;
  try {
    fd = openSync(join(folder, 'executions.lino'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT' && ['executions.links', 'executions.decoded.js.json'].every(name => !lstatSync(join(folder, name), { throwIfNoEntry: false }))) return [];
    throw error;
  }

  let source;
  try {
    const stat = fstatSync(fd);
    const { size } = stat;
    if (!stat.isFile() || size > 16 * 1024 ** 2) throw new Error('Execution store exceeded its read budget or is not a regular file.');
    const bytes = Buffer.alloc(size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset);
      if (!count) break;
      offset += count;
    }
    if (offset !== size) throw new Error('Execution store changed while reading it.');
    source = bytes.toString('utf8', 0, offset);
  } finally {
    closeSync(fd);
  }
  if (!source.trim()) return [];

  let records;
  try {
    records = JSON.parse(source);
  } catch {
    const cli = (process.env.PATH ?? '/usr/bin:/bin')
      .split(delimiter)
      .map(directory => resolve(directory, '$'))
      .find(candidate => {
        try {
          accessSync(candidate, constants.X_OK);
          return statSync(candidate).isFile();
        } catch {
          return false;
        }
      });
    if (!cli) throw new Error('Cannot locate the installed start-command codec.');
    const require = createRequire(realpathSync(cli));
    records = require('lino-objects-codec').decode({ notation: source });
  }
  if (!Array.isArray(records)) throw new Error('Invalid start-command execution store.');
  return records;
}
