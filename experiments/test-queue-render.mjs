import { SolveQueue, resetSolveQueue, QueueItemStatus } from '../src/telegram-solve-queue.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
await initI18n();
resetSolveQueue();
const q = new SolveQueue({ verbose: false, autoStart: false });
// Avoid real pgrep / session lookups
q.getExternalProcessingSnapshot = async () => ({ byTool: {}, total: 0, isolatedTotal: 0 });
q.getRunningSessionItemsFn = async () => [];

const urls = ['https://github.com/uselessgoddess/ryzr/issues/3', 'https://github.com/link-foundation/box/issues/99', 'https://github.com/link-assistant/hive-mind/issues/1886', 'https://github.com/link-assistant/hive-mind/issues/1885', 'https://github.com/link-assistant/formal-ai/issues/405', 'https://github.com/link-assistant/model-in-browser/issues/15', 'https://github.com/link-foundation/meta-language/issues/49'];
for (const url of urls) q.enqueue({ url, args: '', requester: 'u', infoBlock: 'x', tool: 'claude' });
// Make some "executing" via processing map
const claudeQ = q.getToolQueue('claude');
for (let i = 0; i < 4; i++) {
  const item = claudeQ[i];
  item.status = QueueItemStatus.STARTED;
  q.processing.set(item.id, item);
}
q.queues.claude = claudeQ.filter(i => !q.processing.has(i.id));
// Set waiting reason on remaining pending
for (const item of q.queues.claude) item.setWaiting('CPU usage is 77% (threshold: 65%)');

const out = await q.formatDetailedStatus();
console.log('================ RENDER ================');
console.log(out);
console.log('========================================');
console.log('contains agent queue?', out.includes('agent'));
console.log('contains ▶️?', out.includes('▶️'));
console.log('contains ⏳?', out.includes('⏳'));
console.log('contains "processing,"?', out.includes('processing,'));
q.stop();
