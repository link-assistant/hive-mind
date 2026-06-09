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
export const HANDOFF_SKILL_DESCRIPTION = "Maintain a HANDOFF.md continuity document in the repository root so any session can continue a previous session's work — even across different AI tools (Claude and Codex) in the same pull request. Use when starting, resuming, or finishing work on a long-running task, issue, or pull request.";

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
  return `# HANDOFF.md continuity skill

${fileName} is a single shared handoff document in the repository root that lets any session continue the work of any previous session, even when a different AI tool (for example Claude and Codex) is used. It travels with the pull request branch, so it is the cross-tool, cross-session memory for this PR.

## When to use this skill

- When you start a working session, read ${fileName} first if it exists. Treat its "Next steps" section as your immediate starting point and honor the decisions and constraints it records before exploring anything else.
- When ${fileName} does not exist yet and the task is non-trivial, create it early so an interrupted session can always be resumed.
- When you make meaningful progress, update ${fileName} so it always reflects the current truth. Keep exactly one active ${fileName} per pull request branch (do not create per-session copies).
- When all requirements are fully met and the work is complete, record that completion at the top of ${fileName} (or delete the file) so the next session knows there is nothing left to continue.

## How to write ${fileName}

- Keep it concise and tool-agnostic: describe state by referencing file paths, function names, branch, and commit SHAs rather than tool-specific commands, so the next tool (Claude or Codex) can act on it directly. Prefer pointers to existing artifacts over duplicating their content.
- Include these sections:
  1. **Task** — the issue/PR being solved and the goal.
  2. **Current state** — what is done and verified.
  3. **Decisions** — key choices made and why (so they are not re-litigated).
  4. **Next steps** — the concrete, ordered actions the next session should take.
  5. **Gotchas** — known pitfalls, failing checks, or constraints.
  6. **Critical files** — the important paths and what each is for.
- When you record next steps, make them specific and actionable (a path, a function, a command to run) instead of vague goals, and remove items as they are completed.

## Committing and safety

- When you finish a step that changes the state, commit ${fileName} together with the related code changes so the handoff stays in sync with the branch and is never lost if the session is interrupted.
- Never include secrets, tokens, API keys, passwords, or personal data in ${fileName} — it is committed to the repository.`;
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
export const buildHandoffSkillFile = ({ fileName = HANDOFF_FILE_NAME, name = HANDOFF_SKILL_NAME, description = HANDOFF_SKILL_DESCRIPTION } = {}) => {
  return `---
name: ${name}
description: ${description}
---

${buildHandoffSkillBody({ fileName })}
`;
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
  return `
HANDOFF.md continuity skill (experimental, --use-handoff).
   - A reusable "${name}" Agent Skill is installed in this workspace (.claude/skills/${name}/ for Claude, .agents/skills/${name}/ for Codex). It defines how to read and maintain ${fileName} so any session can continue the work of a previous one — even across tools (Claude and Codex) in the same pull request.
   - At the start of this session, use the ${name} skill: if ${fileName} exists in the repository root, read it first and continue from its "Next steps". Create or update ${fileName} as you make progress and commit it to the pull request branch.`;
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
