import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveClaudeModelForExecution } from './claude.model-utils.lib.mjs';
import { ORGANIZE_PLAN_SCHEMA } from './organize.prompts.lib.mjs';

export const ORGANIZE_TOOLS = Object.freeze(['claude', 'agent', 'codex', 'opencode', 'gemini', 'qwen']);

/** Remove credentials a planning subprocess could use to mutate GitHub. */
export function sanitizeOrganizationEnvironment(source = process.env, emptyGhConfigDir) {
  const env = { ...source, GH_CONFIG_DIR: emptyGhConfigDir };
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[name];
  return env;
}

/**
 * Produce argv without a shell. Every adapter runs in a read-only/planning mode
 * in an empty directory and receives no GitHub credentials.
 */
export function buildOrganizationInvocation({ tool, model, think = null, systemPrompt, userPrompt, tempDir, baseEnv = process.env }) {
  const systemFile = join(tempDir, 'system-prompt.txt');
  const schemaFile = join(tempDir, 'plan-schema.json');
  const outputFile = join(tempDir, 'last-message.json');
  const emptyGhConfig = join(tempDir, 'empty-gh');
  const env = sanitizeOrganizationEnvironment(baseEnv, emptyGhConfig);

  switch (tool) {
    case 'claude': {
      const effort = think && think !== 'adaptive' ? (think === 'max' ? 'max' : ['high', 'xhigh', 'ultra'].includes(think) ? 'high' : think === 'medium' ? 'medium' : 'low') : null;
      const args = ['--print', '--output-format', 'json', '--model', model, '--system-prompt-file', systemFile, '--json-schema', JSON.stringify(ORGANIZE_PLAN_SCHEMA), '--safe-mode', '--restricted', '--strict-mcp-config', '--permission-mode', 'plan', '--permission-prompts', 'none', '--no-session-persistence'];
      if (effort) args.push('--effort', effort);
      return { command: 'claude', args, input: userPrompt, env };
    }
    case 'agent':
      return {
        command: 'agent',
        args: ['--output-format', 'json', '--model', model, '--system-message-file', systemFile, '--read-only', '--disable-tools', 'bash,edit,write,multiedit,patch,webfetch,read,glob,grep,list,task,todowrite', '--permission-mode', 'readonly', '--no-always-accept-stdin', '--no-interactive'],
        input: userPrompt,
        env,
      };
    case 'codex': {
      const effort = think && think !== 'adaptive' ? (think === 'off' ? 'none' : ['ultra', 'max'].includes(think) ? 'xhigh' : think) : null;
      const args = ['exec', '--model', model, '--output-schema', schemaFile, '--output-last-message', outputFile, '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config', '-c', 'default_permissions="organize-classifier"', '-c', 'permissions.organize-classifier.filesystem={":root"="deny"}', '-c', 'permissions.organize-classifier.network.enabled=false', '-c', 'shell_environment_policy.inherit="none"', '-c', 'web_search="disabled"', '--skip-git-repo-check', '-C', tempDir];
      if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
      return { command: 'codex', args, input: `<TRUSTED_SYSTEM_INSTRUCTIONS>\n${systemPrompt}\n</TRUSTED_SYSTEM_INSTRUCTIONS>\n${userPrompt}`, outputFile, env };
    }
    case 'qwen':
      return {
        command: 'qwen',
        args: ['--model', model, '--output-format', 'json', '--approval-mode', 'plan', '--max-tool-calls', '0', '--safe-mode', '--system-prompt', systemPrompt, '--json-schema', `@${schemaFile}`],
        input: userPrompt,
        env,
      };
    case 'gemini':
      return {
        command: 'gemini',
        args: ['--model', model, '--output-format', 'json', '--approval-mode', 'plan', '--sandbox', '--admin-policy', join(tempDir, 'gemini-deny-tools.toml')],
        input: `<TRUSTED_SYSTEM_INSTRUCTIONS>\n${systemPrompt}\n</TRUSTED_SYSTEM_INSTRUCTIONS>\n${userPrompt}`,
        env,
      };
    case 'opencode':
      return {
        command: 'opencode',
        args: ['run', '--format', 'json', '--model', model],
        input: `<TRUSTED_SYSTEM_INSTRUCTIONS>\n${systemPrompt}\n</TRUSTED_SYSTEM_INSTRUCTIONS>\n${userPrompt}`,
        env,
      };
    default:
      throw new Error(`Unsupported organization tool "${tool}". Supported tools: ${ORGANIZE_TOOLS.join(', ')}`);
  }
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > options.maxBuffer) child.kill('SIGTERM');
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (stderr.length > options.maxBuffer) child.kill('SIGTERM');
    });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(options.input);
  });
}

