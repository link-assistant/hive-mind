#!/usr/bin/env node

import { createCollapsible, createRawJsonSection, createRedactedRawJsonSection, escapeMarkdown, redactImageData, safeJsonStringify, truncateMiddle } from './interactive-mode.shared.lib.mjs';
import { INTERACTIVE_SESSION_STARTED_MARKER } from './tool-comments.lib.mjs';

export const createCodexEventHandlers = ({ state, postComment, handleAssistantText, imageRenderer }) => {
  const handleCodexThreadStarted = async data => {
    if (state.sessionId) return;

    state.sessionId = data.thread_id || data.session_id || null;
    state.startTime = Date.now();

    const comment = `## 🚀 ${INTERACTIVE_SESSION_STARTED_MARKER}

| Property | Value |
|----------|-------|
| **Session ID** | \`${state.sessionId || 'unknown'}\` |
| **Model** | \`${data.model || 'unknown'}\` |
| **Tool** | \`codex\` |

---

${createRawJsonSection(data)}`;

    await postComment(comment);
  };

  const handleCodexAgentMessage = async data => {
    const text = data.item?.text;
    if (typeof text !== 'string' || !text.trim()) return;
    await handleAssistantText(data, text);
  };

  const handleCodexTodoList = async data => {
    const items = Array.isArray(data.item?.items) ? data.item.items : [];
    const todosPreview = items.length > 0 ? items.map(todo => `- [${todo?.completed ? 'x' : ' '}] ${todo?.text || ''}`).join('\n') : '_No tasks_';
    const completedCount = items.filter(todo => todo?.completed).length;

    const comment = `## 📋 Codex todo list

${createCollapsible(`📋 Todos (${completedCount}/${items.length} items)`, todosPreview, true)}

---

${createRawJsonSection(data)}`;

    await postComment(comment);
  };

  const handleCodexCommandExecution = async data => {
    const item = data.item || {};
    const command = item.command || '';
    const output = item.aggregated_output || '';
    const status = item.status || (data.type === 'item.completed' ? 'completed' : data.type === 'item.updated' ? 'updated' : 'started');
    const body = `## 💻 Codex command execution

**Status:** \`${status}\`
${command ? '\n' + createCollapsible('📋 Executed command', '```bash\n' + escapeMarkdown(command) + '\n```', true) : ''}
${output ? '\n\n' + createCollapsible('📤 Output', '```\n' + escapeMarkdown(truncateMiddle(output, { maxLines: 60, keepStart: 25, keepEnd: 25 })) + '\n```', true) : ''}

---

${createRawJsonSection(data)}`;
    await postComment(body);
  };

  const handleCodexMcpToolCall = async data => {
    const item = data.item || {};
    const summary = [`**Server:** \`${item.server || 'unknown'}\``, `**Tool:** \`${item.tool || 'unknown'}\``, `**Status:** \`${item.status || 'unknown'}\``].join('\n');
    const details = item.arguments != null ? createCollapsible('📥 Arguments', '```json\n' + safeJsonStringify(item.arguments, 2) + '\n```', true) : '';
    // Issue #1843: render MCP-result images inline; base64 is redacted from JSON below.
    const imagesSection = await imageRenderer.section([item.result], `${item.tool || 'mcp'} image`);
    const imagesBlock = imagesSection ? '\n\n' + imagesSection : '';
    const resultSection = item.result != null ? '\n\n' + createCollapsible('📤 Result', '```json\n' + safeJsonStringify(redactImageData(item.result), 2) + '\n```', false) : '';
    const errorSection = item.error != null ? '\n\n' + createCollapsible('❌ Error', '```json\n' + safeJsonStringify(item.error, 2) + '\n```', true) : '';

    await postComment(`## 🔌 Codex MCP tool call

${summary}
${details}${resultSection}${imagesBlock}${errorSection}

---

${createRedactedRawJsonSection(data)}`);
  };

  const handleCodexWebSearch = async data => {
    const item = data.item || {};
    await postComment(`## 🌐 Codex web search

**Query:** ${escapeMarkdown(item.query || 'unknown')}
${item.action ? `\n**Action:** \`${item.action}\`` : ''}

---

${createRawJsonSection(data)}`);
  };

  const handleCodexFileChange = async data => {
    const item = data.item || {};
    const changes = Array.isArray(item.changes) ? item.changes.map(change => `- \`${change?.kind || 'change'}\` ${change?.path || ''}`).join('\n') : '_No changes listed_';
    await postComment(`## 📝 Codex file changes

**Status:** \`${item.status || 'unknown'}\`
${createCollapsible('📄 Files', changes, true)}

---

${createRawJsonSection(data)}`);
  };

  const handleCodexCollabToolCall = async data => {
    const item = data.item || {};
    const prompt = item.prompt || item.description || `${item.tool || 'collab_tool_call'} via codex`;
    await postComment(`## 🤝 Codex collab/sub-agent call

**Tool:** \`${item.tool || 'unknown'}\`
**Status:** \`${item.status || 'unknown'}\`
${createCollapsible('📝 Prompt', escapeMarkdown(truncateMiddle(prompt, { maxLines: 30, keepStart: 12, keepEnd: 12 })), true)}

---

${createRawJsonSection(data)}`);
  };

  const handleCodexTurnCompleted = async data => {
    const usage = data.usage || {};
    let usageSection = '| Type | Count |\n|------|-------|\n';
    usageSection += `| Input | ${(usage.input_tokens || 0).toLocaleString()} |\n`;
    usageSection += `| Cache Read | ${(usage.cached_input_tokens || 0).toLocaleString()} |\n`;
    usageSection += `| Output | ${(usage.output_tokens || 0).toLocaleString()} |\n`;

    await postComment(`## ✅ Codex turn completed

### 📊 Token Usage

${usageSection}

---

${createRawJsonSection(data)}`);
  };

  const handleCodexError = async data => {
    const message = data.message || data.error?.message || 'Unknown Codex error';
    await postComment(`## ❌ Codex error

${createCollapsible('View error', escapeMarkdown(message), true)}

---

${createRawJsonSection(data)}`);
  };

  return {
    handleCodexThreadStarted,
    handleCodexAgentMessage,
    handleCodexTodoList,
    handleCodexCommandExecution,
    handleCodexMcpToolCall,
    handleCodexWebSearch,
    handleCodexFileChange,
    handleCodexCollabToolCall,
    handleCodexTurnCompleted,
    handleCodexError,
  };
};
