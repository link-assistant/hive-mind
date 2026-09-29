import fs from 'fs';
const ev = fs
  .readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .map(l => JSON.parse(l));
const from = process.argv[3] || '';
for (const d of ev) {
  if (d.__logTs < from) continue;
  const sub = d.parent_tool_use_id ? `(sub:${(d.task_description || '').slice(0, 25)})` : '';
  if (d.type === 'result') console.log(d.__logTs, 'RESULT', d.subtype, d.result_index, d.terminal_reason);
  else if (d.type === 'system') console.log(d.__logTs, 'SYS', d.subtype, d.status || '', d.task_id || '', (d.summary || d.description || '').slice(0, 80).replace(/\n/g, ' '));
  else if (d.type === 'assistant')
    for (const c of d.message?.content || []) {
      if (c.type === 'tool_use') console.log(d.__logTs, 'USE', sub, c.name, JSON.stringify(c.input).slice(0, 140));
      else if (c.type === 'text') console.log(d.__logTs, 'TEXT', sub, c.text.slice(0, 140).replace(/\n/g, ' '));
    }
  else if (d.type === 'user')
    for (const c of d.message?.content || []) {
      if (c.type === 'tool_result') console.log(d.__logTs, 'RES', sub, c.is_error ? 'ERR' : 'ok', JSON.stringify(c.content).slice(0, 120));
      else if (c.type === 'text') console.log(d.__logTs, 'UTEXT', sub, c.text.slice(0, 120).replace(/\n/g, ' '));
    }
}