function parseBalancedObject(text) {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === '{') depth++;
      else if (character === '}' && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

function findPlan(value, seen = new Set()) {
  if (!value || seen.has(value)) return null;
  if (typeof value === 'string') {
    try {
      return findPlan(JSON.parse(value), seen);
    } catch {
      return findPlan(parseBalancedObject(value), seen);
    }
  }
  if (typeof value !== 'object') return null;
  seen.add(value);
  if (!Array.isArray(value) && Array.isArray(value.issues)) return value;
  const preferred = ['result', 'content', 'message', 'text', 'output', 'response', 'structured_output'];
  for (const key of preferred) {
    const found = findPlan(value[key], seen);
    if (found) return found;
  }
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index--) {
      const found = findPlan(value[index], seen);
      if (found) return found;
    }
  }
  return null;
}

export function parseOrganizationClassifierOutput(output) {
  const text = String(output || '').trim();
  if (!text) throw new Error('Organization classifier returned no output');
  let found = findPlan(text);
  if (!found && text.includes('\n')) {
    const lines = text.split('\n').filter(Boolean);
    for (let index = lines.length - 1; index >= 0 && !found; index--) found = findPlan(lines[index]);
  }
  if (!found) throw new Error('Organization classifier did not return the required JSON plan');
  return found;
}

/** Run one classification chunk. This function has no GitHub client or token. */
export async function runOrganizationClassifier({ prompts, tool = 'claude', model = null, think = null, run = runProcess }) {
  const normalizedTool = String(tool || 'claude').toLowerCase();
  if (!ORGANIZE_TOOLS.includes(normalizedTool)) throw new Error(`Unsupported organization tool "${normalizedTool}". Supported tools: ${ORGANIZE_TOOLS.join(', ')}`);
  const { resolveRuntimeDefaultModel, validateRuntimeModelName } = await import('./models/index.mjs');
  const selectedModel = model || (await resolveRuntimeDefaultModel(normalizedTool));
  const validation = await validateRuntimeModelName(selectedModel, normalizedTool);
  if (!validation.valid) throw new Error(validation.message);
  const mappedModel = normalizedTool === 'claude' ? await resolveClaudeModelForExecution(selectedModel) : validation.mappedModel;

  const tempDir = await mkdtemp(join(tmpdir(), 'hive-organize-'));
  try {
    await mkdir(join(tempDir, 'empty-gh'), { mode: 0o700 });
    await writeFile(join(tempDir, 'system-prompt.txt'), prompts.system, { mode: 0o600 });
    await writeFile(join(tempDir, 'plan-schema.json'), JSON.stringify(ORGANIZE_PLAN_SCHEMA), { mode: 0o600 });
    await writeFile(join(tempDir, 'opencode.json'), JSON.stringify({ permission: { '*': 'deny' }, instructions: [join(tempDir, 'system-prompt.txt')] }), { mode: 0o600 });
    await writeFile(join(tempDir, 'gemini-deny-tools.toml'), '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n', { mode: 0o600 });
    const invocation = buildOrganizationInvocation({ tool: normalizedTool, model: mappedModel, think, systemPrompt: prompts.system, userPrompt: prompts.user, tempDir });
    const result = await run(invocation.command, invocation.args, { cwd: tempDir, env: invocation.env, input: invocation.input, maxBuffer: 64 * 1024 * 1024 });
    if (result.code !== 0) throw new Error(`Organization classifier (${normalizedTool}) exited with code ${result.code}`);
    let output = result.stdout;
    if (invocation.outputFile) {
      try {
        output = await readFile(invocation.outputFile, 'utf8');
      } catch {
        // Fall back to stdout for older CLI versions.
      }
    }
    return parseOrganizationClassifierOutput(output);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
