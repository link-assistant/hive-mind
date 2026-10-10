import fs from 'fs';
for (const f of process.argv.slice(2)) {
  console.log('==', f);
  const lines = fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  let seenResult = false;
  for (const d of lines) {
    if (d.type === 'result') {
      seenResult = true;
      console.log('RESULT', JSON.stringify({ subtype: d.subtype, num_turns: d.num_turns, subagent_stats: d.subagent_stats, result: String(d.result).slice(0, 150) }));
    } else if (d.type === 'system' && /task/.test(d.subtype)) console.log(seenResult ? 'POST' : 'PRE', 'SYS', d.subtype, d.status, d.task_id, (d.summary || d.description || '').slice(0, 60));
    else if (d.type === 'assistant')
      for (const c of d.message.content || []) {
        if (c.type === 'tool_use') console.log(seenResult ? 'POST' : 'PRE', 'TOOL_USE', d.parent_tool_use_id ? '(sub)' : '', c.name, JSON.stringify(c.input).slice(0, 160));
      }
    else if (d.type === 'user')
      for (const c of d.message.content || []) {
        if (c.type === 'tool_result') console.log(seenResult ? 'POST' : 'PRE', 'TOOL_RESULT', d.parent_tool_use_id ? '(sub)' : '', c.is_error ? 'ERR' : 'ok', JSON.stringify(c.content).slice(0, 160));
      }
  }
}
