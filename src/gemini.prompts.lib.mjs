/**
 * Gemini prompts module.
 *
 * Gemini is currently executed through agent-commander, so it can share the
 * same issue-solving prompt shape as Qwen while using Gemini-specific labels.
 */

import { buildSystemPrompt as buildQwenSystemPrompt, buildUserPrompt as buildQwenUserPrompt } from './qwen.prompts.lib.mjs';

export const buildUserPrompt = params => buildQwenUserPrompt({ ...params, tool: 'gemini' });

export const buildSystemPrompt = params => buildQwenSystemPrompt({ ...params, tool: 'gemini' }).replaceAll('Qwen Code', 'Gemini CLI');
