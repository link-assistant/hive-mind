import { promptText, localizePromptConstant } from './prompt-text.lib.mjs';
/**
 * HANDOFF.md support — Agent Skill (issue #1877)
 *
 * Instead of injecting a bespoke sub-prompt, this module ships a real
 * **Agent Skill** (https://agentskills.io) — a `SKILL.md` document with YAML
 * frontmatter — that teaches the AI tool to read and maintain a HANDOFF.md file
 * in the repository root. The Agent Skills format is an open standard (created
 * by Anthropic) that BOTH supported tools load natively:
 *   - Claude Code discovers project skills from `.claude/skills/<name>/SKILL.md`.
 *   - Codex discovers project skills from `.agents/skills/<name>/SKILL.md`.
 * The exact same `SKILL.md` works for both, so "same skill, same way" is
 * satisfied by a single canonical file rather than a tool-specific prompt.
 * Because neither tool lets you redirect its skills folder, the deployment
 * writes that file ONCE and symlinks the second tool's path to it, so both
 * tools literally read the same folder (see handoff-skill.lib.mjs).
 *
 * The skill is deployed into the session working directory by
 * `handoff-skill.lib.mjs` (gated behind the experimental --use-handoff flag).
 * This module only builds the canonical text; the deployment module writes it.
 *
 * Goal: cross-session AND cross-tool continuity — a session driven by one tool
 * (e.g. Claude) can be continued by another tool (e.g. Codex) inside the same
 * pull request, because the HANDOFF.md state travels with the branch.
 *
 * Design rationale specific to hive-mind:
 *   - Each working session runs in an ephemeral temp working directory that is
 *     cloned fresh from the pull request branch. The ONLY state that persists
 *     between sessions (and between different tools) is what is committed to the
 *     branch. Therefore, unlike the general "disposable temp-dir handoff"
 *     convention, the handoff file here MUST be committed to the PR branch so
 *     the next session/tool can read it. We keep a single active HANDOFF.md per
 *     branch to avoid ambiguity.
 *   - The skill file itself (SKILL.md) is tool configuration, not project state,
 *     so it is re-deployed each session by hive-mind and is NOT committed to the
 *     target repository (see handoff-skill.lib.mjs).
 */

/**
 * The default handoff file name (repository root, relative path).
 * @type {string}
 */
export const HANDOFF_FILE_NAME = 'HANDOFF.md';

/**
 * The skill directory / invocation name (Agent Skills standard).
 * @type {string}
 */
export const HANDOFF_SKILL_NAME = 'handoff';

/**
 * The skill description used in the SKILL.md frontmatter. Front-loads the key
 * use case and trigger words so the tool can match the skill implicitly.
 * @type {string}
 */
export const HANDOFF_SKILL_DESCRIPTION = promptText('prompt.templates.handoff-prompts.HANDOFF_SKILL_DESCRIPTION.text1', {}, { locale: 'en' });

/**
 * Build the canonical handoff skill instructions (the markdown body that follows
 * the YAML frontmatter in SKILL.md). This is tool-agnostic and identical for
 * Claude and Codex.
 *
 * @param {Object} [options]
 * @param {string} [options.fileName=HANDOFF_FILE_NAME] - Handoff file name.
 * @returns {string} The markdown instructions body.
 */
export const buildHandoffSkillBody = ({ fileName = HANDOFF_FILE_NAME } = {}) => {
  return promptText('prompt.templates.handoff-prompts.buildHandoffSkillBody.text2', { fileName: String(fileName) });
};

/**
 * Build a complete SKILL.md document (Agent Skills standard): YAML frontmatter
 * with `name` and `description`, followed by the instructions body. This exact
 * file is deployed verbatim for both Claude (.claude/skills/handoff/SKILL.md)
 * and Codex (.agents/skills/handoff/SKILL.md).
 *
 * @param {Object} [options]
 * @param {string} [options.fileName=HANDOFF_FILE_NAME] - Handoff file name.
 * @param {string} [options.name=HANDOFF_SKILL_NAME] - Skill name (frontmatter).
 * @param {string} [options.description=HANDOFF_SKILL_DESCRIPTION] - Skill description.
 * @returns {string} The full SKILL.md content.
 */
export const buildHandoffSkillFile = ({ fileName = HANDOFF_FILE_NAME, name = HANDOFF_SKILL_NAME, description = localizePromptConstant(HANDOFF_SKILL_DESCRIPTION) } = {}) => {
  return promptText('prompt.templates.handoff-prompts.buildHandoffSkillFile.text3', { name: String(name), description: String(description), value3: String(buildHandoffSkillBody({ fileName })) });
};

/**
 * Build a minimal activation nudge for the system prompt. The full procedure
 * lives in the deployed SKILL.md (loaded natively by the tool); this short
 * pointer only ensures the read-at-session-start behavior reliably fires, since
 * that is triggered by session lifecycle rather than by a task description.
 *
 * @param {Object} [options]
 * @param {string} [options.fileName=HANDOFF_FILE_NAME] - Handoff file name.
 * @param {string} [options.name=HANDOFF_SKILL_NAME] - Skill name.
 * @returns {string} The activation nudge.
 */
export const buildHandoffSubPrompt = ({ fileName = HANDOFF_FILE_NAME, name = HANDOFF_SKILL_NAME } = {}) => {
  return promptText('prompt.system.templates.handoff-prompts.buildHandoffSubPrompt.text4', { name: String(name), fileName: String(fileName) });
};

/**
 * Get the handoff skill activation nudge if enabled.
 *
 * @param {Object} argv - Parsed command line arguments.
 * @returns {string} The sub-prompt content, or an empty string when disabled.
 */
export const getHandoffSubPrompt = argv => {
  if (argv && argv.useHandoff) {
    return buildHandoffSubPrompt();
  }
  return '';
};

// Export all functions as default object too (mirrors architecture-care module)
export default {
  HANDOFF_FILE_NAME,
  HANDOFF_SKILL_NAME,
  HANDOFF_SKILL_DESCRIPTION,
  buildHandoffSkillBody,
  buildHandoffSkillFile,
  buildHandoffSubPrompt,
  getHandoffSubPrompt,
};
