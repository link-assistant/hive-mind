import { promptText, localizePromptConstant } from './prompt-text.lib.mjs';
/**
 * OpenCode prompts module
 * Handles building prompts for OpenCode commands
 */

import { getArchitectureCareSubPrompt } from './architecture-care.prompts.lib.mjs';
import { getUpdateAllDependenciesSubPrompt } from './update-dependencies.prompts.lib.mjs';
import { getReportDependenciesIssuesSubPrompt } from './report-dependencies-issues.prompts.lib.mjs';
import { RESOURCE_AWARE_SOLVER_IDENTITY, getResourceAwareTestingSubPrompt } from './resource-aware-testing.prompts.lib.mjs';
import { getExperimentsExamplesSubPrompt } from './experiments-examples.prompts.lib.mjs';
import { getThinkingPromptInstruction } from './thinking-prompt.lib.mjs';
import { buildWorkLanguageDirective } from './work-language.prompts.lib.mjs';
import { getIssueCompletionSubPrompt, ISSUE_COMPLETION_GOAL } from './issue-completion.prompts.lib.mjs';
import { buildRequestedBaseBranchDirective } from './solve-option-contract.prompts.lib.mjs';
import { buildIssueResearchPrompt } from './deep-analysis.lib.mjs';

/**
 * Build the user prompt for OpenCode
 * @param {Object} params - Parameters for building the user prompt
 * @returns {string} The formatted user prompt
 */
export const buildUserPrompt = params => {
  const { issueUrl, issueNumber, prNumber, prUrl, branchName, tempDir, workspaceTmpDir, isContinueMode, forkedRepo, feedbackLines, forkActionsUrl, owner, repo, argv } = params;

  const promptLines = [];

  // Issue or PR reference
  if (isContinueMode) {
    promptLines.push(promptText('prompt.templates.opencode-prompts.buildUserPrompt.text2', { value1: String(issueNumber ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : promptText('prompt.templates.opencode-prompts.buildUserPrompt.text1', { prNumber: String(prNumber) })) }));
  } else {
    promptLines.push(promptText('prompt.user.issue.to_solve', { issueUrl: String(issueUrl) }));
  }

  // Basic info
  promptLines.push(promptText('prompt.user.prepared_branch', { branchName: String(branchName) }));
  promptLines.push(promptText('prompt.user.prepared.working_directory', { tempDir: String(tempDir) }));

  // Workspace tmp directory for logs and temp files (when --enable-workspaces is used)
  if (workspaceTmpDir) {
    promptLines.push(promptText('prompt.user.prepared.tmp_directory', { workspaceTmpDir: String(workspaceTmpDir) }));
  }

  // PR info if available
  if (prUrl) {
    promptLines.push(promptText('prompt.user.prepared.pull_request', { prUrl: String(prUrl) }));
  }

  // Fork info if applicable
  if (argv && argv.fork && forkedRepo) {
    promptLines.push(promptText('prompt.user.forked_repository', { forkedRepo: String(forkedRepo) }));
    promptLines.push(promptText('prompt.user.original_repository', { owner: String(owner), repo: String(repo) }));

    // Check for GitHub Actions on fork
    if (branchName && forkActionsUrl) {
      promptLines.push(promptText('prompt.user.fork.actions_url', { forkActionsUrl: String(forkActionsUrl) }));
    }
  }

  const requestedBaseBranchDirective = buildRequestedBaseBranchDirective(argv);
  if (requestedBaseBranchDirective) {
    promptLines.push(requestedBaseBranchDirective);
  }

  // Add blank line
  promptLines.push('');

  // Add feedback info if in continue mode and there are feedback items
  if (isContinueMode && feedbackLines && feedbackLines.length > 0) {
    // Add each feedback line directly
    feedbackLines.forEach(line => promptLines.push(line));
    promptLines.push('');
  }

  const issueResearchPrompt = buildIssueResearchPrompt({ argv, issueNumber, prNumber }).trim();
  if (issueResearchPrompt) {
    promptLines.push(issueResearchPrompt, '');
  }

  const thinkingPromptInstruction = getThinkingPromptInstruction({ tool: 'opencode', argv });
  if (thinkingPromptInstruction) {
    promptLines.push(thinkingPromptInstruction);
  }

  // Final instruction
  // Issue #2406: every initial and continuation prompt restates the complete-delivery goal.
  promptLines.push(localizePromptConstant(ISSUE_COMPLETION_GOAL), isContinueMode ? promptText('prompt.user_continue') : promptText('prompt.user_proceed'));

  // Build the final prompt with trailing newline for POSIX compliance
  return promptLines.join('\n') + '\n';
};

