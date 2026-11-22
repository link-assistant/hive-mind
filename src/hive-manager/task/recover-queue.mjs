import { parseArgs } from 'node:util';
import { parseGitHubUrl } from '../../github-url-parser.lib.mjs';
import { readBoundedFile } from '../lib/files.mjs';

const usage = `Usage: hive-manager tasks recover-queue --previous LOG [--current LOG] [--include-commands]
List requests from the last verbose bot run that never started, excluding requests already queued or started in the current run.
Use --include-commands to include matching original Telegram text for local review.
`;
const prefix = /^(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z )?\[VERBOSE\] /;
const lifecycle = /^\/queue: (Enqueued|Waiting for dependencies|Starting|Cancelled queued item|Cancelled waiting item|Rejected queued item|Failed waiting item): \[(solve-[\w-]+)\] (\S+) \([a-z]+\)(?: (?:to|from) ([\w-]+) queue\b)?/;
const rawCommand = /^\/[\w-]+(?:@[\w_]+)? raw text: (\/[\w-]+(?:@[\w_]+)?[ \t]+(\S+)[^\r\n]*)$/;

function targetUrl(input) {
  const parsed = parseGitHubUrl(input);
  return parsed.valid && ['issue', 'pull'].includes(parsed.type) ? parsed.canonical : null;
}

async function queueFromFile(path, label, includeCommands) {
  const log = await readBoundedFile(path, 16 * 1024 * 1024, label);
  const entries = new Map();
  const started = new Set();
  const commands = new Map();
  let hasStartup = false;
  for (const text of log.toString('utf8').split(/\r?\n/)) {
    if (!prefix.test(text)) continue;
    const line = text.replace(prefix, '');
    if (line === '/queue: SolveQueue initialized with separate tool queues') {
      entries.clear();
      started.clear();
      commands.clear();
      hasStartup = true;
    }
    if (!hasStartup) continue;
    const raw = includeCommands ? rawCommand.exec(line) : null;
    if (raw) {
      const url = targetUrl(raw[2]);
      if (url) commands.set(url.toLowerCase(), raw[1]);
      continue;
    }
    if (line.startsWith('/queue: Starting directly: ')) {
      const url = targetUrl(line.slice('/queue: Starting directly: '.length));
      if (url) started.add(url.toLowerCase());
      continue;
    }
    const event = lifecycle.exec(line);
    if (!event) continue;
    const [, action, id, input, tool] = event;
    const url = targetUrl(input);
    if (!url) continue;
    const key = url.toLowerCase();
    if (action === 'Enqueued' || action === 'Waiting for dependencies') {
      const entry = { id, url, tool: tool ?? null, waitingForDependencies: action === 'Waiting for dependencies' };
      if (includeCommands) entry.command = entries.get(id)?.command ?? commands.get(key) ?? null;
      entries.set(id, entry);
      commands.delete(key);
    } else {
      if (action === 'Starting') started.add(key);
      entries.delete(id);
    }
  }
  if (!hasStartup) throw new Error(`The ${label} needs the verbose queue startup line to identify a complete bot run.`);
  return { entries, started };
}

async function main() {
  const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, previous: { type: 'string' }, current: { type: 'string' }, 'include-commands': { type: 'boolean' } } });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if (!values.previous) throw new Error('Supply the previous verbose bot log with --previous LOG.');
  const previous = await queueFromFile(values.previous, 'previous log', values['include-commands']);
  const seen = new Set();
  if (values.current) {
    const current = await queueFromFile(values.current, 'current log', false);
    for (const key of current.started) seen.add(key);
    for (const { url } of current.entries.values()) seen.add(url.toLowerCase());
  }
  const pending = [...previous.entries.values()].filter(({ url }) => !seen.has(url.toLowerCase()));
  process.stdout.write(`${JSON.stringify({ comparedCurrentRun: Boolean(values.current), pending }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
