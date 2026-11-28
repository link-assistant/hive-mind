// Pass the checkout to test, or run from that checkout. This script exercises
// the same two routines on both the earlier draft and the fixed branch.
import assert from 'node:assert/strict';
import console from 'node:console';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const checkout = process.argv[2] || process.cwd();
const load = file => import(pathToFileURL(path.join(checkout, 'src', file)));
const { restoreQueuedTasks } = await load('bot-instance-state.lib.mjs');
const { formatVerifiedLinoTree, parseLinoTree } = await load('bot-state-lino.lib.mjs');
const { SolveQueue } = await load('telegram-solve-queue.lib.mjs');

const url = 'https://github.com/example/project/issues/1';
const task = { source: 'queue', status: 'queued', url, args: [url] };
const result = await restoreQueuedTasks({ tasks: { queued: task }, queue: { enqueue: options => options }, isUrlActive: async () => ({ isActive: false }) });
console.log(`restore restored=${result.restored.length} skipped=${result.skipped.length}`);

const tree = { tasks: { waiting: { waitsFor: [{ type: 'item', itemId: 'queued' }] } } };
const { tree: parsed } = await parseLinoTree(await formatVerifiedLinoTree(tree));
console.log(`waitsFor=${JSON.stringify(parsed.tasks.waiting.waitsFor)}`);

const queue = new SolveQueue({ autoStart: false });
const createdAt = '2026-11-25T12:00:00.000Z';
const waiting = { ...task, status: 'waiting', createdAt, waitsFor: [{ type: 'item', itemId: 'queued' }] };
await restoreQueuedTasks({ tasks: { waiting, queued: { ...task, createdAt } }, queue });
const prerequisite = queue.dependencies.getEntry('waiting')?.targets[0].item?.id || null;
console.log(`same-URL prerequisite=${prerequisite}`);

assert.deepEqual({ restored: result.restored.length, waitsFor: parsed.tasks.waiting.waitsFor, prerequisite }, { restored: 1, waitsFor: tree.tasks.waiting.waitsFor, prerequisite: 'queued' });
