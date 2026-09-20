import { spawn } from 'child_process';
import { parseCommandArgs } from './telegram-solve-command.lib.mjs';

export const AUTH_PROVIDERS = Object.freeze(['gh', 'claude', 'codex']);

const AUTH_PROVIDER_SET = new Set(AUTH_PROVIDERS);
const AUTH_USAGE = 'Usage: /auth --status <gh|claude|codex> or /auth --login <gh|claude|codex>';
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const TOKEN_RE = /\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g;
const TOKEN_FIELD_RE = /\b(token|access_token|refresh_token|api[_-]?key|authorization)\s*[:=]\s*["']?[^"'\s,}]+/gi;

function trimOutput(text, max = 3500) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return value.slice(0, max) + `\n... truncated ${value.length - max} characters`;
}

function escapeCodeFence(text) {
  return String(text || '').replace(/```/g, '` ` `');
}

function normalizeProvider(provider) {
  return String(provider || '')
    .trim()
    .toLowerCase();
}

function readActionValue(arg) {
  if (arg === '--status') return { action: 'status', provider: null, consumesNext: true };
  if (arg === '--login') return { action: 'login', provider: null, consumesNext: true };
  if (arg.startsWith('--status=')) return { action: 'status', provider: arg.slice('--status='.length), consumesNext: false };
  if (arg.startsWith('--login=')) return { action: 'login', provider: arg.slice('--login='.length), consumesNext: false };
  return null;
}

export function parseAuthRequest(text) {
  const args = parseCommandArgs(text || '');
  let action = null;
  let provider = null;

  for (let i = 0; i < args.length; i++) {
    const parsed = readActionValue(args[i]);
    if (!parsed) {
      return { action: null, provider: null, error: `Unsupported /auth argument: ${args[i]}\n\n${AUTH_USAGE}` };
    }
    if (action) {
      return { action: null, provider: null, error: `Use exactly one of --status or --login.\n\n${AUTH_USAGE}` };
    }
    action = parsed.action;
    provider = normalizeProvider(parsed.provider);
    if (parsed.consumesNext) {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        return { action: null, provider: null, error: AUTH_USAGE };
      }
      provider = normalizeProvider(next);
      i++;
    }
  }

  if (!action || !provider) {
    return { action: null, provider: null, error: AUTH_USAGE };
  }
  if (!AUTH_PROVIDER_SET.has(provider)) {
    return { action, provider: null, error: `Unsupported auth provider: ${provider}\n\n${AUTH_USAGE}` };
  }

  return { action, provider, error: null };
}

