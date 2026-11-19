/**
 * Final prompt logging for every AI tool call (PR #4083 feedback on issue #4082).
 *
 * Every prompt Hive Mind sends to an AI tool must appear in the log in full,
 * exactly as it is sent: after all templating, after system and user parts are
 * combined for tools that take a single message, and whether it goes through a
 * command-line argument, a temporary file, stdin or a live stream-json frame.
 * Before this module, Codex, Agent, OpenCode, Gemini and Qwen wrote the prompt
 * to a temporary file or stdin and logged only its path or length; the full
 * text was printed only with --dry-run. A reader of the log could not tell what
 * the tool actually received.
 *
 * Each prompt is printed as one clearly marked block:
 *
 *   📋 Final user prompt sent to codex: 12 lines, 651 characters, delivered via stdin from file /tmp/x.txt
 *   ---BEGIN USER PROMPT---
 *   ...the exact text...
 *   ---END USER PROMPT---
 *
 * The markers keep the names the Claude runner already used, so existing log
 * readers keep working. Blocks are logged at the normal level, not only with
 * --verbose, so the prompts are always in the log.
 */

export const PROMPT_LOG_KINDS = Object.freeze({
  user: 'USER PROMPT',
  system: 'SYSTEM PROMPT',
  combined: 'COMBINED PROMPT',
  live: 'LIVE INPUT PROMPT',
});

const describeKind = kind => {
  if (kind === 'combined') return 'combined system and user prompt';
  if (kind === 'live') return 'live input prompt';
  return `${kind} prompt`;
};

/** Count lines the way a reader sees them: an empty prompt has none, a trailing newline adds none. */
export const countPromptLines = text => {
  const body = String(text ?? '');
  if (body === '') return 0;
  return body.replace(/\n$/, '').split('\n').length;
};

/**
 * Format one prompt as a marked block. The prompt text is kept byte for byte,
 * apart from one trailing newline, which the END marker line replaces.
 */
export const formatPromptLogBlock = ({ tool = 'AI tool', kind = 'user', text = '', delivery = null } = {}) => {
  const marker = PROMPT_LOG_KINDS[kind] || `${String(kind).toUpperCase()} PROMPT`;
  const body = String(text ?? '');
  const details = [`${countPromptLines(body)} lines`, `${body.length} characters`];
  if (delivery) details.push(`delivered via ${delivery}`);
  const header = `📋 Final ${describeKind(kind)} sent to ${tool}: ${details.join(', ')}`;
  const content = body.endsWith('\n') ? body.slice(0, -1) : body;
  return [header, `---BEGIN ${marker}---`, ...(body === '' ? [] : [content]), `---END ${marker}---`].join('\n');
};

/**
 * Log the final prompts of one tool call. `prompts` is a list of
 * `{ kind, text, delivery }`; entries without text are skipped unless
 * `keepEmpty` is set (an empty system prompt is worth showing only when the
 * tool really receives one).
 */
export const logFinalPrompts = async ({ log, tool, prompts = [] } = {}) => {
  if (typeof log !== 'function') return;
  for (const prompt of prompts) {
    if (!prompt) continue;
    if (!prompt.keepEmpty && !String(prompt.text ?? '')) continue;
    await log(formatPromptLogBlock({ tool, ...prompt }));
  }
};

/**
 * Pull the text out of a stream-json user frame, so a live frame is logged as
 * readable text rather than one escaped JSON line. Returns null for frames
 * that carry no text.
 */
export const extractFrameText = jsonFrame => {
  try {
    const frame = typeof jsonFrame === 'string' ? JSON.parse(jsonFrame) : jsonFrame;
    const content = frame?.message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return null;
    const parts = content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text);
    return parts.length ? parts.join('\n\n') : null;
  } catch {
    return null;
  }
};
