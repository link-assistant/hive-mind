// Checks that every tool accepts exactly the two Formal AI spellings (#3215).
const { isFormalAiModel } = await import('../src/formal-ai-model.lib.mjs');
const { validateModelName } = await import('../src/models/index.mjs');
for (const tool of ['claude', 'codex', 'agent', 'opencode']) {
  for (const model of ['formal-ai', 'formalai/formal-ai', 'openai/formal-ai', 'openai.formal-ai']) {
    const v = validateModelName(model, tool);
    console.log(tool.padEnd(9), model.padEnd(20), 'valid=', v.valid, 'formalAi=', isFormalAiModel(model));
  }
}