/**
 * Build the system prompt for OpenCode - adapted for OpenCode's capabilities
 * @param {Object} params - Parameters for building the prompt
 * @returns {string} The formatted system prompt
 */
export const buildSystemPrompt = params => {
  const { owner, repo, issueNumber, prNumber, branchName, workspaceTmpDir, argv, modelSupportsVision, forkedRepo } = params;

  // When in fork mode, screenshots are pushed to the fork, not the original repo
  const screenshotRepoPath = argv?.fork && forkedRepo ? forkedRepo : `${owner}/${repo}`;

  // Build workspace-specific instructions and examples
  let workspaceInstructions = '';
  if (workspaceTmpDir) {
    workspaceInstructions = promptText('prompt.system.templates.opencode-prompts.buildSystemPrompt.text3', { workspaceTmpDir: String(workspaceTmpDir) });
  }

  // Build CI command examples with workspace tmp paths
  let ciExamples = '';
  if (workspaceTmpDir) {
    ciExamples = promptText('prompt.system.templates.opencode-prompts.buildSystemPrompt.text4', { owner: String(owner), repo: String(repo), workspaceTmpDir: String(workspaceTmpDir), branchName: String(branchName), prNumber: String(prNumber), issueNumber: String(issueNumber) });
  }

  return promptText('prompt.system.templates.opencode-prompts.buildSystemPrompt.text9', {
    RESOURCE_AWARE_SOLVER_IDENTITY: String(localizePromptConstant(RESOURCE_AWARE_SOLVER_IDENTITY)),
    value2: String(getExperimentsExamplesSubPrompt(argv)),
    workspaceInstructions: String(workspaceInstructions),
    owner: String(owner),
    repo: String(repo),
    issueNumber: String(issueNumber),
    value8: String(argv?.promptCheckSiblingPullRequests !== false ? promptText('prompt.system.templates.opencode-prompts.buildSystemPrompt.text5') : ''),
    prNumber: String(prNumber),
    value21: String(getResourceAwareTestingSubPrompt()),
    branchName: String(branchName),
    value31: String(argv && argv.promptEnsureAllRequirementsAreMet ? promptText('prompt.system.templates.opencode-prompts.buildSystemPrompt.text6') : ''),
    value35: String(argv && argv.promptPlaywrightMcp ? promptText('prompt.system.templates.opencode-prompts.buildSystemPrompt.text7') : ''),
    value36: String(modelSupportsVision ? promptText('prompt.system.templates.opencode-prompts.buildSystemPrompt.text8', { screenshotRepoPath: String(screenshotRepoPath), branchName: String(branchName) }) : ''),
    ciExamples: String(ciExamples),
    value38: String(getArchitectureCareSubPrompt(argv)),
    value39: String(getUpdateAllDependenciesSubPrompt(argv)),
    value40: String(getReportDependenciesIssuesSubPrompt(argv)),
    value41: String(getIssueCompletionSubPrompt(params)),
    value42: String(buildWorkLanguageDirective()),
  });
};

// Export all functions as default object too
export default {
  buildUserPrompt,
  buildSystemPrompt,
};
