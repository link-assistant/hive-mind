import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { output } from './process.mjs';
import { absolute, overlaps } from './docker.mjs';

const dssRelease = '0.17.0';
const dssSha512 = 'tpwpyMkf7W9Ug8egqUY/HWnX+JUd2hNYn9NeJDxKdne5BW/VtOdV5bKC2/ibtU+mFO/Mziid2AcQ75XDzVXvBA==';

// Keep the scanner in memory on a task. The only write side effect in the task
// would come from the scanner itself, so disable DSS persistence and Docker.
const scanner = `
import { once } from 'node:events';
import { registerHooks } from 'node:module';
import { createInterface } from 'node:readline';
const stdin = createInterface({ input: process.stdin });
const [line] = await once(stdin, 'line');
const { modules, exclude, task, debug } = JSON.parse(line);
const base = 'file:///__hive_manager_dss__/';
const controller = new AbortController();
stdin.once('close', () => controller.abort(new Error('Scanner supervisor disconnected')));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(base) || (context.parentURL?.startsWith(base) && specifier.startsWith('.'))) {
      const url = new URL(specifier, context.parentURL).href;
      if (Object.hasOwn(modules, url.slice(base.length))) return { url, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(base)) return { format: 'module', source: modules[url.slice(base.length)], shortCircuit: true };
    return next(url, context);
  },
});
try {
  const { scan, LocalEnv } = await import(base + 'src/index.js');
  const env = new LocalEnv();
  if (task) env.kind = 'container';
  const report = await scan({ env, exclude, docker: false, cacheDir: false, platformIndex: false, scanBudget: '45s', signal: controller.signal });
  const items = report.items.filter(item => item.tier === 'safe' && !item.parentId && !item.requiresConfirmation && !item.blockers.length && item.action?.type === 'remove');
  const diagnostics = debug ? report.items.slice(0, 20).map(({ rule, tier, action, blockers, bytes }) => ({ rule, tier, action: action?.type, blockers: blockers.length, bytes })) : undefined;
  console.log(JSON.stringify({ status: report.environments[0].scanStatus, errors: report.errors.length, paths: items.flatMap(item => item.action.paths ?? []), diagnostics }));
} finally {
  stdin.close();
  process.stdin.destroy();
}
`;

export async function pinnedScanner(directory, check) {
  const archive = join(directory, 'dss.tgz');
  await output('curl', ['--disable', '--fail', '--silent', '--show-error', '--proto', '=https', '--max-filesize', '1048576', '--output', archive, `https://registry.npmjs.org/disk-space-saviour/-/disk-space-saviour-${dssRelease}.tgz`], { ms: 30_000, check });
  const digest = createHash('sha512').update(readFileSync(archive)).digest('base64');
  if (digest !== dssSha512) throw new Error('Disk-space-saviour archive failed its integrity check.');
  await output('tar', ['-xzf', archive, '-C', directory, '--no-same-owner', '--no-same-permissions', 'package/src'], { check });
  unlinkSync(archive);
  const source = join(directory, 'package');
  const modules = Object.fromEntries(
    readdirSync(join(source, 'src'), { recursive: true })
      .filter(file => file.endsWith('.js'))
      .map(file => [`src/${file}`, readFileSync(join(source, 'src', file), 'utf8')])
  );
  return async (exclude, docker, id) => {
    // DSS excludes take globs. Refuse ambiguous boundaries instead of guessing
    // how an arbitrary Docker mount path will be interpreted.
    if (exclude.some(path => !absolute(path) || path !== path.trim() || /[,*?[\]]/.test(path) || path.includes('\\'))) throw new Error('Cannot express a protected mount path to disk-space-saviour.');
    const debug = process.env.HIVE_MANAGER_STORAGE_DEBUG === '1';
    const payload = JSON.stringify({ modules, exclude, task: Boolean(id), debug }) + '\n';
    const args = ['--input-type=module', '-e', scanner];
    const options = { ms: 65_000, check, input: payload, keepInput: true };
    const text = id ? await docker(['exec', '-i', '--env', 'NODE_OPTIONS=', id, 'timeout', '-s', 'KILL', '60', 'node', ...args], options) : await output(process.execPath, args, options);
    const result = JSON.parse(text);
    if (debug) console.error(JSON.stringify({ status: result.status, errors: result.errors, items: result.diagnostics }));
    if (result.status !== 'complete' || result.errors) throw new Error('Disk-space-saviour scan was incomplete.');
    if (!Array.isArray(result.paths)) throw new Error('Invalid disk-space-saviour result.');
    return [...new Set(result.paths)].filter(path => absolute(path) && path !== '/' && !exclude.some(root => overlaps(root, path)));
  };
}
