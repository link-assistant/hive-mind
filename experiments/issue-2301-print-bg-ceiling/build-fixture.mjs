// Issue #2301: cut a compact, ordered replay fixture out of a reconstructed incident stream.
// Usage: node build-fixture.mjs <incident.jsonl from incident-events.mjs> <stderr-ceiling-ts> <out.jsonl>
// Keeps the tail of the main thread, the last subagent tool errors before the sweep, every
// task_notification after the main thread went idle, and the sweep's synthetic subagent results.
// The stderr ceiling line is inserted at its logged position as {"__stderr": "..."}.
import fs from 'fs';

const [input, ceilingTs, output] = process.argv.slice(2);
const events = fs
  .readFileSync(input, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line));
const isMain = d => !d.parent_tool_use_id;
const lastMainAssistant = events.findLastIndex(d => d.type === 'assistant' && isMain(d));
const idleTs = events[lastMainAssistant].__logTs;
const trimContent = content =>
  (Array.isArray(content) ? content : []).map(item => {
    const copy = { type: item.type };
    if (item.is_error !== undefined) copy.is_error = item.is_error;
    if (typeof item.text === 'string') copy.text = item.text.slice(0, 400);
    if (item.content !== undefined) copy.content = typeof item.content === 'string' ? item.content.slice(0, 400) : '[structured]';
    if (item.name) copy.name = item.name;
    return copy;
  });
const compact = d => {
  const out = { __logTs: d.__logTs, type: d.type };
  for (const key of ['subtype', 'status', 'task_id', 'summary', 'parent_tool_use_id', 'terminal_reason', 'subagent_stats', 'is_error', 'origin', 'output_file']) if (d[key] !== undefined && d[key] !== null) out[key] = d[key];
  if (typeof d.tool_use_result === 'string') out.tool_use_result = d.tool_use_result.slice(0, 200);
  if (typeof d.result === 'string') out.result = d.result.slice(0, 400);
  if (d.message) out.message = { role: d.message.role, content: trimContent(d.message.content) };
  return out;
};
const keep = new Set();
let mainBefore = 0;
for (let i = lastMainAssistant; i >= 0 && mainBefore < 5; i--) if (isMain(events[i]) && ['assistant', 'user'].includes(events[i].type)) (keep.add(i), mainBefore++);
let subErrors = 0;
for (let i = events.length - 1; i >= 0 && subErrors < 3; i--) {
  const d = events[i];
  if (d.__logTs >= ceilingTs || isMain(d) || d.type !== 'user') continue;
  if ((d.message?.content || []).some(c => c.type === 'tool_result' && c.is_error)) (keep.add(i), subErrors++);
}
events.forEach((d, i) => {
  if (i >= lastMainAssistant && isMain(d)) keep.add(i);
  if (d.__logTs > idleTs && d.type === 'system' && d.subtype === 'task_notification') keep.add(i);
  if (d.__logTs >= ceilingTs) keep.add(i);
});
const selected = [...keep].sort((a, b) => a - b).map(i => compact(events[i]));
const stderrLine = { __logTs: ceilingTs, __stderr: 'Background tasks still running after 600s; terminating. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.' };
const at = selected.findIndex(d => d.__logTs >= ceilingTs);
selected.splice(at < 0 ? selected.length : at, 0, stderrLine);
fs.writeFileSync(output, selected.map(d => JSON.stringify(d)).join('\n') + '\n');
console.log(`${output}: ${selected.length} events (main idle since ${idleTs})`);
