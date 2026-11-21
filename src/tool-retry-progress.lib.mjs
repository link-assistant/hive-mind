import { classifyRetryableError } from './tool-retry.lib.mjs';

// Only provider work counts as recovery. Startup, heartbeats, synthetic API
// errors and tool-result text quoting an outage cannot replenish a retry budget.
export const isRetryProgressEvent = (tool, data) => {
  if (!data || typeof data !== 'object' || data.error || data.is_error || data.isApiErrorMessage) return false;
  const hasText = text => typeof text === 'string' && !!text.trim() && !classifyRetryableError(text).isRetryable;
  if (tool === 'codex') {
    if (data.type !== 'item.completed' || !data.item || data.item.error) return false;
    const item = data.item;
    if (['agent_message', 'reasoning'].includes(item.type)) return hasText(item.text);
    if (item.type === 'command_execution') return item.status === 'completed' && item.exit_code === 0;
    return ['file_change', 'mcp_tool_call', 'web_search'].includes(item.type) && item.status === 'completed';
  }
  if (['claude', 'qwen'].includes(tool)) {
    if (data.type !== 'assistant' || data.error || data.isApiErrorMessage || data.message?.error) return false;
    const content = data.message?.content;
    return Array.isArray(content) && content.some(block => block?.type === 'tool_use' || (['text', 'thinking'].includes(block?.type) && hasText(block.text ?? block.thinking)));
  }
  if (['agent', 'opencode'].includes(tool)) {
    if (data.type === 'text') return hasText(data.text ?? data.part?.text);
    return data.type === 'tool_use' && !!(data.id || data.part?.callID);
  }
  if (tool === 'gemini') {
    return data.type === 'message' && data.role === 'assistant' && hasText(data.content);
  }
  return false;
};

export const createRetryProgressObserver = ({ tool, budget, argv, onRecovery, log }) => {
  let recovered = false;
  return {
    observe(data) {
      if (!isRetryProgressEvent(tool, data) || !budget.recordProgress()) return;
      // Both backoff and fallback attempts describe the continuous outage.
      argv._capacityRetryCount = 0;
      onRecovery();
      recovered = true;
    },
    async flushLog() {
      if (!recovered) return;
      recovered = false;
      await log(`   ${tool} made progress; transient retry budget and consecutive retry counts reset`, { verbose: true });
    },
  };
};