export function buildAuthCommand(action, provider) {
  if (action === 'status') {
    if (provider === 'gh') return { command: 'gh', args: ['auth', 'status', '--hostname', 'github.com'] };
    if (provider === 'claude') return { command: 'claude', args: ['auth', 'status'] };
    if (provider === 'codex') return { command: 'codex', args: ['login', 'status'] };
  }
  if (action === 'login') {
    if (provider === 'gh') return { command: 'gh', args: ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'] };
    if (provider === 'claude') return { command: 'claude', args: ['auth', 'login', '--claudeai'] };
    if (provider === 'codex') return { command: 'codex', args: ['login', '--device-auth'] };
  }
  throw new Error(`Unsupported auth command: ${action} ${provider}`);
}

export function redactAuthOutput(output) {
  return String(output || '')
    .replace(ANSI_RE, '')
    .replace(TOKEN_RE, '[REDACTED_TOKEN]')
    .replace(TOKEN_FIELD_RE, (_, name) => `${name}: [REDACTED_TOKEN]`);
}

function collectAuthOutput(result) {
  return redactAuthOutput([result?.stdout, result?.stderr].filter(Boolean).join('\n'));
}

export function extractAuthStartDetails(output) {
  const text = redactAuthOutput(output);
  const urls = [...new Set([...text.matchAll(/https?:\/\/[^\s<>)"']+/g)].map(match => match[0].replace(/[.,;:!?]+$/, '')))];

  const codePatterns = [/\bone-time code\s*[:=]\s*([A-Z0-9][A-Z0-9-]{3,})/i, /\b(?:user code|verification code|code)\s*[:=]\s*([A-Z0-9][A-Z0-9-]{3,})/i, /\b([A-Z0-9]{4,}-[A-Z0-9-]{4,})\b/];
  let code = null;
  for (const pattern of codePatterns) {
    const match = text.match(pattern);
    if (match) {
      code = match[1].toUpperCase();
      break;
    }
  }

  return { urls, code };
}

export function formatAuthStatusMessage(provider, result) {
  const code = result?.code;
  const ok = code === 0;
  const output = trimOutput(collectAuthOutput(result)) || '(no output)';
  return `${ok ? 'OK' : 'ERROR'} *${provider} auth status*\n\nExit code: ${code ?? 'unknown'}\n\n\`\`\`\n${escapeCodeFence(output)}\n\`\`\``;
}

export function formatAuthLoginMessage(provider, result) {
  const output = collectAuthOutput(result);
  const details = extractAuthStartDetails(output);
  const lines = [`*${provider} auth login started*`, '', 'The local login command was cancelled locally after capturing the browser step, so this bot command did not replace existing credentials.'];

  if (details.urls.length > 0) {
    lines.push('', 'Open this URL:');
    for (const url of details.urls) lines.push(url);
  }
  if (details.code) {
    lines.push('', `Code: \`${details.code}\``);
  }
  if (details.urls.length === 0 && !details.code) {
    const shownOutput = trimOutput(output) || '(no output captured)';
    lines.push('', 'Captured output:', '', '```', escapeCodeFence(shownOutput), '```');
  }
  if (result?.cancelled) {
    lines.push('', 'Status: cancelled locally after capture.');
  } else if (typeof result?.code === 'number') {
    lines.push('', `Status: login command exited with code ${result.code}.`);
  }
  lines.push('', 'Continuation by replying with a provider code is not automated yet; this is the first experimental CLI-backed /auth path.');
  return lines.join('\n');
}

export const resolveAllowedAuthChatIds = allowedChats => {
  if (!allowedChats) return [];
  const raw = typeof allowedChats === 'function' ? allowedChats() : allowedChats;
  if (!Array.isArray(raw)) return [];
  return raw.map(value => String(value)).filter(Boolean);
};

export async function isAuthOperator({ telegram, userId, allowedChatIds }) {
  if (!telegram || !userId || !allowedChatIds || allowedChatIds.length === 0) {
    return false;
  }
  for (const chatId of allowedChatIds) {
    if (String(chatId) === String(userId)) return true;
    try {
      const member = await telegram.getChatMember(chatId, userId);
      if (member?.status === 'creator') return true;
    } catch {
      // Try the next configured chat. The bot may no longer be a member.
    }
  }
  return false;
}

export function runAuthCommand(command, args, options = {}) {
  const { mode = 'status', loginCaptureMs = 15000, outputLimit = 20000, env = process.env } = options;
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let captureTimer = null;

    const settle = result => {
      if (settled) return;
      settled = true;
      if (captureTimer) clearTimeout(captureTimer);
      resolve({
        stdout: stdout.slice(0, outputLimit),
        stderr: stderr.slice(0, outputLimit),
        ...result,
      });
    };

    const maybeCancelLogin = () => {
      if (mode !== 'login' || settled) return;
      const details = extractAuthStartDetails(`${stdout}\n${stderr}`);
      if (details.urls.length === 0 && !details.code) return;
      child.kill('SIGTERM');
      settle({ code: null, signal: 'SIGTERM', cancelled: true });
    };

    child.stdout.on('data', data => {
      stdout += data.toString();
      maybeCancelLogin();
    });
    child.stderr.on('data', data => {
      stderr += data.toString();
      maybeCancelLogin();
    });
    child.on('error', error => {
      settle({ code: null, error: error.message });
    });
    child.on('close', (code, signal) => {
      settle({ code, signal, cancelled: false });
    });

    if (mode === 'login') {
      captureTimer = setTimeout(() => {
        child.kill('SIGTERM');
        settle({ code: null, signal: 'SIGTERM', cancelled: true });
      }, loginCaptureMs);
    }
  });
}

export function registerAuthCommand(bot, options = {}) {
  const { VERBOSE = false, isOldMessage, isForwardedOrReply, allowedChats, authEnabled = true } = options;
  const execute = options.runCommand || runAuthCommand;
  const reply = options.safeReply || ((ctx, text, replyOptions) => ctx.reply(text, replyOptions));

  async function handleAuthCommand(ctx) {
    VERBOSE && console.log('[VERBOSE] /auth command received');

    if (isOldMessage && isOldMessage(ctx)) {
      VERBOSE && console.log('[VERBOSE] /auth ignored: old message');
      return;
    }
    if (isForwardedOrReply && isForwardedOrReply(ctx)) {
      VERBOSE && console.log('[VERBOSE] /auth ignored: forwarded or reply');
      return;
    }
    if (!authEnabled) {
      await reply(ctx, 'The /auth command is disabled on this bot instance.', { reply_to_message_id: ctx.message?.message_id });
      return;
    }
    if (!ctx.chat || !ctx.from || !ctx.message) return;
    if (ctx.chat.type !== 'private') {
      await reply(ctx, 'The /auth command is only available in private messages.', { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const allowedChatIds = resolveAllowedAuthChatIds(allowedChats);
    if (allowedChatIds.length === 0) {
      await reply(ctx, 'The /auth command is disabled because TELEGRAM_ALLOWED_CHATS is not configured.', { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const authorized = await isAuthOperator({ telegram: ctx.telegram, userId: ctx.from.id, allowedChatIds });
    if (!authorized) {
      VERBOSE && console.log(`[VERBOSE] /auth denied: user ${ctx.from.id} is not creator of any allowed chat`);
      await reply(ctx, 'The /auth command is only available to owners of allowlisted chats.', { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const request = parseAuthRequest(ctx.message.text || '');
    if (request.error) {
      await reply(ctx, request.error, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const { command, args } = buildAuthCommand(request.action, request.provider);
    let result;
    try {
      result = await execute(command, args, { mode: request.action, provider: request.provider });
    } catch (error) {
      await reply(ctx, `Failed to run ${request.provider} auth ${request.action}: ${error.message || String(error)}`, { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const message = request.action === 'status' ? formatAuthStatusMessage(request.provider, result) : formatAuthLoginMessage(request.provider, result);
    await reply(ctx, message, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  }

  bot.command('auth', handleAuthCommand);
  return { handleAuthCommand };
}

export default {
  AUTH_PROVIDERS,
  buildAuthCommand,
  extractAuthStartDetails,
  formatAuthLoginMessage,
  formatAuthStatusMessage,
  isAuthOperator,
  parseAuthRequest,
  redactAuthOutput,
  registerAuthCommand,
  resolveAllowedAuthChatIds,
  runAuthCommand,
};
